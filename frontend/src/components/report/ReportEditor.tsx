import React from "react";

import { getAssetTables, getDomains, type AssetTableItem } from "../../api/assets.ts";
import { getIndicatorList } from "../../api/indicator.ts";
import { getReportList } from "../../api/report.ts";
import type { MockIndicatorItem } from "../../data/indicators.ts";
import type { MockReportItem, RelatedIndicatorSummary, RelatedTableSummary } from "../../data/reports.ts";
import { buildReportOptionSets, type ReportOptionSets } from "../../config/reportOptions.ts";
import { getLegacyAwareOptions, normalizeDictOptions, type OptionInputItem } from "../../utils/optionUtils.ts";
import { ActionErrorBanner, AssetReferencePicker, BinaryStatusToggle, DangerZone, FormActionBar, PageHeader } from "../common/index.ts";
import { Icon } from "../ui.tsx";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface ReportFormData {
  code: string;
  name: string;
  alias: string;
  type: string;
  domain: string;
  freq: string;
  statPeriod: string;
  statCaliber: string;
  dataDelay: string;
  status: string;
  effectiveDate: string;
  expireDate: string;
  purpose: string;
  statObject: string;
  businessScopeTags: string;
  filterCondition: string;
  specialRule: string;
  ownerDept: string;
  ownerName: string;
  maintainerName: string;
  maintainerSameAsOwner: boolean;
  relatedTables: RelatedTableSummary[];
  relatedIndicators: RelatedIndicatorSummary[];
  remark: string;
}

function createDefaultForm(): ReportFormData {
  return {
    code: "",
    name: "",
    alias: "",
    type: "",
    domain: "",
    freq: "",
    statPeriod: "",
    statCaliber: "",
    dataDelay: "",
    status: "enabled",
    effectiveDate: "",
    expireDate: "",
    purpose: "",
    statObject: "",
    businessScopeTags: "",
    filterCondition: "",
    specialRule: "",
    ownerDept: "",
    ownerName: "",
    maintainerName: "",
    maintainerSameAsOwner: true,
    relatedTables: [],
    relatedIndicators: [],
    remark: "",
  };
}

function createFormState(initial: MockReportItem | null | undefined): ReportFormData {
  const statCaliber = initial?.statCaliber || initial?.dateCaliberOther || initial?.dateCaliber || initial?.timeCaliber || "";
  const dataDelay = initial?.dataDelay || initial?.dataTimelinessCustom || initial?.dataTimeliness || "";
  const maintainerName = initial?.maintainerName || initial?.ownerName || "";
  return {
    ...createDefaultForm(),
    code: initial?.code || "",
    name: initial?.name || "",
    alias: initial?.alias || "",
    type: initial?.type || "",
    domain: initial?.domain || "",
    freq: initial?.freq || "",
    statPeriod: initial?.statPeriod || "",
    statCaliber,
    dataDelay,
    status: initial?.status || "enabled",
    effectiveDate: initial?.effectiveDate || "",
    expireDate: initial?.expireDate || "",
    purpose: initial?.purpose || "",
    statObject: initial?.statObject || "",
    businessScopeTags: initial?.businessScopeTags || initial?.statScope || "",
    filterCondition: initial?.filterCondition || "",
    specialRule: initial?.specialRule || "",
    ownerDept: initial?.ownerDept || "",
    ownerName: initial?.ownerName || "",
    maintainerName,
    maintainerSameAsOwner: !initial?.maintainerName || initial.maintainerName === initial.ownerName,
    relatedTables: Array.isArray(initial?.relatedTables) ? initial.relatedTables : [],
    relatedIndicators: Array.isArray(initial?.relatedIndicators) ? initial.relatedIndicators : [],
    remark: initial?.remark || "",
  };
}

function validateForm(form: ReportFormData): string[] {
  const errors: string[] = [];
  if (!form.code.trim()) errors.push("报表编码不能为空");
  if (!/^[A-Z][A-Z0-9_-]{2,63}$/.test(form.code.trim().toUpperCase())) {
    errors.push("报表编码仅允许大写字母、数字、下划线和中划线，且需以字母开头");
  }
  if (!form.name.trim()) errors.push("报表名称不能为空");
  if (!form.type.trim()) errors.push("报表类型不能为空");
  if (!form.domain.trim()) errors.push("请选择主题域");
  if (!form.statPeriod.trim()) errors.push("请选择统计周期");
  if (!form.statCaliber.trim()) errors.push("请选择或输入统计口径");
  if (!form.ownerDept.trim()) errors.push("归属部门不能为空");
  if (!form.ownerName.trim()) errors.push("负责人不能为空");
  if (form.effectiveDate.trim() && !DATE_RE.test(form.effectiveDate.trim())) errors.push("生效日期必须使用 yyyy-mm-dd");
  if (form.expireDate.trim() && !DATE_RE.test(form.expireDate.trim())) errors.push("失效日期必须使用 yyyy-mm-dd");
  if (form.effectiveDate.trim() && form.expireDate.trim() && form.expireDate.trim() < form.effectiveDate.trim()) {
    errors.push("失效日期不能早于生效日期");
  }
  return [...new Set(errors)];
}

interface DictInputProps {
  value: string;
  onChange: (value: string) => void;
  options: readonly OptionInputItem[];
  listId: string;
  placeholder: string;
  invalid?: boolean | undefined;
}

function DictInput({ value, onChange, options, listId, placeholder, invalid = false }: DictInputProps) {
  const selectOptions = getLegacyAwareOptions(normalizeDictOptions(options), value);
  return <>
    <input className={`inp${invalid ? " invalid" : ""}`} list={listId} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
    <datalist id={listId}>{selectOptions.map((item) => <option key={item.value} value={item.value}>{item.name}</option>)}</datalist>
  </>;
}

function readText(item: AssetTableItem, key: string): string {
  const value = item[key];
  return typeof value === "string" ? value : "";
}

function normalizeTableCandidate(item: AssetTableItem): RelatedTableSummary {
  return {
    tableName: item.name,
    tableCn: readText(item, "labelCn") || readText(item, "cnName") || item.cn || item.desc || "",
    domain: item.domain || "",
    layer: item.layer || item.dataLayer || item.schemaLayer || "",
  };
}

function normalizeIndicatorCandidate(item: MockIndicatorItem): RelatedIndicatorSummary {
  return {
    indicatorId: item.id,
    indicatorName: item.name,
    dimension: item.dimension || "",
    path: item.path || "",
  };
}

function normalizeStatus(value: string | boolean): string {
  return typeof value === "boolean" ? (value ? "enabled" : "disabled") : value;
}

export interface ReportEditorProps {
  mode: "new" | "edit";
  initial: MockReportItem | null;
  onSave: (payload: MockReportItem) => void | Promise<unknown>;
  onCancel: () => void;
  onDelete: (reportCode: string) => void | Promise<unknown>;
  saveBusy?: boolean | undefined;
  saveError?: string | undefined;
  onClearSaveError?: (() => void) | undefined;
}

export function ReportEditor({
  mode,
  initial,
  onSave,
  onCancel,
  onDelete,
  saveBusy = false,
  saveError = "",
  onClearSaveError,
}: ReportEditorProps) {
  const isEdit = mode === "edit";
  const [form, setForm] = React.useState<ReportFormData>(() => createFormState(initial));
  const [touched, setTouched] = React.useState(false);
  const [tableSearch, setTableSearch] = React.useState("");
  const [indicatorSearch, setIndicatorSearch] = React.useState("");
  const [tableCandidates, setTableCandidates] = React.useState<RelatedTableSummary[]>([]);
  const [indicatorCandidates, setIndicatorCandidates] = React.useState<RelatedIndicatorSummary[]>([]);
  const [refLoading, setRefLoading] = React.useState(false);
  const [refError, setRefError] = React.useState("");
  const [domains, setDomains] = React.useState<string[]>([]);
  const [people, setPeople] = React.useState<string[]>([]);
  const [reportOptionSets, setReportOptionSets] = React.useState<ReportOptionSets>(() => buildReportOptionSets());
  const {
    reportTypes: reportTypeOptions,
    periods: periodOptions,
    statCalibers: statCaliberOptions,
    dataDelays: dataDelayOptions,
    departments: departmentOptions,
  } = reportOptionSets;
  const initialSnapshotRef = React.useRef(JSON.stringify(form));
  const isDirty = initialSnapshotRef.current !== JSON.stringify(form);

  React.useEffect(() => {
    const nextForm = createFormState(initial);
    setForm(nextForm);
    setTouched(false);
    initialSnapshotRef.current = JSON.stringify(nextForm);
  }, [initial]);

  React.useEffect(() => {
    let cancelled = false;

    async function loadReferences(): Promise<void> {
      setRefLoading(true);
      setRefError("");
      try {
        const [tables, indicators, domainItems, reportItems] = await Promise.all([getAssetTables(), getIndicatorList(), getDomains(), getReportList()]);
        if (cancelled) return;
        setTableCandidates((Array.isArray(tables) ? tables : []).map(normalizeTableCandidate));
        setIndicatorCandidates((Array.isArray(indicators) ? indicators : []).map(normalizeIndicatorCandidate));
        setDomains((Array.isArray(domainItems) ? domainItems : []).map((item) => item.name).filter(Boolean));
        setReportOptionSets(buildReportOptionSets(reportItems));
        const peopleValues = [
          ...(Array.isArray(reportItems) ? reportItems : []).flatMap((item) => [item.ownerName, item.maintainerName]),
          ...(Array.isArray(tables) ? tables : []).map((item) => item.owner),
        ].filter((item): item is string => Boolean(item && item.trim()));
        setPeople([...new Set(peopleValues)].sort((a, b) => a.localeCompare(b, "zh-CN")));
      } catch (error: unknown) {
        if (cancelled) return;
        setTableCandidates([]);
        setIndicatorCandidates([]);
        setRefError(error instanceof Error ? error.message : "关联资产加载失败。");
      } finally {
        if (!cancelled) setRefLoading(false);
      }
    }

    void loadReferences();
    return () => {
      cancelled = true;
    };
  }, []);

  const errors = touched ? validateForm(form) : [];

  const setValues = (nextValues: Partial<ReportFormData>) => {
    if (saveError) onClearSaveError?.();
    setForm((prev) => ({ ...prev, ...nextValues }));
  };

  const setValue = <K extends keyof ReportFormData>(key: K, value: ReportFormData[K]) => {
    setValues({ [key]: value });
  };

  const tableOptions = React.useMemo(() => {
    const keyword = tableSearch.trim().toLowerCase();
    const selected = new Set(form.relatedTables.map((item) => item.tableName));
    return tableCandidates.filter((item) => {
      if (selected.has(item.tableName)) return false;
      if (!keyword) return true;
      return [item.tableName, item.tableCn, item.domain, item.layer]
        .some((value) => String(value || "").toLowerCase().includes(keyword));
    }).slice(0, 20);
  }, [form.relatedTables, tableCandidates, tableSearch]);

  const indicatorOptions = React.useMemo(() => {
    const keyword = indicatorSearch.trim().toLowerCase();
    const selected = new Set(form.relatedIndicators.map((item) => item.indicatorId));
    return indicatorCandidates.filter((item) => {
      if (selected.has(item.indicatorId)) return false;
      if (!keyword) return true;
      return [item.indicatorId, item.indicatorName, item.path, item.dimension]
        .some((value) => String(value || "").toLowerCase().includes(keyword));
    }).slice(0, 20);
  }, [form.relatedIndicators, indicatorCandidates, indicatorSearch]);

  const addRelatedTable = (item: RelatedTableSummary) => {
    setValues({ relatedTables: [...form.relatedTables, item] });
  };

  const removeRelatedTable = (tableName: string) => {
    setValues({ relatedTables: form.relatedTables.filter((item) => item.tableName !== tableName) });
  };

  const addRelatedIndicator = (item: RelatedIndicatorSummary) => {
    setValues({ relatedIndicators: [...form.relatedIndicators, item] });
  };

  const removeRelatedIndicator = (indicatorId: string) => {
    setValues({ relatedIndicators: form.relatedIndicators.filter((item) => item.indicatorId !== indicatorId) });
  };

  const submit = () => {
    setTouched(true);
    const nextErrors = validateForm(form);
    if (nextErrors.length || saveBusy) return;

    void onSave({
      code: form.code.trim().toUpperCase(),
      name: form.name.trim(),
      alias: form.alias.trim(),
      type: form.type.trim(),
      domain: form.domain.trim(),
      freq: form.freq.trim(),
      statPeriod: form.statPeriod.trim(),
      dateCaliber: form.statCaliber.trim(),
      dateCaliberOther: "",
      dataTimeliness: form.dataDelay.trim(),
      dataTimelinessCustom: "",
      statCaliber: form.statCaliber.trim(),
      dataDelay: form.dataDelay.trim(),
      businessScopeTags: form.businessScopeTags.trim(),
      status: form.status,
      effectiveDate: form.effectiveDate.trim(),
      expireDate: form.expireDate.trim(),
      purpose: form.purpose.trim(),
      statObject: form.statObject.trim(),
      statScope: form.businessScopeTags.trim(),
      timeCaliber: form.statCaliber.trim(),
      filterCondition: form.filterCondition.trim(),
      specialRule: form.specialRule.trim(),
      ownerDept: form.ownerDept.trim(),
      ownerName: form.ownerName.trim(),
      maintainerName: form.maintainerSameAsOwner ? form.ownerName.trim() : form.maintainerName.trim(),
      relatedTables: form.relatedTables,
      relatedIndicators: form.relatedIndicators,
      remark: form.remark.trim(),
      updatedBy: initial?.updatedBy || "",
      updatedAt: initial?.updatedAt || "",
    });
  };

  return (
    <div>
      <PageHeader
        breadcrumbs={[
          { label: "报表资产", onClick: onCancel },
          { label: isEdit ? "编辑报表" : "新增报表" },
        ]}
        icon={isEdit ? "edit" : "plus"}
        title={isEdit ? "编辑报表" : "新增报表"}
        subtitle={isEdit ? form.code : "登记新的报表台账并维护归属信息和关联引用。"}
      />

      <ActionErrorBanner title="保存失败" message={saveError} />
      <ActionErrorBanner title="请先修正以下问题" messages={errors} />

      <div className="form-card">
        <h3><Icon name="hash" size={14} />基本信息</h3>
        <div className="form-grid">
          <div className="fl">
            <label>报表编码</label>
            <input className={`inp mono${touched && !form.code.trim() ? " invalid" : ""}`} value={form.code} onChange={(event) => setValue("code", event.target.value)} placeholder="例如：RPT_PAY_DAILY" />
          </div>
          <div className="fl">
            <label>报表名称</label>
            <input className={`inp${touched && !form.name.trim() ? " invalid" : ""}`} value={form.name} onChange={(event) => setValue("name", event.target.value)} placeholder="例如：支付交易日报" />
          </div>
          <div className="fl">
            <label>报表别名</label>
            <input className="inp" value={form.alias} onChange={(event) => setValue("alias", event.target.value)} placeholder="例如：支付日结报表" />
          </div>
          <div className="fl">
            <label>报表类型</label>
            <select className={`sel${touched && !form.type.trim() ? " invalid" : ""}`} value={form.type} onChange={(event) => setValue("type", event.target.value)}>
              <option value="">请选择报表类型</option>
              {getLegacyAwareOptions(normalizeDictOptions(reportTypeOptions), form.type).map((item) => <option key={item.value} value={item.value}>{item.name}</option>)}
            </select>
          </div>
          <div className="fl">
            <label>状态</label>
            <BinaryStatusToggle mode="status" value={form.status} onChange={(value) => setValue("status", normalizeStatus(value))} />
          </div>
        </div>
      </div>

      <div className="form-card">
        <h3><Icon name="user" size={14} />业务归属</h3>
        <div className="form-grid">
          <div className="fl">
            <label>主题域</label>
            <select className={`sel${touched && !form.domain.trim() ? " invalid" : ""}`} value={form.domain} onChange={(event) => setValue("domain", event.target.value)}>
              <option value="">请选择主题域</option>
              {[...new Set([...domains, ...(form.domain ? [form.domain] : [])])].map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </div>
          <div className="fl">
            <label>归属部门</label>
            <select className={`sel${touched && !form.ownerDept.trim() ? " invalid" : ""}`} value={form.ownerDept} onChange={(event) => setValue("ownerDept", event.target.value)}><option value="">请选择归属部门</option>{getLegacyAwareOptions(normalizeDictOptions(departmentOptions), form.ownerDept).map((item) => <option key={item.value} value={item.value}>{item.name}</option>)}</select>
          </div>
          <div className="fl">
            <label>负责人</label>
            <input className={`inp${touched && !form.ownerName.trim() ? " invalid" : ""}`} list="report-person-options" value={form.ownerName} onChange={(event) => setValues({ ownerName: event.target.value, ...(form.maintainerSameAsOwner ? { maintainerName: event.target.value } : {}) })} placeholder="搜索已有负责人" />
          </div>
          <div className="fl">
            <label><input type="checkbox" checked={!form.maintainerSameAsOwner} onChange={(event) => setValues({ maintainerSameAsOwner: !event.target.checked, maintainerName: event.target.checked ? form.maintainerName : form.ownerName })} /> 维护人不同</label>
            {!form.maintainerSameAsOwner ? <input className="inp" list="report-person-options" value={form.maintainerName} onChange={(event) => setValue("maintainerName", event.target.value)} placeholder="搜索已有维护人" /> : <div className="match-hint">维护人同负责人</div>}
          </div>
        </div>
      </div>

      <div className="form-card">
        <h3><Icon name="book" size={14} />统计口径</h3>
        <div className="form-grid">
          <div className="fl">
            <label>统计对象</label>
            <input className="inp" value={form.statObject} onChange={(event) => setValue("statObject", event.target.value)} placeholder="例如：全行支付交易" />
          </div>
          <div className="fl">
            <label>统计周期</label>
            <select className={`sel${touched && !form.statPeriod ? " invalid" : ""}`} value={form.statPeriod} onChange={(event) => setValue("statPeriod", event.target.value)}><option value="">请选择统计周期</option>{getLegacyAwareOptions(normalizeDictOptions(periodOptions), form.statPeriod).map((item) => <option key={item.value} value={item.value}>{item.name}</option>)}</select>
          </div>
          <div className="fl full">
            <label>统计口径</label>
            <DictInput value={form.statCaliber} onChange={(value) => setValue("statCaliber", value)} options={statCaliberOptions} listId="report-stat-caliber-options" invalid={touched && !form.statCaliber.trim()} placeholder="请选择或输入统计口径" />
          </div>
          <details className="fl full">
            <summary>更多设置（数据延迟、业务范围标签）</summary>
            <div className="form-grid" style={{ marginTop: 12 }}>
              <div className="fl"><label>数据延迟（选填）</label><DictInput value={form.dataDelay} onChange={(value) => setValue("dataDelay", value)} options={dataDelayOptions} listId="report-data-delay-options" placeholder="请选择或输入数据延迟" /></div>
              <div className="fl full"><label>业务范围标签（选填）</label><input className="inp" value={form.businessScopeTags} onChange={(event) => setValue("businessScopeTags", event.target.value)} placeholder="例如：微信、支付宝、银联渠道" /></div>
            </div>
          </details>
        </div>
      </div>

      <div className="form-card">
        <h3><Icon name="info" size={14} />补充信息</h3>
        <div className="form-grid">
          <div className="fl full"><label>报表说明</label><textarea className="ta" value={form.purpose} onChange={(event) => setValue("purpose", event.target.value)} placeholder="描述报表的业务用途和使用对象。" /></div>
          <div className="fl full"><label>过滤条件</label><textarea className="ta" value={form.filterCondition} onChange={(event) => setValue("filterCondition", event.target.value)} placeholder="补充取数过滤条件。" /></div>
          <div className="fl full"><label>特殊规则</label><textarea className="ta" value={form.specialRule} onChange={(event) => setValue("specialRule", event.target.value)} placeholder="补充特殊业务规则或统计说明。" /></div>
          <div className="fl full"><label>备注</label><textarea className="ta" value={form.remark} onChange={(event) => setValue("remark", event.target.value)} placeholder="补充维护备注。" /></div>
        </div>
      </div>

      <details className="form-card">
        <summary><Icon name="calendar" size={14} />更多设置 / 生命周期</summary>
        <div className="form-grid" style={{ marginTop: 16 }}>
          <div className="fl"><label>生效日期（选填）</label><input type="date" className={`inp mono${touched && form.effectiveDate.trim() && !DATE_RE.test(form.effectiveDate.trim()) ? " invalid" : ""}`} value={form.effectiveDate} onChange={(event) => setValue("effectiveDate", event.target.value)} /></div>
          <div className="fl"><label>失效日期（选填）</label><input type="date" className={`inp mono${touched && form.expireDate.trim() && !DATE_RE.test(form.expireDate.trim()) ? " invalid" : ""}`} value={form.expireDate} min={form.effectiveDate || undefined} onChange={(event) => setValue("expireDate", event.target.value)} /></div>
        </div>
      </details>

      <datalist id="report-person-options">{people.map((name) => <option key={name} value={name} />)}</datalist>

      <div className="form-card">
        <h3><Icon name="link" size={14} />关联引用</h3>
        {refError ? <div className="match-hint" style={{ color: "var(--danger)" }}>{refError}</div> : null}
        {refLoading ? <div className="match-hint">正在加载可关联资产…</div> : null}
        <div className="report-picker-grid">
          <AssetReferencePicker
            title="关联表"
            searchValue={tableSearch}
            onSearchChange={setTableSearch}
            candidates={tableOptions}
            selectedItems={form.relatedTables}
            itemKey="tableName"
            titleKey="tableName"
            subtitleBuilder={(item) => [item.layer, item.domain, item.tableCn].filter(Boolean).join(" / ")}
            onAdd={addRelatedTable}
            onRemove={removeRelatedTable}
            emptyText="未找到可添加的表"
          />
          <AssetReferencePicker
            title="关联指标"
            searchValue={indicatorSearch}
            onSearchChange={setIndicatorSearch}
            candidates={indicatorOptions}
            selectedItems={form.relatedIndicators}
            itemKey="indicatorId"
            titleKey="indicatorId"
            subtitleBuilder={(item) => [item.indicatorName, item.path].filter(Boolean).join(" / ")}
            onAdd={addRelatedIndicator}
            onRemove={removeRelatedIndicator}
            emptyText="未找到可添加的指标"
          />
        </div>
      </div>

      <FormActionBar
        note={isEdit ? "保存后会更新报表台账、归属信息和关联引用。" : "保存后会加入报表资产清单，可继续维护详情。"}
        onCancel={onCancel}
        onSave={submit}
        saving={saveBusy}
        isDirty={isDirty}
        saveText={isEdit ? "保存修改" : "创建报表"}
      />
      {isEdit && initial ? (
        <DangerZone
          description="删除报表后将无法恢复，相关历史引用仍会保留。若报表暂时不再使用，建议优先禁用。"
          actions={[
            {
              key: "delete-report",
              label: "删除报表",
              icon: "trash",
              danger: true,
              onClick: () => onDelete(initial.code),
            },
          ]}
        />
      ) : null}
    </div>
  );
}
