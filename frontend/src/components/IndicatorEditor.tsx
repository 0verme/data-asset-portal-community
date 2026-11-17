import React from "react";

import { getAssetFields, getAssetTables, type AssetTableField, type AssetTableItem } from "../api/assets.ts";
import { getIndicatorPathTree } from "../api/indicator.ts";
import { useTranslation } from "react-i18next";
import {
  getIndicatorDimensionFromPath,
  normalizeIndicatorDimension,
  type IndicatorPathOptionNode,
} from "../data/indicatorPathOptions.ts";
import type { IndicatorSource, MockIndicatorItem } from "../data/indicators.ts";
import { buildModuleBreadcrumbs } from "../routing/navigation.ts";
import { ActionErrorBanner, BinaryStatusToggle, DangerZone, FormActionBar, PageHeader } from "./common/index.ts";
import IndicatorPathCascader, { type IndicatorPathChangeMeta } from "./IndicatorPathCascader.tsx";
import { Icon } from "./ui.tsx";
import {
  FormErrorSummary,
  FormField,
  focusFirstFormError,
  formFieldElementId,
  Input,
  Select,
  Textarea,
  type FormFieldErrors,
} from "../ui/index.ts";
import { validateIndicatorForm } from "./indicatorFormErrors.ts";

const INDICATOR_FORM_ID = "indicator-editor-form";
const INDICATOR_FIELD_LABELS: Readonly<Record<string, string>> = {
  id: "指标 ID",
  name: "指标中文名",
  registrar: "登记人",
  registeredAt: "登记日期",
  path: "指标路径",
};
const AGGREGATION_OPTIONS = ["SUM", "COUNT", "COUNT_DISTINCT", "AVG", "MIN", "MAX", "NONE"] as const;
const SEMANTIC_STATE_OPTIONS = [
  { value: "candidate", label: "候选" },
  { value: "certified", label: "已认证" },
  { value: "deprecated", label: "已废弃" },
] as const;

type AggregationValue = typeof AGGREGATION_OPTIONS[number];

interface IndicatorFormData {
  id: string;
  name: string;
  meaning: string;
  resultTableName: string;
  resultFieldName: string;
  sourceAssetId: number | null;
  sourceAssetName: string;
  sourceAssetQualifiedName: string;
  resultFieldId: number | null;
  sources: IndicatorSource[];
  aggregation: string;
  semanticState: string;
  dimension: string;
  caliber: string;
  caliberFormula: string;
  caliberSql: string;
  path: string;
  status: string;
  registrar: string;
  registeredAt: string;
}

function normalizeOptionalId(value: unknown): number | null {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const normalized = Number(value);
  return Number.isInteger(normalized) && normalized > 0 ? normalized : null;
}

function getAssetOptionId(asset: AssetTableItem): number | null {
  return normalizeOptionalId(asset.assetId ?? asset["asset_id"]);
}

function getFieldOptionId(field: AssetTableField): number | null {
  return normalizeOptionalId(field.fieldId);
}

function assetLabel(asset: AssetTableItem): string {
  const qualifiedName = String(asset["qualifiedName"] || asset["qualified_name"] || "");
  const schema = String(asset["schemaName"] || asset["schema_name"] || asset.schema || qualifiedName.split(".").slice(0, -1).join("."));
  return [asset.cn, schema, asset.name].filter(Boolean).join(" · ") || "未命名资产";
}

function fieldLabel(field: AssetTableField): string {
  return [field.cn, field.name].filter(Boolean).join(" · ") || "未命名字段";
}

function createDefaultForm(): IndicatorFormData {
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
    sources: [],
    aggregation: "",
    semanticState: "candidate",
    dimension: "",
    caliber: "",
    caliberFormula: "",
    caliberSql: "",
    path: "",
    status: "enabled",
    registrar: "",
    registeredAt: new Date().toISOString().slice(0, 10),
  };
}

function createFormState(initial: MockIndicatorItem | null | undefined): IndicatorFormData {
  const initialSources = Array.isArray(initial?.sources) && initial.sources.length
    ? initial.sources
    : initial?.sourceAssetId != null || initial?.resultFieldId != null
      ? [{
        assetId: normalizeOptionalId(initial.sourceAssetId),
        fieldId: normalizeOptionalId(initial.resultFieldId),
        tableName: String(initial.resultTableName || ""),
        schemaName: "",
        qualifiedName: String(initial.sourceAssetQualifiedName || ""),
        fieldName: String(initial.resultFieldName || ""),
        availability: "unknown" as const,
      }]
      : [];
  const next: IndicatorFormData = {
    ...createDefaultForm(),
    ...(initial || {}),
    sourceAssetId: normalizeOptionalId(initial?.sourceAssetId),
    sourceAssetName: String(initial?.sourceAssetName || ""),
    sourceAssetQualifiedName: String(initial?.sourceAssetQualifiedName || ""),
    resultFieldId: normalizeOptionalId(initial?.resultFieldId),
    sources: initialSources.map((source) => ({ ...source })),
    aggregation: String(initial?.aggregation || "").trim().toUpperCase(),
    semanticState: String(initial?.semanticState || "candidate").trim().toLowerCase() || "candidate",
  };
  const normalizedDimension = normalizeIndicatorDimension(next.dimension);
  const normalizedPath = String(next.path || "").trim();

  return {
    ...next,
    resultTableName: String(next.resultTableName || "").trim(),
    resultFieldName: String(next.resultFieldName || "").trim(),
    dimension: getIndicatorDimensionFromPath(normalizedPath) || normalizedDimension,
    // A path root may default to the upper-cased dimension code; the operator
    // can always pick a different root from the configured path tree.
    path: normalizedPath || (normalizedDimension ? normalizedDimension.toUpperCase() : ""),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseIndicatorPathOptions(items: readonly unknown[]): IndicatorPathOptionNode[] {
  return items.flatMap((item) => {
    if (!isRecord(item) || typeof item["label"] !== "string" || typeof item["value"] !== "string") return [];
    const children = Array.isArray(item["children"])
      ? parseIndicatorPathOptions(item["children"])
      : [];
    return [{
      label: item["label"],
      value: item["value"],
      ...(typeof item["pathLabel"] === "string" ? { pathLabel: item["pathLabel"] } : {}),
      ...(typeof item["dimension"] === "string" ? { dimension: item["dimension"] } : {}),
      ...(children.length ? { children } : {}),
    }];
  });
}

function normalizeStatus(value: string | boolean): string {
  return typeof value === "boolean" ? (value ? "enabled" : "disabled") : value;
}

export interface IndicatorEditorProps {
  mode: "new" | "edit";
  initial: MockIndicatorItem | null;
  onSave: (payload: MockIndicatorItem) => void | Promise<unknown>;
  onCancel: () => void;
  onDelete: (indicatorId?: string) => void | Promise<unknown>;
  saveBusy?: boolean | undefined;
  saveError?: string | undefined;
  onClearSaveError: () => void;
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
}: IndicatorEditorProps) {
  const { t } = useTranslation("common");
  const isEdit = mode === "edit";
  const [form, setForm] = React.useState<IndicatorFormData>(() => createFormState(initial));
  const [touched, setTouched] = React.useState(false);
  const formRef = React.useRef<HTMLDivElement>(null);
  const [validationFocusRequest, setValidationFocusRequest] = React.useState(0);
  const handledFocusRequestRef = React.useRef(0);
  const [pathOptions, setPathOptions] = React.useState<IndicatorPathOptionNode[]>([]);
  const [pathLoading, setPathLoading] = React.useState(false);
  const [pathError, setPathError] = React.useState("");
  const [assetOptions, setAssetOptions] = React.useState<AssetTableItem[]>([]);
  const [assetLoading, setAssetLoading] = React.useState(false);
  const [assetError, setAssetError] = React.useState("");
  const [fieldOptions, setFieldOptions] = React.useState<Record<number, AssetTableField[]>>({});
  const [fieldLoading, setFieldLoading] = React.useState(false);
  const [fieldError, setFieldError] = React.useState("");
  const [assetRetryRevision, setAssetRetryRevision] = React.useState(0);
  const [fieldRetryRevision, setFieldRetryRevision] = React.useState(0);
  const [pathRetryRevision, setPathRetryRevision] = React.useState(0);
  const initialSnapshotRef = React.useRef(JSON.stringify(form));
  const isDirty = initialSnapshotRef.current !== JSON.stringify(form);
  const sourceAssetIdKey = Array.from(new Set(form.sources.map((source) => source.assetId).filter((id): id is number => id !== null))).sort((a, b) => a - b).join(",");

  React.useEffect(() => {
    const nextForm = createFormState(initial);
    setForm(nextForm);
    setTouched(false);
    initialSnapshotRef.current = JSON.stringify(nextForm);
  }, [initial]);

  React.useEffect(() => {
    let cancelled = false;

    async function loadAssetOptions(): Promise<void> {
      setAssetLoading(true);
      setAssetError("");
      try {
        const items = await getAssetTables();
        if (!cancelled) {
          setAssetOptions(Array.isArray(items) ? items.filter((item) => getAssetOptionId(item) !== null) : []);
        }
      } catch (error: unknown) {
        if (!cancelled) {
          setAssetError(error instanceof Error ? error.message : "来源资产加载失败。");
        }
      } finally {
        if (!cancelled) setAssetLoading(false);
      }
    }

    void loadAssetOptions();
    return () => {
      cancelled = true;
    };
  }, [assetRetryRevision]);

  React.useEffect(() => {
    let cancelled = false;
    const assetIds = sourceAssetIdKey ? sourceAssetIdKey.split(",").map(Number) : [];
    if (!assetIds.length) {
      setFieldOptions({});
      setFieldError("");
      setFieldLoading(false);
      return undefined;
    }

    async function loadFieldOptions(): Promise<void> {
      setFieldLoading(true);
      setFieldError("");
      try {
        const entries = await Promise.all(assetIds.map(async (assetId) => [
          assetId,
          await getAssetFields({ assetId }),
        ] as const));
        if (!cancelled) {
          setFieldOptions(Object.fromEntries(entries.map(([assetId, items]) => [assetId, Array.isArray(items) ? items : []])));
        }
      } catch (error: unknown) {
        if (!cancelled) {
          setFieldError(error instanceof Error ? error.message : "来源资产字段加载失败。");
        }
      } finally {
        if (!cancelled) setFieldLoading(false);
      }
    }

    void loadFieldOptions();
    return () => {
      cancelled = true;
    };
  }, [sourceAssetIdKey, fieldRetryRevision]);

  React.useEffect(() => {
    let cancelled = false;

    async function loadPathOptions(): Promise<void> {
      setPathLoading(true);
      setPathError("");
      try {
        const items = await getIndicatorPathTree();
        if (!cancelled) setPathOptions(parseIndicatorPathOptions(items));
      } catch (error: unknown) {
        if (!cancelled) {
          setPathError(error instanceof Error ? error.message : "指标路径配置加载失败。");
        }
      } finally {
        if (!cancelled) setPathLoading(false);
      }
    }

    void loadPathOptions();
    return () => {
      cancelled = true;
    };
  }, [pathRetryRevision]);

  const errors: FormFieldErrors = React.useMemo(
    () => touched ? validateIndicatorForm(form) : {},
    [form, touched],
  );

  React.useLayoutEffect(() => {
    if (!validationFocusRequest || handledFocusRequestRef.current === validationFocusRequest) return;
    handledFocusRequestRef.current = validationFocusRequest;
    focusFirstFormError(formRef.current, errors, "auto");
  }, [errors, validationFocusRequest]);

  const setValues = (nextValues: Partial<IndicatorFormData>) => {
    if (saveError) onClearSaveError();
    setForm((prev) => ({ ...prev, ...nextValues }));
  };

  const setValue = <K extends keyof IndicatorFormData>(key: K, value: IndicatorFormData[K]) => {
    setValues({ [key]: value });
  };

  const fieldOptionsFor = (assetId: number | null) => assetId === null ? [] : fieldOptions[assetId] || [];

  const handlePathChange = (path: string, meta: IndicatorPathChangeMeta) => {
    setValues({
      path,
      dimension: meta.rootDimension || getIndicatorDimensionFromPath(path) || form.dimension,
    });
  };

  const handleSourceAssetChange = (index: number, value: string) => {
    const assetId = normalizeOptionalId(value);
    const selectedAsset = assetOptions.find((item) => getAssetOptionId(item) === assetId);
    const sources = form.sources.map((source, sourceIndex) => sourceIndex === index ? {
      ...source,
      assetId,
      fieldId: null,
      tableName: selectedAsset?.name || "",
      schemaName: String(selectedAsset?.["schemaName"] || selectedAsset?.["schema_name"] || ""),
      qualifiedName: String(selectedAsset?.["qualifiedName"] || selectedAsset?.["qualified_name"] || ""),
      fieldName: "",
      availability: "available" as const,
    } : source);
    const first = sources[0];
    setValues({
      sources,
      ...(index === 0 ? {
        sourceAssetId: first?.assetId || null,
        resultFieldId: first?.fieldId || null,
        resultTableName: first?.tableName || form.resultTableName,
        resultFieldName: first?.fieldName || "",
        sourceAssetName: first?.tableName || "",
        sourceAssetQualifiedName: first?.qualifiedName || "",
      } : {}),
    });
  };

  const handleSourceFieldChange = (index: number, value: string) => {
    const fieldId = normalizeOptionalId(value);
    const current = form.sources[index];
    const selectedField = fieldOptionsFor(current?.assetId || null).find((item) => getFieldOptionId(item) === fieldId);
    const sources = form.sources.map((source, sourceIndex) => sourceIndex === index ? {
      ...source,
      fieldId,
      fieldName: selectedField?.name || "",
      fieldCn: selectedField?.cn || "",
      availability: source.assetId ? "available" as const : "unknown" as const,
    } : source);
    const first = sources[0];
    setValues({
      sources,
      ...(index === 0 ? {
        sourceAssetId: first?.assetId || null,
        resultFieldId: first?.fieldId || null,
        resultTableName: first?.tableName || form.resultTableName,
        resultFieldName: first?.fieldName || "",
      } : {}),
    });
  };

  const pathFieldMarkerId = formFieldElementId(INDICATOR_FORM_ID, "path");
  const pathValidationErrorId = `${pathFieldMarkerId}-error`;
  const pathConfigErrorId = `${pathFieldMarkerId}-config-error`;
  const pathDescribedBy = [
    errors["path"] ? pathValidationErrorId : "",
    pathError ? pathConfigErrorId : "",
  ].filter(Boolean).join(" ") || undefined;

  const submit = () => {
    const nextErrors = validateIndicatorForm(form);
    setTouched(true);
    if (saveBusy) return;
    if (Object.keys(nextErrors).length) {
      setValidationFocusRequest((request) => request + 1);
      return;
    }

    const normalizedPath = form.path.trim();
    const derivedDimension = getIndicatorDimensionFromPath(normalizedPath) || normalizeIndicatorDimension(form.dimension);
    const aggregation = AGGREGATION_OPTIONS.includes(form.aggregation as AggregationValue)
      ? form.aggregation
      : null;

    void onSave({
      id: form.id.trim().toUpperCase(),
      name: form.name.trim(),
      meaning: form.meaning.trim(),
      resultTableName: form.resultTableName.trim(),
      resultFieldName: form.resultFieldName.trim(),
      sourceAssetId: form.sourceAssetId,
      sourceAssetName: form.sourceAssetName || null,
      sourceAssetQualifiedName: form.sourceAssetQualifiedName || null,
      resultFieldId: form.resultFieldId,
      sources: form.sources,
      aggregation,
      semanticState: form.semanticState || "candidate",
      dimension: derivedDimension,
      caliber: form.caliber.trim(),
      caliberFormula: form.caliberFormula.trim(),
      caliberSql: form.caliberSql.trim(),
      path: normalizedPath,
      status: form.status,
      registrar: form.registrar.trim(),
      registeredAt: form.registeredAt.trim(),
    });
  };

  return (
    <div id={INDICATOR_FORM_ID} ref={formRef}>
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
      <FormErrorSummary
        formId={INDICATOR_FORM_ID}
        errors={errors}
        getFieldLabel={(field) => INDICATOR_FIELD_LABELS[field] || "表单字段"}
      />

      <div className="form-card">
        <h3><Icon name="hash" size={14} />基本信息</h3>
        <div className="form-grid">
          <FormField className="fl" formId={INDICATOR_FORM_ID} name="id" label="指标 ID" error={errors["id"]}>
            <Input aria-label="指标 ID" className={`inp mono${errors["id"] ? " invalid" : ""}`} value={form.id} onChange={(event) => setValue("id", event.target.value)} placeholder="例如：CUST00001" />
          </FormField>
          <FormField className="fl" formId={INDICATOR_FORM_ID} name="name" label="指标中文名" error={errors["name"]}>
            <Input aria-label="指标中文名" className={`inp${errors["name"] ? " invalid" : ""}`} value={form.name} onChange={(event) => setValue("name", event.target.value)} placeholder="例如：会员复购率" />
          </FormField>
          <FormField className="fl" formId={INDICATOR_FORM_ID} name="registrar" label="登记人" error={errors["registrar"]}>
            <Input aria-label="登记人" className={`inp${errors["registrar"] ? " invalid" : ""}`} value={form.registrar} onChange={(event) => setValue("registrar", event.target.value)} placeholder="例如：何嘉佳" />
          </FormField>
          <FormField className="fl" formId={INDICATOR_FORM_ID} name="registeredAt" label="登记日期" error={errors["registeredAt"]}>
            <Input aria-label="登记日期" className={`inp mono${errors["registeredAt"] ? " invalid" : ""}`} value={form.registeredAt} onChange={(event) => setValue("registeredAt", event.target.value)} placeholder="例如：2025-06-17" />
          </FormField>
          <div className="fl">
            <label>状态</label>
            <BinaryStatusToggle mode="status" value={form.status} onChange={(value) => setValue("status", normalizeStatus(value))} />
          </div>
        </div>
      </div>

      <div className="form-card">
        <h3><Icon name="info" size={14} />口径信息</h3>
        <div className="form-grid">
          <div className="fl full">
            <label>指标含义</label>
            <Textarea aria-label="指标含义" className="ta" value={form.meaning} onChange={(event) => setValue("meaning", event.target.value)} placeholder="描述该指标的业务含义、取值逻辑和使用范围。" />
          </div>
          <div className="fl full">
            <label>来源表与字段（稳定引用）</label>
            {form.sources.map((source, index) => {
              const currentFields = fieldOptionsFor(source.assetId);
              const extraAsset = source.assetId !== null && !assetOptions.some((item) => getAssetOptionId(item) === source.assetId)
                ? [{ label: `${source.qualifiedName || [source.schemaName, source.tableName].filter(Boolean).join(".") || source.tableName}（当前关系不可解析）`, value: source.assetId }]
                : [];
              const extraField = source.fieldId !== null && !currentFields.some((item) => getFieldOptionId(item) === source.fieldId)
                ? [{ label: `${source.fieldName || "当前来源字段"}（当前关系不可解析）`, value: source.fieldId }]
                : [];
              return (
                <div className="form-grid" key={`${source.assetId || "new"}-${source.fieldId || "table"}-${index}`}>
                  <div className="fl">
                    <label htmlFor={`indicator-source-table-${index}`}>来源表 {index + 1}</label>
                    <Select<string | number>
                      aria-label={`来源表 ${index + 1}`}
                      className="inp"
                      disabled={assetLoading}
                      items={[
                        { label: "请选择来源表", value: "" },
                        ...extraAsset,
                        ...assetOptions.flatMap((asset) => {
                          const assetId = getAssetOptionId(asset);
                          return assetId === null ? [] : [{ label: assetLabel(asset), value: assetId }];
                        }),
                      ]}
                      value={source.assetId || ""}
                      placeholder="请选择来源表"
                      onValueChange={(value) => handleSourceAssetChange(index, value === null ? "" : String(value))}
                    />
                  </div>
                  <div className="fl">
                    <label htmlFor={`indicator-source-field-${index}`}>来源字段（可选）</label>
                    <Select<string | number>
                      aria-label={`来源字段 ${index + 1}`}
                      className="inp"
                      disabled={!source.assetId || fieldLoading}
                      items={[
                        { label: "整表来源 / 未指定字段", value: "" },
                        ...extraField,
                        ...currentFields.flatMap((field) => {
                          const fieldId = getFieldOptionId(field);
                          return fieldId === null ? [] : [{ label: fieldLabel(field), value: fieldId }];
                        }),
                      ]}
                      value={source.fieldId || ""}
                      placeholder="整表来源 / 未指定字段"
                      onValueChange={(value) => handleSourceFieldChange(index, value === null ? "" : String(value))}
                    />
                  </div>
                  <div className="fl full">
                    <button
                      className="btn"
                      type="button"
                      onClick={() => {
                        const sources = form.sources.filter((_, sourceIndex) => sourceIndex !== index);
                        const first = sources[0];
                        setValues({
                          sources,
                          sourceAssetId: first?.assetId || null,
                          resultFieldId: first?.fieldId || null,
                          resultTableName: first?.tableName || (sources.length ? "" : form.resultTableName),
                          resultFieldName: first?.fieldName || (sources.length ? "" : form.resultFieldName),
                          sourceAssetName: first?.tableName || "",
                          sourceAssetQualifiedName: first?.qualifiedName || "",
                        });
                      }}
                    >移除来源</button>
                  </div>
                </div>
              );
            })}
            <button
              className="btn"
              type="button"
              onClick={() => setValues({ sources: [...form.sources, {
                assetId: null,
                fieldId: null,
                tableName: "",
                schemaName: "",
                qualifiedName: "",
                fieldName: "",
                availability: "unknown",
              }] })}
            >添加来源表</button>
            {assetError ? (
              <div className="match-hint" role="alert" style={{ color: "var(--danger)" }}>
                {assetError}{" "}
                <button className="btn" type="button" onClick={() => setAssetRetryRevision((revision) => revision + 1)}>重试加载资产</button>
              </div>
            ) : null}
            {fieldError ? (
              <div className="match-hint" role="alert" style={{ color: "var(--danger)" }}>
                {fieldError}{" "}
                <button className="btn" type="button" onClick={() => setFieldRetryRevision((revision) => revision + 1)}>重试加载字段</button>
              </div>
            ) : null}
            {!assetLoading && !assetError && !assetOptions.length ? <div className="match-hint">当前数据源未提供稳定资产 ID，保留兼容文本录入。</div> : null}
          </div>
          {!form.sources.length ? <>
            <div className="fl">
              <label>结果表兼容快照</label>
              <Input aria-label="结果表兼容快照" className="inp mono" value={form.resultTableName} onChange={(event) => setValue("resultTableName", event.target.value)} placeholder="例如：dws.ads_indicator_result_di" />
            </div>
            <div className="fl">
              <label>结果字段兼容快照</label>
              <Input aria-label="结果字段兼容快照" className="inp mono" value={form.resultFieldName} onChange={(event) => setValue("resultFieldName", event.target.value)} placeholder="例如：first_loan_flag" />
            </div>
          </> : null}
          <div className="fl">
            <label>聚合方式</label>
            <Select<string> aria-label="聚合方式" className="inp mono" placeholder="未指定（兼容历史指标）" items={[{ label: "未指定（兼容历史指标）", value: "" }, ...AGGREGATION_OPTIONS.map((value) => ({ label: value, value }))]} value={form.aggregation || ""} onValueChange={(value) => setValue("aggregation", value || "")} />
          </div>
          <div className="fl">
            <label>语义生命周期</label>
            <Select<string> aria-label="语义生命周期" className="inp" items={SEMANTIC_STATE_OPTIONS.map((option) => ({ label: t(`catalog.indicator.lifecycle.${option.value}`), value: option.value }))} value={form.semanticState || null} onValueChange={(value) => setValue("semanticState", value || form.semanticState)} />
          </div>
          <div className="fl">
            <label>指标口径</label>
            <Input aria-label="指标口径" className="inp" value={form.caliber} onChange={(event) => setValue("caliber", event.target.value)} placeholder="例如：一表通口径" />
          </div>
          <div className="fl full">
            <label>口径公式</label>
            <Textarea aria-label="口径公式" className="ta mono" value={form.caliberFormula} onChange={(event) => setValue("caliberFormula", event.target.value)} placeholder="补充已确认的计算公式；未知时留空" />
          </div>
          <div className="fl full">
            <label>口径 SQL</label>
            <Textarea aria-label="口径 SQL" className="ta mono" value={form.caliberSql} onChange={(event) => setValue("caliberSql", event.target.value)} placeholder="补充已验证的查询 SQL；未知时留空" />
          </div>
          <div
            id={pathFieldMarkerId}
            className="fl"
            data-form-field="path"
            tabIndex={-1}
          >
            <label id={`${pathFieldMarkerId}-label`}>指标路径</label>
            <IndicatorPathCascader
              value={form.path}
              options={pathOptions}
              loading={pathLoading}
              error={pathError}
              onChange={handlePathChange}
              invalid={Boolean(errors["path"])}
              aria-invalid={errors["path"] ? "true" : undefined}
              aria-describedby={pathDescribedBy}
              aria-labelledby={`${pathFieldMarkerId}-label`}
            />
            {errors["path"] ? (
              <div id={pathValidationErrorId} className="match-hint" role="alert" style={{ color: "var(--danger)" }}>
                {errors["path"]}
              </div>
            ) : null}
            {pathError ? (
              <div id={pathConfigErrorId} className="match-hint" role="alert" style={{ color: "var(--danger)" }}>
                {pathError}{" "}
                <button className="btn" type="button" onClick={() => setPathRetryRevision((revision) => revision + 1)}>重试加载路径</button>
              </div>
            ) : null}
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
        saveText={isEdit ? "保存修改" : "创建指标"}
      />

      {isEdit && initial ? (
        <DangerZone
          description="删除指标后将无法恢复，相关历史引用仍会保留。若指标暂时不再使用，建议优先禁用。"
          actions={[
            {
              key: "delete-indicator",
              label: "删除指标",
              icon: "trash",
              danger: true,
              onClick: () => onDelete(initial.id),
            },
          ]}
        />
      ) : null}
    </div>
  );
}
