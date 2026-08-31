import React from "react";

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

function createDefaultForm() {
  return {
    id: "",
    name: "",
    meaning: "",
    resultTableName: "",
    resultFieldName: "",
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
            <label>结果表</label>
            <input
              className="inp mono"
              value={form.resultTableName}
              onChange={(event) => setValue("resultTableName", event.target.value)}
              placeholder="例如：dws.ads_indicator_result_di"
            />
          </div>
          <div className="fl">
            <label>结果字段</label>
            <input
              className="inp mono"
              value={form.resultFieldName}
              onChange={(event) => setValue("resultFieldName", event.target.value)}
              placeholder="例如：first_loan_flag"
            />
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
