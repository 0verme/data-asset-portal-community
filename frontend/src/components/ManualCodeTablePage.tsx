import { useLayoutEffect, useMemo, useRef } from "react";

import type { UseManualCodeTableModuleResult } from "../hooks/useManualCodeTableModule.ts";
import {
  MANUAL_CODE_TABLE_STATUS_META,
  MANUAL_CODE_TABLE_STYLES,
} from "../hooks/useManualCodeTableModule.ts";
import { formatDateTime } from "../utils/date.ts";
import { formFieldErrorEntries } from "../utils/formFieldErrorMapping.ts";
import {
  DangerZone,
  EmptyState,
  ErrorState,
  FormModal,
  FormSection,
  LoadingState,
  PageHeader,
  RowActions,
  StatusBadge,
  WideTableScroll,
  confirmDeleteAction,
} from "./common/index.ts";
import { Highlight, Icon } from "./ui.tsx";
import { Button, IconButton, Input, Select, TablePagination, Textarea } from "../ui/index.ts";
import { FormErrorSummary, FormField } from "../ui/FormErrors.tsx";
import { focusFirstFormError } from "../ui/formErrors.ts";

const STYLE_LABELS: Record<string, string> = Object.fromEntries(MANUAL_CODE_TABLE_STYLES.map((item) => [item.value, item.label]));
const MANUAL_CODE_TABLE_FORM_ID = "manual-code-table-form";
const MANUAL_CODE_TABLE_FIELD_LABELS: Readonly<Record<string, string>> = {
  tableCode: "表编码",
  tableName: "表名称",
  style: "表样式",
  owner: "负责人",
  status: "状态",
  remark: "说明",
};

interface CodeTableFormProps {
  module: UseManualCodeTableModuleResult;
}

function CodeTableForm({ module }: CodeTableFormProps) {
  const { form, setForm, formErrors, formModal, errorFocusRevision, clearFieldError } = module;
  const fieldErrors = useMemo(() => formFieldErrorEntries(formErrors), [formErrors]);
  const formRef = useRef<HTMLDivElement>(null);
  const previousFocusRevision = useRef(errorFocusRevision);
  useLayoutEffect(() => {
    if (previousFocusRevision.current === errorFocusRevision) return;
    previousFocusRevision.current = errorFocusRevision;
    focusFirstFormError(formRef.current, fieldErrors, "auto");
  }, [errorFocusRevision, fieldErrors]);

  return (
    <div id={MANUAL_CODE_TABLE_FORM_ID} ref={formRef}>
      <FormErrorSummary
        formId={MANUAL_CODE_TABLE_FORM_ID}
        errors={fieldErrors}
        getFieldLabel={(field) => MANUAL_CODE_TABLE_FIELD_LABELS[field] || "表单内容"}
      />
      <FormSection title="码表信息">
        <div className="form-grid">
          <FormField className="fl" formId={MANUAL_CODE_TABLE_FORM_ID} name="tableCode" label="表编码" error={fieldErrors["tableCode"]}>
            <Input aria-label="表编码" className={`inp mono${fieldErrors["tableCode"] ? " invalid" : ""}`} value={form.tableCode} onChange={(event) => {
              clearFieldError("tableCode");
              setForm((current) => ({ ...current, tableCode: event.target.value.toUpperCase() }));
            }} placeholder="例如：DIM_GENDER" maxLength={64} />
          </FormField>
          <FormField className="fl" formId={MANUAL_CODE_TABLE_FORM_ID} name="tableName" label="表名称" error={fieldErrors["tableName"]}>
            <Input aria-label="表名称" className={`inp${fieldErrors["tableName"] ? " invalid" : ""}`} value={form.tableName} onChange={(event) => {
              clearFieldError("tableName");
              setForm((current) => ({ ...current, tableName: event.target.value }));
            }} placeholder="例如：性别字典" maxLength={128} />
          </FormField>
          <FormField className="fl" formId={MANUAL_CODE_TABLE_FORM_ID} name="style" label="表样式" error={fieldErrors["style"]}>
            <Select<string> aria-label="表样式" placeholder="请选择表样式" className={`inp${fieldErrors["style"] ? " invalid" : ""}`} items={[{ label: "请选择表样式", value: "" }, ...MANUAL_CODE_TABLE_STYLES.map((item) => ({ label: item.label, value: item.value }))]} value={form.style || null} onValueChange={(value) => {
              clearFieldError("style");
              setForm((current) => ({ ...current, style: value || "" }));
            }} />
          </FormField>
          <FormField className="fl" formId={MANUAL_CODE_TABLE_FORM_ID} name="owner" label="负责人" error={fieldErrors["owner"]}>
            <Input aria-label="负责人" className={`inp${fieldErrors["owner"] ? " invalid" : ""}`} value={form.owner} onChange={(event) => {
              clearFieldError("owner");
              setForm((current) => ({ ...current, owner: event.target.value }));
            }} placeholder="例如：张敏" maxLength={64} />
          </FormField>
          <FormField className="fl full" formId={MANUAL_CODE_TABLE_FORM_ID} name="status" label="状态" error={fieldErrors["status"]}>
            <Select<string> aria-label="状态" className={`inp${fieldErrors["status"] ? " invalid" : ""}`} items={[{ label: "启用", value: "enabled" }, { label: "禁用", value: "disabled" }]} value={form.status || null} onValueChange={(value) => {
              clearFieldError("status");
              setForm((current) => ({ ...current, status: value || current.status }));
            }} />
          </FormField>
          <FormField className="fl full" formId={MANUAL_CODE_TABLE_FORM_ID} name="remark" label="说明" error={fieldErrors["remark"]}>
            <Textarea aria-label="说明" className={`ta${fieldErrors["remark"] ? " invalid" : ""}`} value={form.remark} onChange={(event) => {
              clearFieldError("remark");
              setForm((current) => ({ ...current, remark: event.target.value }));
            }} placeholder="补充用途、引用场景或值结构约定" maxLength={1000} />
          </FormField>
        </div>
      </FormSection>
      {formModal.mode === "edit" && formModal.initial ? (
        <DangerZone
          description="删除后码表将从湖仓登记清单移除；若只是暂时下线，建议优先禁用。"
          actions={[{
            key: "delete-code-table", label: "删除码值表", icon: "trash", danger: true,
            onClick: async () => {
              if (await confirmDeleteAction({
                name: formModal.initial?.tableName,
                typeLabel: "手工码值表",
                impact: "删除后该码表的表级登记信息将不可恢复。",
                confirmKeyword: formModal.initial?.tableCode,
                confirmKeywordLabel: "请输入表编码二次确认",
              }) && formModal.initial) {
                module.remove(formModal.initial);
              }
            },
          }]}
        />
      ) : null}
    </div>
  );
}

interface CodeItemFormProps {
  module: UseManualCodeTableModuleResult;
}

function CodeItemForm({ module }: CodeItemFormProps) {
  const { codeItemForm: form, setCodeItemForm: setForm, codeItemFormErrors: formErrors,
    codeItemErrorFocusRevision, clearCodeItemFormError: clearFieldError } = module;
  const fieldErrors = useMemo(() => formFieldErrorEntries(formErrors), [formErrors]);
  const formRef = useRef<HTMLDivElement>(null);
  const previousFocusRevision = useRef(codeItemErrorFocusRevision);
  const formId = "manual-code-value-form";
  useLayoutEffect(() => {
    if (previousFocusRevision.current === codeItemErrorFocusRevision) return;
    previousFocusRevision.current = codeItemErrorFocusRevision;
    focusFirstFormError(formRef.current, fieldErrors, "auto");
  }, [codeItemErrorFocusRevision, fieldErrors]);

  return (
    <div id={formId} ref={formRef}>
      <FormSection title="码值条目信息">
        <FormErrorSummary formId={formId} errors={fieldErrors} getFieldLabel={(field) => ({ code: "条目编码", label: "条目名称", description: "说明", status: "状态" }[field] || "表单内容")} />
        <div className="form-grid">
          <FormField className="fl" formId={formId} name="code" label="条目编码" error={fieldErrors["code"]}>
            <Input aria-label="条目编码" className={`inp mono${fieldErrors["code"] ? " invalid" : ""}`} value={form.code} maxLength={64} onChange={(event) => { clearFieldError("code"); setForm((current) => ({ ...current, code: event.target.value.toUpperCase() })); }} placeholder="例如：ACTIVE" />
          </FormField>
          <FormField className="fl" formId={formId} name="label" label="条目名称" error={fieldErrors["label"]}>
            <Input aria-label="条目名称" className={`inp${fieldErrors["label"] ? " invalid" : ""}`} value={form.label} maxLength={128} onChange={(event) => { clearFieldError("label"); setForm((current) => ({ ...current, label: event.target.value })); }} placeholder="输入条目名称" />
          </FormField>
          <FormField className="fl full" formId={formId} name="description" label="说明" error={fieldErrors["description"]}>
            <Textarea aria-label="条目说明" className={`ta${fieldErrors["description"] ? " invalid" : ""}`} value={form.description} maxLength={512} onChange={(event) => { clearFieldError("description"); setForm((current) => ({ ...current, description: event.target.value })); }} placeholder="补充条目用途" />
          </FormField>
          <FormField className="fl full" formId={formId} name="status" label="状态" error={fieldErrors["status"]}>
            <Select<string> aria-label="条目状态" className={`inp${fieldErrors["status"] ? " invalid" : ""}`} items={[{ label: "启用", value: "enabled" }, { label: "禁用", value: "disabled" }]} value={form.status} onValueChange={(value) => { clearFieldError("status"); setForm((current) => ({ ...current, status: value || current.status })); }} />
          </FormField>
        </div>
      </FormSection>
      <div className="page-sub">条目写入现有码值条目存储，并归属当前码值表编码。</div>
    </div>
  );
}

interface CodeValueDetailModalProps {
  item: UseManualCodeTableModuleResult["codeItemDetail"];
  module: UseManualCodeTableModuleResult;
  canEdit: boolean;
}

function CodeValueDetailModal({ item, module, canEdit }: CodeValueDetailModalProps) {
  if (!item) return null;
  return (
    <FormModal open title="码值条目详情" subtitle={item.code} icon="table" onClose={() => module.setCodeItemDetail(null)} onSubmit={() => module.openEditCodeItem(item)} submitText="编辑" cancelText="关闭" busy={false} showSubmit={canEdit}>
      <div className="indicator-detail-grid">
        <div className="indicator-detail-item"><div className="indicator-detail-label">条目编码</div><div className="indicator-detail-value mono">{item.code}</div></div>
        <div className="indicator-detail-item"><div className="indicator-detail-label">条目名称</div><div className="indicator-detail-value">{item.label}</div></div>
        <div className="indicator-detail-item"><div className="indicator-detail-label">状态</div><div className="indicator-detail-value"><StatusBadge status={item.status} metaMap={MANUAL_CODE_TABLE_STATUS_META} /></div></div>
        <div className="indicator-detail-item"><div className="indicator-detail-label">更新时间</div><div className="indicator-detail-value mono">{formatDateTime(item.updatedAt)}</div></div>
        <div className="indicator-detail-item full"><div className="indicator-detail-label">说明</div><div className="indicator-detail-value">{item.description || "-"}</div></div>
      </div>
      {!canEdit ? <div className="page-sub">当前为只读访问。</div> : null}
      {canEdit ? <DangerZone description="仅删除确认后的这一条码值，不会删除所属码值表。" actions={[{
        key: "delete-code-value", label: "删除码值条目", icon: "trash", danger: true,
        onClick: async () => {
          if (await confirmDeleteAction({
            name: `${item.code} · ${item.label}`,
            typeLabel: "码值条目",
            impact: "删除后该条目将从所属码值组移除。",
            confirmKeyword: item.code,
            confirmKeywordLabel: "请输入条目编码二次确认",
          })) module.removeCodeItem(item);
        },
      }]} /> : null}
    </FormModal>
  );
}

function CodeTableDetailPage({ module, canEdit }: { module: UseManualCodeTableModuleResult; canEdit: boolean }) {
  const item = module.detailItem;
  if (!item) return null;
  return (
    <div className="asset-page code-table-page">
      <PageHeader back={{ onClick: module.closeDetail, text: "返回码值表列表" }} title={item.tableName} subtitle={item.tableCode} icon="table" />
      <div className="indicator-detail-grid">
        <div className="indicator-detail-item"><div className="indicator-detail-label">码值组 / 表编码</div><div className="indicator-detail-value mono">{item.tableCode}</div></div>
        <div className="indicator-detail-item"><div className="indicator-detail-label">表状态</div><div className="indicator-detail-value"><StatusBadge status={item.status} metaMap={MANUAL_CODE_TABLE_STATUS_META} /></div></div>
        <div className="indicator-detail-item"><div className="indicator-detail-label">条目总数</div><div className="indicator-detail-value">{module.codeItemGroupTotal}</div></div>
        <div className="indicator-detail-item"><div className="indicator-detail-label">表样式</div><div className="indicator-detail-value"><span className="tag tag-neutral">{STYLE_LABELS[item.style] || item.style}</span></div></div>
      </div>
      <div className="page-head">
        <div><div className="page-title">码值条目</div><div className="page-sub">条目按需分页读取；筛选结果 {module.codeItemTotal} 条 / 当前组共 {module.codeItemGroupTotal} 条。</div></div>
        {canEdit ? <div className="head-actions"><Button className="btn primary" variant="primary" type="button" onClick={module.openNewCodeItem}><Icon name="plus" size={15} />新增条目</Button></div> : null}
      </div>
      <div className="tbl-wrap code-table-list">
        <div className="field-toolbar">
          <Input aria-label="搜索码值条目" className="inp" value={module.codeItemQuery} onChange={(event) => module.setCodeItemQuery(event.target.value)} placeholder="搜索编码、名称或说明" />
          <Select<string> aria-label="码值条目状态筛选" className="inp" items={[{ label: "全部状态", value: "" }, { label: "启用", value: "enabled" }, { label: "禁用", value: "disabled" }]} value={module.codeItemStatus} onValueChange={(value) => module.setCodeItemStatus(value || "")} />
          <div className="ft-info" aria-live="polite">共 {module.codeItemTotal} 条匹配码值</div>
        </div>
        {module.codeItemLoading ? <LoadingState title="读取码值条目" desc="正在从码值库分页查询当前组的条目。" /> : null}
        {!module.codeItemLoading && module.codeItemError ? <ErrorState title="码值条目读取失败" desc={module.codeItemError} onRetry={module.loadCodeItems} /> : null}
        {!module.codeItemLoading && !module.codeItemError && !module.codeItems.length ? (
          <EmptyState
            title={module.codeItemGroupTotal === 0 ? "该码值组暂无条目" : "没有匹配的码值条目"}
            desc={module.codeItemGroupTotal === 0 ? "当前没有该组的码值明细。" : "调整搜索或状态筛选后重试。"}
            actionText={canEdit && module.codeItemGroupTotal === 0 ? "新增条目" : ""}
            onAction={canEdit && module.codeItemGroupTotal === 0 ? module.openNewCodeItem : undefined}
          />
        ) : null}
        {!module.codeItemLoading && !module.codeItemError && module.codeItems.length ? (
          <WideTableScroll ariaLabel="码值条目列表" className="manual-code-wide-scroll">
            <table className="dt mobile-card-table manual-code-wide-table">
              <thead><tr><th>条目编码</th><th>条目名称</th><th>说明</th><th>状态</th><th>操作</th></tr></thead>
              <tbody>{module.codeItems.map((codeItem) => (
                <tr key={codeItem.id}>
                  <td data-label="条目编码" className="mono"><Highlight text={codeItem.code} q={module.codeItemQuery} /></td>
                  <td data-label="条目名称"><Highlight text={codeItem.label} q={module.codeItemQuery} /></td>
                  <td data-label="说明"><Highlight text={codeItem.description || "-"} q={module.codeItemQuery} /></td>
                  <td data-label="状态"><StatusBadge status={codeItem.status} metaMap={MANUAL_CODE_TABLE_STATUS_META} /></td>
                  <td data-label="" className="mobile-card-actions"><RowActions
                    onView={() => { void module.openCodeItemDetail(codeItem); }}
                    onEdit={canEdit ? () => module.openEditCodeItem(codeItem) : undefined}
                    toggle={canEdit ? { enabled: codeItem.status === "enabled", label: codeItem.code, onToggle: () => module.changeCodeItemStatus(codeItem, codeItem.status === "enabled" ? "disabled" : "enabled") } : undefined}
                  /></td>
                </tr>
              ))}</tbody>
            </table>
          </WideTableScroll>
        ) : null}
        <TablePagination page={module.codeItemPage} pageSize={module.codeItemPageSize} total={module.codeItemTotal} onPageChange={module.setCodeItemPage} onPageSizeChange={module.setCodeItemPageSize} loading={module.codeItemLoading} ariaLabel="码值条目分页" />
      </div>
      <CodeValueDetailModal item={module.codeItemDetail} module={module} canEdit={canEdit} />
      <FormModal open={module.codeItemFormModal.open} title={module.codeItemFormModal.mode === "edit" ? "编辑码值条目" : "新增码值条目"} subtitle={item.tableCode} icon="table" onClose={module.closeCodeItemForm} onSubmit={module.submitCodeItem} submitText={module.codeItemFormModal.mode === "edit" ? "保存修改" : "创建条目"} cancelText="取消" busy={module.codeItemFormModal.busy}>
        <CodeItemForm module={module} />
      </FormModal>
    </div>
  );
}

export interface ManualCodeTablePageProps {
  module: UseManualCodeTableModuleResult;
  query: string;
  canEdit: boolean;
  canExport: boolean;
}

export function ManualCodeTablePage({ module, query, canEdit, canExport }: ManualCodeTablePageProps) {
  if (module.detailItem) return <CodeTableDetailPage module={module} canEdit={canEdit} />;
  if (module.loading) return <LoadingState title="加载码值表维护模块" desc="正在读取湖仓手工码值表登记信息。" />;
  if (module.error) return <ErrorState title="码值表加载失败" desc={module.error} onRetry={module.load} />;

  const stats: Array<[string, number]> = [
    ["码表总数", module.stats.total],
    ["启用", module.stats.enabled],
    ["禁用", module.stats.disabled],
    ["样式种类", module.stats.styleCount],
  ];
  const activeStyleLabel = MANUAL_CODE_TABLE_STYLES.find(
    (style) => style.value === module.styleFilter,
  )?.label;
  const activeStatusLabel = module.statusFilter
    ? MANUAL_CODE_TABLE_STATUS_META[module.statusFilter]?.label
    : null;

  return (
    <div className="asset-page code-table-page">
      <div className="page-head">
        <div>
          <div className="page-title"><span className="pt-code">CODE</span>码值表维护</div>
          <div className="page-sub">浏览码值表及其数据库条目；维护操作按码值表权限控制。</div>
        </div>
        <div className="head-actions">
          {canExport ? <Button className="btn" variant="secondary" type="button" onClick={module.exportCsv}><Icon name="download" size={15} />导出</Button> : null}
          {canEdit ? <Button className="btn primary" variant="primary" type="button" onClick={module.openNew}><Icon name="plus" size={15} />新增码值表</Button> : null}
        </div>
      </div>

      <div className="stat-row">{stats.map(([label, value]) => <div className="stat-card" key={label}><div className="sv">{value}</div><div className="sl">{label}</div></div>)}</div>

      <div className="tbl-wrap code-table-list">
        <div className="field-toolbar">
          {activeStyleLabel || activeStatusLabel ? (
            <div className="code-table-active-filters" aria-live="polite">
              {activeStyleLabel ? (
                <span className="chip-active">
                  样式：{activeStyleLabel}
                  <IconButton
                    type="button"
                    className="code-table-filter-clear"
                    size="sm"
                    variant="tertiary"
                    aria-label={`清除样式筛选：${activeStyleLabel}`}
                    icon={<Icon name="close" size={12} />}
                    onClick={() => module.setStyleFilter("")}
                  />
                </span>
              ) : null}
              {activeStatusLabel ? (
                <span className="chip-active">
                  状态：{activeStatusLabel}
                  <IconButton
                    type="button"
                    className="code-table-filter-clear"
                    size="sm"
                    variant="tertiary"
                    aria-label={`清除状态筛选：${activeStatusLabel}`}
                    icon={<Icon name="close" size={12} />}
                    onClick={() => module.setStatusFilter("")}
                  />
                </span>
              ) : null}
            </div>
          ) : null}
          <div className="ft-info">共 {module.total} 张匹配码表{query ? `，匹配“${query}”` : ""}</div>
        </div>
        {!module.filteredItems.length ? (
          <EmptyState title="暂无匹配的手工码值表" desc="请调整搜索或筛选条件，管理员也可以新增一张码值表。" actionText={canEdit ? "新增码值表" : ""} onAction={canEdit ? module.openNew : undefined} />
        ) : (
          <WideTableScroll ariaLabel="手工码值表列表" className="manual-code-wide-scroll">
            <table className="dt mobile-card-table manual-code-wide-table">
            <thead><tr><th>表编码</th><th>表名称</th><th>表样式</th><th>负责人</th><th>状态</th><th>更新时间</th><th>说明</th><th>操作</th></tr></thead>
            <tbody>{module.filteredItems.map((item) => (
              <tr key={item.id}>
                <td data-label="表编码" className="mono"><Highlight text={item.tableCode} q={query} /></td>
                <td data-label="表名称"><Highlight text={item.tableName} q={query} /></td>
                <td data-label="表样式"><span className="tag tag-neutral">{STYLE_LABELS[item.style] || item.style}</span></td>
                <td data-label="负责人"><Highlight text={item.owner || "-"} q={query} /></td>
                <td data-label="状态"><StatusBadge status={item.status} metaMap={MANUAL_CODE_TABLE_STATUS_META} /></td>
                <td data-label="更新时间" className="mono">{formatDateTime(item.updatedAt)}</td>
                <td data-label="说明"><span className="system-line-clamp"><Highlight text={item.remark || "-"} q={query} /></span></td>
                <td data-label="" className="mobile-card-actions">
                  <RowActions
                    onView={() => module.openDetail(item)}
                    onEdit={canEdit ? () => module.openEdit(item) : undefined}
                    toggle={canEdit ? { enabled: item.status === "enabled", label: item.tableName, onToggle: () => module.changeStatus(item, item.status === "enabled" ? "disabled" : "enabled") } : undefined}
                  />
                </td>
              </tr>
            ))}</tbody>
            </table>
          </WideTableScroll>
        )}
        <TablePagination
          page={module.page}
          pageSize={module.pageSize}
          total={module.total}
          onPageChange={module.setPage}
          onPageSizeChange={module.setPageSize}
          loading={module.loading}
          ariaLabel="码值表管理分页"
        />
      </div>

      <FormModal open={module.formModal.open} title={module.formModal.mode === "edit" ? "编辑码值表" : "新增码值表"} subtitle={module.formModal.mode === "edit" ? `正在编辑：${module.formModal.initial?.tableCode}` : "登记一张湖仓手工码值表"} icon="table" onClose={module.closeForm} onSubmit={module.submit} submitText={module.formModal.mode === "edit" ? "保存修改" : "创建"} busy={module.formModal.busy}>
        <CodeTableForm module={module} />
      </FormModal>
    </div>
  );
}
