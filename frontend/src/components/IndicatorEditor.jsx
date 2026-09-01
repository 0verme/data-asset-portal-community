import React from "react";

import { getAssetFields, getAssetTables } from "../api/assets.js";
import { getIndicatorPathTree } from "../api/indicator.js";
import {
  getIndicatorDimensionFromPath,
  INDICATOR_DIMENSION_CODE_MAP,
  normalizeIndicatorDimension,
} from "../data/indicatorPathOptions.js";
import IndicatorPathCascader from "./IndicatorPathCascader.jsx";
import { ActionErrorBanner, BinaryStatusToggle, DangerZone, FormActionBar, PageHeader } from "./common/index.js";
import { buildModuleBreadcrumbs } from "../routing/navigation.ts";
import { Icon } from "./ui.jsx";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const AGGREGATION_OPTIONS = ["SUM", "COUNT", "COUNT_DISTINCT", "AVG", "MIN", "MAX", "NONE"];
const SEMANTIC_STATE_OPTIONS = [
  { value: "candidate", label: "候选" },
  { value: "certified", label: "已认证" },
  { value: "deprecated", label: "已废弃" },
];

function normalizeOptionalId(value) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const normalized = Number(value);
  return Number.isInteger(normalized) && normalized > 0 ? normalized : null;
}

function assetLabel(asset) {
  return [asset?.cn, asset?.name].filter(Boolean).join(" · ") || "未命名资产";
}

function fieldLabel(field) {
  return [field?.cn, field?.name].filter(Boolean).join(" · ") || "未命名字段";
}

function createDefaultForm() {
  return {
    id: "",
    name: "",
    meaning: "",
    resultTableName: "",
    resultFieldName: "",
    sourceAssetId: null,
    sourceAssetName: "",
    sourceAssetQualifiedName: "",
    resultFieldId: null,
    aggregation: "",
    semanticState: "candidate",
    dimension: "",
    caliber: "",
    path: "",
    status: "enabled",
    registrar: "",
    registeredAt: new Date().toISOString().slice(0, 10),
  };
}

function createFormState(initial) {
  const next = {
    ...createDefaultForm(),
    ...(initial || {}),
  };
  const normalizedDimension = normalizeIndicatorDimension(next.dimension);
  const normalizedPath = String(next.path || "").trim();

  return {
    ...next,
    resultTableName: String(next.resultTableName || "").trim(),
    resultFieldName: String(next.resultFieldName || "").trim(),
    sourceAssetId: normalizeOptionalId(next.sourceAssetId ?? next.source_asset_id),
    resultFieldId: normalizeOptionalId(next.resultFieldId ?? next.result_field_id),
    aggregation: String(next.aggregation || next.aggregationCode || next.aggregation_code || "").trim().toUpperCase(),
    semanticState: String(next.semanticState || next.semantic_state || "candidate").trim().toLowerCase() || "candidate",
    dimension: getIndicatorDimensionFromPath(normalizedPath) || normalizedDimension,
    path: normalizedPath || (normalizedDimension ? INDICATOR_DIMENSION_CODE_MAP[normalizedDimension] : ""),
  };
}

export function IndicatorEditor({
  mode,
  initial,
  onSave,
  onCancel,
  onDelete,
  saveBusy = false,
  saveError = "",
  onClearSaveError,
}) {
  const isEdit = mode === "edit";
  const [form, setForm] = React.useState(() => createFormState(initial));
  const [touched, setTouched] = React.useState(false);
  const [pathOptions, setPathOptions] = React.useState([]);
  const [pathLoading, setPathLoading] = React.useState(false);
  const [pathError, setPathError] = React.useState("");
  const [assetOptions, setAssetOptions] = React.useState([]);
  const [assetLoading, setAssetLoading] = React.useState(false);
  const [assetError, setAssetError] = React.useState("");
  const [fieldOptions, setFieldOptions] = React.useState([]);
  const [fieldLoading, setFieldLoading] = React.useState(false);
  const [fieldError, setFieldError] = React.useState("");
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

    async function loadAssetOptions() {
      setAssetLoading(true);
      setAssetError("");
      try {
        const items = await getAssetTables();
        if (!cancelled) {
          setAssetOptions(Array.isArray(items) ? items.filter((item) => normalizeOptionalId(item?.assetId ?? item?.asset_id)) : []);
        }
      } catch (error) {
        if (!cancelled) {
          setAssetOptions([]);
          setAssetError(error instanceof Error ? error.message : "来源资产加载失败。");
        }
      } finally {
        if (!cancelled) setAssetLoading(false);
      }
    }

    loadAssetOptions();
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    const selectedAsset = assetOptions.find((item) => normalizeOptionalId(item?.assetId ?? item?.asset_id) === form.sourceAssetId);
    if (!selectedAsset) {
      setFieldOptions([]);
      setFieldError("");
      setFieldLoading(false);
      return undefined;
    }

    async function loadFieldOptions() {
      setFieldLoading(true);
      setFieldError("");
      try {
        const items = await getAssetFields(selectedAsset.name);
        if (!cancelled) setFieldOptions(Array.isArray(items) ? items : []);
      } catch (error) {
        if (!cancelled) {
          setFieldOptions([]);
          setFieldError(error instanceof Error ? error.message : "来源资产字段加载失败。");
        }
      } finally {
        if (!cancelled) setFieldLoading(false);
      }
    }

    loadFieldOptions();
    return () => {
      cancelled = true;
    };
  }, [assetOptions, form.sourceAssetId]);

  React.useEffect(() => {
    let cancelled = false;

    async function loadPathOptions() {
      setPathLoading(true);
      setPathError("");
      try {
        const items = await getIndicatorPathTree();
        if (!cancelled) {
          setPathOptions(Array.isArray(items) ? items : []);
        }
      } catch (error) {
        if (!cancelled) {
          setPathOptions([]);
          setPathError(error instanceof Error ? error.message : "指标路径配置加载失败。");
        }
      } finally {
        if (!cancelled) {
          setPathLoading(false);
        }
      }
    }

    loadPathOptions();
    return () => {
      cancelled = true;
    };
  }, []);

  const errors = [];
  if (touched) {
    if (!form.id.trim()) errors.push("指标 ID 不能为空");
    if (!form.name.trim()) errors.push("指标中文名不能为空");
    if (!form.path.trim()) errors.push("指标路径不能为空");
    if (!form.registrar.trim()) errors.push("登记人不能为空");
    if (!DATE_RE.test(form.registeredAt.trim())) errors.push("登记日期必须使用 yyyy-mm-dd");
  }

  const setValues = (nextValues) => {
    if (saveError) onClearSaveError?.();
    setForm((prev) => ({ ...prev, ...nextValues }));
  };

  const setValue = (key, value) => {
    setValues({ [key]: value });
  };

  const handlePathChange = (path, meta) => {
    setValues({
      path,
      dimension: meta?.rootDimension || getIndicatorDimensionFromPath(path) || form.dimension,
    });
  };

  const handleAssetChange = (event) => {
    const sourceAssetId = normalizeOptionalId(event.target.value);
    const selectedAsset = assetOptions.find((item) => normalizeOptionalId(item?.assetId ?? item?.asset_id) === sourceAssetId);
    setValues({
      sourceAssetId,
      resultFieldId: null,
      resultTableName: selectedAsset?.name || form.resultTableName,
      resultFieldName: selectedAsset ? "" : form.resultFieldName,
      sourceAssetName: selectedAsset?.cn || selectedAsset?.name || "",
    });
  };

  const handleFieldChange = (event) => {
    const resultFieldId = normalizeOptionalId(event.target.value);
    const selectedField = fieldOptions.find((item) => normalizeOptionalId(item?.fieldId ?? item?.field_id) === resultFieldId);
    setValues({
      resultFieldId,
      resultFieldName: selectedField?.name || form.resultFieldName,
    });
  };

  const submit = () => {
    setTouched(true);
    if (errors.length || saveBusy) return;

    const normalizedPath = form.path.trim();
    const derivedDimension = getIndicatorDimensionFromPath(normalizedPath) || normalizeIndicatorDimension(form.dimension);

    onSave({
      id: form.id.trim().toUpperCase(),
      name: form.name.trim(),
      meaning: form.meaning.trim(),
      resultTableName: form.resultTableName.trim(),
      resultFieldName: form.resultFieldName.trim(),
      sourceAssetId: form.sourceAssetId,
      resultFieldId: form.resultFieldId,
      aggregation: form.aggregation || null,
      semanticState: form.semanticState || "candidate",
      dimension: derivedDimension,
      caliber: form.caliber.trim(),
      path: normalizedPath,
      status: form.status,
      registrar: form.registrar.trim(),
      registeredAt: form.registeredAt.trim(),
    });
  };

  return (
    <div>
      <PageHeader
        back={{ onClick: onCancel, text: isEdit ? "返回上一层" : "返回指标列表" }}
        breadcrumbs={buildModuleBreadcrumbs("indicator", [
          { label: isEdit ? "编辑指标" : "新增指标" },
        ], onCancel)}
        icon={isEdit ? "edit" : "plus"}
        title={isEdit ? "编辑指标" : "新增指标"}
        subtitle={isEdit ? form.id : "登记新的口径指标并纳入统一指标管理。"}
      />

      <ActionErrorBanner title="保存失败" message={saveError} />

      <ActionErrorBanner title="请先修正以下问题" messages={errors} />

      <div className="form-card">
        <h3><Icon name="hash" size={14} />基本信息</h3>
        <div className="form-grid">
          <div className="fl">
            <label>指标 ID</label>
            <input className={`inp mono${touched && !form.id.trim() ? " invalid" : ""}`} value={form.id} onChange={(event) => setValue("id", event.target.value)} placeholder="例如：CUST00001" />
          </div>
          <div className="fl">
            <label>指标中文名</label>
            <input className={`inp${touched && !form.name.trim() ? " invalid" : ""}`} value={form.name} onChange={(event) => setValue("name", event.target.value)} placeholder="例如：会员复购率" />
          </div>
          <div className="fl">
            <label>登记人</label>
            <input className={`inp${touched && !form.registrar.trim() ? " invalid" : ""}`} value={form.registrar} onChange={(event) => setValue("registrar", event.target.value)} placeholder="例如：何嘉佳" />
          </div>
          <div className="fl">
            <label>登记日期</label>
            <input className={`inp mono${touched && !DATE_RE.test(form.registeredAt.trim()) ? " invalid" : ""}`} value={form.registeredAt} onChange={(event) => setValue("registeredAt", event.target.value)} placeholder="例如：2025-06-17" />
          </div>
          <div className="fl">
            <label>状态</label>
            <BinaryStatusToggle mode="status" value={form.status} onChange={(value) => setValue("status", value)} />
          </div>
        </div>
      </div>

      <div className="form-card">
        <h3><Icon name="info" size={14} />口径信息</h3>
        <div className="form-grid">
          <div className="fl full">
            <label>指标含义</label>
            <textarea className="ta" value={form.meaning} onChange={(event) => setValue("meaning", event.target.value)} placeholder="描述该指标的业务含义、取值逻辑和使用范围。" />
          </div>
          <div className="fl">
            <label>来源资产（稳定引用）</label>
            <select className="inp" value={form.sourceAssetId || ""} onChange={handleAssetChange} disabled={assetLoading}>
              <option value="">未绑定稳定资产（保留兼容快照）</option>
              {form.sourceAssetId && !assetOptions.some((item) => normalizeOptionalId(item?.assetId ?? item?.asset_id) === form.sourceAssetId) ? (
                <option value={form.sourceAssetId}>{form.sourceAssetName || form.resultTableName || "当前来源资产"}</option>
              ) : null}
              {assetOptions.map((asset) => (
                <option key={asset.assetId} value={asset.assetId}>{assetLabel(asset)}</option>
              ))}
            </select>
            {assetError ? <div className="match-hint" style={{ color: "var(--danger)" }}>{assetError}</div> : null}
            {!assetLoading && !assetError && !assetOptions.length ? <div className="match-hint">当前数据源未提供稳定资产 ID，保留兼容文本录入。</div> : null}
          </div>
          <div className="fl">
            <label>结果字段（稳定引用）</label>
            <select className="inp" value={form.resultFieldId || ""} onChange={handleFieldChange} disabled={!form.sourceAssetId || fieldLoading}>
              <option value="">未绑定稳定字段（保留兼容快照）</option>
              {form.resultFieldId && !fieldOptions.some((item) => normalizeOptionalId(item?.fieldId ?? item?.field_id) === form.resultFieldId) ? (
                <option value={form.resultFieldId}>{form.resultFieldName || "当前结果字段"}</option>
              ) : null}
              {fieldOptions.map((field) => (
                <option key={field.fieldId} value={field.fieldId}>{fieldLabel(field)}</option>
              ))}
            </select>
            {fieldError ? <div className="match-hint" style={{ color: "var(--danger)" }}>{fieldError}</div> : null}
          </div>
          <div className="fl">
            <label>结果表兼容快照</label>
            <input
              className="inp mono"
              value={form.resultTableName}
              readOnly={Boolean(form.sourceAssetId)}
              onChange={(event) => setValue("resultTableName", event.target.value)}
              placeholder="例如：dws.ads_indicator_result_di"
            />
          </div>
          <div className="fl">
            <label>结果字段兼容快照</label>
            <input
              className="inp mono"
              value={form.resultFieldName}
              readOnly={Boolean(form.resultFieldId)}
              onChange={(event) => setValue("resultFieldName", event.target.value)}
              placeholder="例如：first_loan_flag"
            />
          </div>
          <div className="fl">
            <label>聚合方式</label>
            <select className="inp mono" value={form.aggregation} onChange={(event) => setValue("aggregation", event.target.value)}>
              <option value="">未指定（兼容历史指标）</option>
              {AGGREGATION_OPTIONS.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </div>
          <div className="fl">
            <label>语义生命周期</label>
            <select className="inp" value={form.semanticState} onChange={(event) => setValue("semanticState", event.target.value)}>
              {SEMANTIC_STATE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>
          <div className="fl">
            <label>指标口径</label>
            <input className="inp" value={form.caliber} onChange={(event) => setValue("caliber", event.target.value)} placeholder="例如：一表通口径" />
          </div>
          <div className="fl">
            <label>指标路径</label>
            <IndicatorPathCascader
              value={form.path}
              options={pathOptions}
              loading={pathLoading}
              error={pathError}
              onChange={handlePathChange}
              invalid={touched && !form.path.trim()}
            />
            {pathError ? <div className="match-hint" style={{ color: "var(--danger)" }}>{pathError}</div> : null}
            {!pathLoading && !pathError && form.path.trim() && !getIndicatorDimensionFromPath(form.path) ? (
              <div className="match-hint">
                当前保留原始路径文本，未匹配到级联配置；可直接保存，或重新选择规范路径。
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <FormActionBar
        note={isEdit ? "保存后会更新指标口径、状态和登记信息。" : "保存后会加入指标维护清单并可立即启用或禁用。"}
        onCancel={onCancel}
        onSave={submit}
        saving={saveBusy}
        isDirty={isDirty}
      />
      {isEdit ? (
        <DangerZone
          description="删除指标是高风险操作。若指标已被引用，应优先禁用而不是删除。"
          actions={[
            {
              key: "delete-indicator",
              label: "删除指标",
              icon: "trash",
              danger: true,
              onClick: onDelete,
              hint: "删除前将校验指标口径、来源字段、结果表字段、报表引用、血缘关系与审计记录。",
            },
          ]}
        />
      ) : null}
    </div>
  );
}

export default IndicatorEditor;
