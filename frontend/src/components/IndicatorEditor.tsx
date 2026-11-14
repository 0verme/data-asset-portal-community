import React from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import { getAssetFields, getAssetTables, type AssetTableField, type AssetTableItem } from "../api/assets.ts";
import { getIndicatorPathTree } from "../api/indicator.ts";
import {
  getIndicatorDimensionFromPath,
  normalizeIndicatorDimension,
  type IndicatorPathOptionNode,
} from "../data/indicatorPathOptions.ts";
import type { MockIndicatorItem } from "../data/indicators.ts";
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
type IndicatorT = TFunction<"indicator">;
type IndicatorFieldLabelKey =
  | "editor.fields.id"
  | "editor.fields.name"
  | "editor.fields.registrar"
  | "editor.fields.registeredAt"
  | "editor.fields.path";
const INDICATOR_FIELD_LABEL_KEYS: Readonly<Record<string, IndicatorFieldLabelKey>> = {
  id: "editor.fields.id",
  name: "editor.fields.name",
  registrar: "editor.fields.registrar",
  registeredAt: "editor.fields.registeredAt",
  path: "editor.fields.path",
};
const AGGREGATION_OPTIONS = ["SUM", "COUNT", "COUNT_DISTINCT", "AVG", "MIN", "MAX", "NONE"] as const;
const SEMANTIC_STATE_VALUES = ["candidate", "certified", "deprecated"] as const;

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
  aggregation: string;
  semanticState: string;
  dimension: string;
  caliber: string;
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

function assetLabel(asset: AssetTableItem, t: IndicatorT): string {
  return [asset.cn, asset.name].filter(Boolean).join(" · ") || t("editor.asset.unnamed");
}

function fieldLabel(field: AssetTableField, t: IndicatorT): string {
  return [field.cn, field.name].filter(Boolean).join(" · ") || t("editor.field.unnamed");
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

function createFormState(initial: MockIndicatorItem | null | undefined): IndicatorFormData {
  const next: IndicatorFormData = {
    ...createDefaultForm(),
    ...(initial || {}),
    sourceAssetId: normalizeOptionalId(initial?.sourceAssetId),
    sourceAssetName: String(initial?.sourceAssetName || ""),
    sourceAssetQualifiedName: String(initial?.sourceAssetQualifiedName || ""),
    resultFieldId: normalizeOptionalId(initial?.resultFieldId),
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
  const { t } = useTranslation("indicator");
  const tRef = React.useRef(t);
  tRef.current = t;
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
  const [fieldOptions, setFieldOptions] = React.useState<AssetTableField[]>([]);
  const [fieldOptionsAssetId, setFieldOptionsAssetId] = React.useState<number | null>(null);
  const [fieldLoading, setFieldLoading] = React.useState(false);
  const [fieldError, setFieldError] = React.useState("");
  const [assetRetryRevision, setAssetRetryRevision] = React.useState(0);
  const [fieldRetryRevision, setFieldRetryRevision] = React.useState(0);
  const [pathRetryRevision, setPathRetryRevision] = React.useState(0);
  const initialSnapshotRef = React.useRef(JSON.stringify(form));
  const isDirty = initialSnapshotRef.current !== JSON.stringify(form);
  const currentFieldOptions = fieldOptionsAssetId === form.sourceAssetId ? fieldOptions : [];

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
          setAssetError(error instanceof Error ? error.message : tRef.current("editor.asset.loadError"));
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
    const selectedAsset = assetOptions.find((item) => getAssetOptionId(item) === form.sourceAssetId);
    const selectedAssetName = selectedAsset?.name || "";
    if (!selectedAssetName && !selectedAsset?.assetId) {
      setFieldOptions([]);
      setFieldOptionsAssetId(null);
      setFieldError("");
      setFieldLoading(false);
      return undefined;
    }

    async function loadFieldOptions(): Promise<void> {
      setFieldLoading(true);
      setFieldError("");
      try {
        const items = await getAssetFields({ assetId: selectedAsset?.assetId, tableName: selectedAssetName });
        if (!cancelled) {
          setFieldOptions(Array.isArray(items) ? items : []);
          setFieldOptionsAssetId(form.sourceAssetId);
        }
      } catch (error: unknown) {
        if (!cancelled) {
          setFieldError(error instanceof Error ? error.message : tRef.current("editor.field.loadError"));
        }
      } finally {
        if (!cancelled) setFieldLoading(false);
      }
    }

    void loadFieldOptions();
    return () => {
      cancelled = true;
    };
  }, [assetOptions, form.sourceAssetId, fieldRetryRevision]);

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
          setPathError(error instanceof Error ? error.message : tRef.current("editor.path.loadError"));
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
    () => touched ? validateIndicatorForm(form, t) : {},
    [form, t, touched],
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

  const handlePathChange = (path: string, meta: IndicatorPathChangeMeta) => {
    setValues({
      path,
      dimension: meta.rootDimension || getIndicatorDimensionFromPath(path) || form.dimension,
    });
  };

  const handleAssetChange = (value: string) => {
    const sourceAssetId = normalizeOptionalId(value);
    const selectedAsset = assetOptions.find((item) => getAssetOptionId(item) === sourceAssetId);
    setValues({
      sourceAssetId,
      resultFieldId: null,
      resultTableName: selectedAsset?.name || form.resultTableName,
      resultFieldName: selectedAsset ? "" : form.resultFieldName,
      sourceAssetName: selectedAsset?.cn || selectedAsset?.name || "",
    });
  };

  const handleFieldChange = (value: string) => {
    const resultFieldId = normalizeOptionalId(value);
    const selectedField = currentFieldOptions.find((item) => getFieldOptionId(item) === resultFieldId);
    setValues({
      resultFieldId,
      resultFieldName: selectedField?.name || form.resultFieldName,
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
    const nextErrors = validateIndicatorForm(form, t);
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
      aggregation,
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
    <div id={INDICATOR_FORM_ID} ref={formRef}>
      <PageHeader
        back={{ onClick: onCancel, text: isEdit ? t("editor.backLevel") : t("editor.backList") }}
        breadcrumbs={buildModuleBreadcrumbs("indicator", [
          { label: isEdit ? t("editor.edit") : t("editor.create") },
        ], onCancel).map((item, index) => index === 0 ? { ...item, label: t("moduleTitle") } : item)}
        icon={isEdit ? "edit" : "plus"}
        title={isEdit ? t("editor.edit") : t("editor.create")}
        subtitle={isEdit ? form.id : t("editor.newSubtitle")}
      />

      <ActionErrorBanner title={t("editor.saveError")} message={saveError} />
      <FormErrorSummary
        formId={INDICATOR_FORM_ID}
        errors={errors}
        title={t("editor.errorSummaryTitle")}
        getFieldLabel={(field) => INDICATOR_FIELD_LABEL_KEYS[field] ? t(INDICATOR_FIELD_LABEL_KEYS[field]) : t("editor.formField")}
      />

      <div className="form-card">
        <h3><Icon name="hash" size={14} />{t("editor.basicInfo")}</h3>
        <div className="form-grid">
          <FormField className="fl" formId={INDICATOR_FORM_ID} name="id" label={t("editor.fields.id")} error={errors["id"]}>
            <Input aria-label={t("editor.fields.id")} className={`inp mono${errors["id"] ? " invalid" : ""}`} value={form.id} onChange={(event) => setValue("id", event.target.value)} placeholder={t("editor.placeholders.id")} />
          </FormField>
          <FormField className="fl" formId={INDICATOR_FORM_ID} name="name" label={t("editor.fields.name")} error={errors["name"]}>
            <Input aria-label={t("editor.fields.name")} className={`inp${errors["name"] ? " invalid" : ""}`} value={form.name} onChange={(event) => setValue("name", event.target.value)} placeholder={t("editor.placeholders.name")} />
          </FormField>
          <FormField className="fl" formId={INDICATOR_FORM_ID} name="registrar" label={t("editor.fields.registrar")} error={errors["registrar"]}>
            <Input aria-label={t("editor.fields.registrar")} className={`inp${errors["registrar"] ? " invalid" : ""}`} value={form.registrar} onChange={(event) => setValue("registrar", event.target.value)} placeholder={t("editor.placeholders.registrar")} />
          </FormField>
          <FormField className="fl" formId={INDICATOR_FORM_ID} name="registeredAt" label={t("editor.fields.registeredAt")} error={errors["registeredAt"]}>
            <Input aria-label={t("editor.fields.registeredAt")} className={`inp mono${errors["registeredAt"] ? " invalid" : ""}`} value={form.registeredAt} onChange={(event) => setValue("registeredAt", event.target.value)} placeholder={t("editor.placeholders.registeredAt")} />
          </FormField>
          <div className="fl">
            <label>{t("editor.fields.status")}</label>
            <BinaryStatusToggle mode="status" ariaLabel={t("editor.fields.status")} labels={{ enabled: t("status.enabled"), disabled: t("status.disabled") }} value={form.status} onChange={(value) => setValue("status", normalizeStatus(value))} />
          </div>
        </div>
      </div>

      <div className="form-card">
        <h3><Icon name="info" size={14} />{t("editor.caliberInfo")}</h3>
        <div className="form-grid">
          <div className="fl full">
            <label>{t("editor.fields.meaning")}</label>
            <Textarea aria-label={t("editor.fields.meaning")} className="ta" value={form.meaning} onChange={(event) => setValue("meaning", event.target.value)} placeholder={t("editor.placeholders.meaning")} />
          </div>
          <div className="fl">
            <label>{t("editor.fields.sourceAsset")}</label>
            <Select<string | number>
              aria-label={t("editor.fields.sourceAsset")}
              className="inp"
              disabled={assetLoading}
              items={[
                { label: t("editor.asset.unbound"), value: "" },
                ...(form.sourceAssetId && !assetOptions.some((item) => getAssetOptionId(item) === form.sourceAssetId)
                  ? [{ label: form.sourceAssetName || form.resultTableName || t("editor.asset.currentFallback"), value: form.sourceAssetId }]
                  : []),
                ...assetOptions.flatMap((asset) => {
                  const assetId = getAssetOptionId(asset);
                  return assetId === null ? [] : [{ label: assetLabel(asset, t), value: assetId }];
                }),
              ]}
              value={form.sourceAssetId || ""}
              placeholder={t("editor.asset.unbound")}
              onValueChange={(value) => handleAssetChange(value === null ? "" : String(value))}
            />
            {assetError ? (
              <div className="match-hint" role="alert" style={{ color: "var(--danger)" }}>
                {assetError}{" "}
                <button className="btn" type="button" onClick={() => setAssetRetryRevision((revision) => revision + 1)}>{t("editor.asset.retry")}</button>
              </div>
            ) : null}
            {!assetLoading && !assetError && !assetOptions.length ? <div className="match-hint">{t("editor.asset.unavailable")}</div> : null}
          </div>
          <div className="fl">
            <label>{t("editor.fields.resultField")}</label>
            <Select<string | number>
              aria-label={t("editor.fields.resultField")}
              className="inp"
              disabled={!form.sourceAssetId || fieldLoading}
              items={[
                { label: t("editor.field.unbound"), value: "" },
                ...(form.resultFieldId && !currentFieldOptions.some((item) => getFieldOptionId(item) === form.resultFieldId)
                  ? [{ label: form.resultFieldName || t("editor.field.currentFallback"), value: form.resultFieldId }]
                  : []),
                ...currentFieldOptions.flatMap((field) => {
                  const fieldId = getFieldOptionId(field);
                  return fieldId === null ? [] : [{ label: fieldLabel(field, t), value: fieldId }];
                }),
              ]}
              value={form.resultFieldId || ""}
              placeholder={t("editor.field.unbound")}
              onValueChange={(value) => handleFieldChange(value === null ? "" : String(value))}
            />
            {fieldError ? (
              <div className="match-hint" role="alert" style={{ color: "var(--danger)" }}>
                {fieldError}{" "}
                <button className="btn" type="button" onClick={() => setFieldRetryRevision((revision) => revision + 1)}>{t("editor.field.retry")}</button>
              </div>
            ) : null}
          </div>
          <div className="fl">
            <label>{t("editor.fields.resultTableSnapshot")}</label>
            <Input
              aria-label={t("editor.fields.resultTableSnapshot")}
              className="inp mono"
              value={form.resultTableName}
              readOnly={Boolean(form.sourceAssetId)}
              onChange={(event) => setValue("resultTableName", event.target.value)}
              placeholder={t("editor.placeholders.resultTable")}
            />
          </div>
          <div className="fl">
            <label>{t("editor.fields.resultFieldSnapshot")}</label>
            <Input
              aria-label={t("editor.fields.resultFieldSnapshot")}
              className="inp mono"
              value={form.resultFieldName}
              readOnly={Boolean(form.resultFieldId)}
              onChange={(event) => setValue("resultFieldName", event.target.value)}
              placeholder={t("editor.placeholders.resultField")}
            />
          </div>
          <div className="fl">
            <label>{t("editor.fields.aggregation")}</label>
            <Select<string> aria-label={t("editor.fields.aggregation")} className="inp mono" placeholder={t("editor.placeholders.aggregation")} items={[{ label: t("editor.placeholders.aggregation"), value: "" }, ...AGGREGATION_OPTIONS.map((value) => ({ label: value, value }))]} value={form.aggregation || ""} onValueChange={(value) => setValue("aggregation", value || "")} />
          </div>
          <div className="fl">
            <label>{t("editor.fields.semanticState")}</label>
            <Select<string> aria-label={t("editor.fields.semanticState")} className="inp" items={SEMANTIC_STATE_VALUES.map((value) => ({ label: t(`editor.semanticStates.${value}`), value }))} value={form.semanticState || null} onValueChange={(value) => setValue("semanticState", value || form.semanticState)} />
          </div>
          <div className="fl">
            <label>{t("editor.fields.caliber")}</label>
            <Input aria-label={t("editor.fields.caliber")} className="inp" value={form.caliber} onChange={(event) => setValue("caliber", event.target.value)} placeholder={t("editor.placeholders.caliber")} />
          </div>
          <div
            id={pathFieldMarkerId}
            className="fl"
            data-form-field="path"
            tabIndex={-1}
          >
            <label id={`${pathFieldMarkerId}-label`}>{t("editor.fields.path")}</label>
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
                <button className="btn" type="button" onClick={() => setPathRetryRevision((revision) => revision + 1)}>{t("editor.path.retry")}</button>
              </div>
            ) : null}
            {!pathLoading && !pathError && form.path.trim() && !getIndicatorDimensionFromPath(form.path) ? (
              <div className="match-hint">
                {t("editor.path.unmatched")}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <FormActionBar
        note={isEdit ? t("editor.saveNoteEdit") : t("editor.saveNoteCreate")}
        onCancel={onCancel}
        onSave={submit}
        saving={saveBusy}
        isDirty={isDirty}
        saveText={isEdit ? t("editor.saveEdit") : t("editor.saveCreate")}
      />

      {isEdit && initial ? (
        <DangerZone
          description={t("editor.deleteDescription")}
          actions={[
            {
              key: "delete-indicator",
              label: t("editor.delete"),
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
