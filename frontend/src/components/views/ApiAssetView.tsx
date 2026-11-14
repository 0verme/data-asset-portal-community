import React from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import type {
  ApiAssetParam,
  ApiAssetRelation,
  ApiAssetResponseField,
  MockApiAsset,
} from "../../data/apiAssets.ts";
import type { MockSystem } from "../../data/systems.ts";
import type { ApiAssetRoute } from "../../routing/types.ts";
import type { ViewMode } from "../common/ViewModeSwitcher.tsx";
import type {
  IndicatorReference,
  TableReference,
} from "../common/AssetReferenceSelector.tsx";
import type { UseApiAssetModuleResult } from "../../hooks/useApiAssetModule.ts";
import {
  apiAssetFieldLabel,
  validateApiAssetForm,
  type ApiAssetFieldErrors,
} from "../../api/apiAssetValidation.ts";
import {
  ActionErrorBanner,
  AssetReferenceSelector,
  BinaryStatusToggle,
  CardGridView,
  EmptyState,
  ErrorState,
  GroupView,
  LoadingState,
  PageHeader,
  RowActions,
  StatusBadge,
  ViewModeSwitcher,
  WideTableScroll,
} from "../common/index.ts";
import { Button, Checkbox, Input, Select, TablePagination, Textarea } from "../../ui/index.ts";

interface NormalizedRelations {
  tables: TableReference[];
  indicators: IndicatorReference[];
  others: ApiAssetRelation[];
}

const blank: ApiAssetFormData = {
  code: "",
  name: "",
  method: "GET",
  path: "",
  version: "v1",
  systemId: 0,
  downstreamSystemId: "",
  downstreamSystemName: "",
  downstreamSystemShortName: "",
  type: "",
  status: "enabled",
  ownerDept: "",
  ownerName: "",
  maintainerName: "",
  description: "",
  remark: "",
  params: [],
  responseFields: [],
  relations: [],
};

function normalizeRelations(
  relations: readonly ApiAssetRelation[] | null | undefined,
): NormalizedRelations {
  const tables: TableReference[] = [];
  const indicators: IndicatorReference[] = [];
  const others: ApiAssetRelation[] = [];
  (Array.isArray(relations) ? relations : []).forEach((relation) => {
    if (relation.type === "table") {
      tables.push({
        tableName: relation.targetCode,
        tableCn: relation.targetName || "",
        domain: "",
        layer: "",
      });
    } else if (relation.type === "indicator") {
      indicators.push({
        indicatorId: relation.targetCode,
        indicatorName: relation.targetName || "",
        dimension: "",
        path: "",
      });
    } else {
      others.push(relation);
    }
  });
  return { tables, indicators, others };
}

function relationRows(
  tables: readonly TableReference[],
  indicators: readonly IndicatorReference[],
  others: readonly ApiAssetRelation[],
): ApiAssetRelation[] {
  return [
    ...tables.map((item) => ({
      type: "table",
      targetCode: item.tableName,
      targetName: item.tableCn || "",
    })),
    ...indicators.map((item) => ({
      type: "indicator",
      targetCode: item.indicatorId,
      targetName: item.indicatorName || "",
    })),
    ...others,
  ];
}

type ApiAssetT = TFunction<"apiAsset">;

type RowKind = "params" | "responseFields";
type RowItem = ApiAssetParam | ApiAssetResponseField;

function apiAssetErrorId(field: string): string {
  return `api-asset-error-${field.replace(/[^a-z0-9_-]/gi, "-")}`;
}

function focusApiAssetField(fieldErrors: ApiAssetFieldErrors): void {
  const firstField = Object.keys(fieldErrors)[0];
  if (!firstField) return;
  const marker = Array.from(
    document.querySelectorAll<HTMLElement>("[data-api-asset-field]"),
  ).find((element) => element.dataset["apiAssetField"] === firstField);
  if (!marker) return;
  const focusableSelector = "input, select, textarea, button, [tabindex]";
  const target = marker.matches(focusableSelector)
    ? marker
    : marker.querySelector<HTMLElement>(focusableSelector) || marker;
  target.scrollIntoView({ behavior: "smooth", block: "center" });
  target.focus({ preventScroll: true });
}

function clearFieldErrors(
  current: ApiAssetFieldErrors,
  fieldPrefix?: string,
): ApiAssetFieldErrors {
  if (!fieldPrefix) return {};
  return Object.fromEntries(
    Object.entries(current).filter(
      ([field]) => field !== fieldPrefix && !field.startsWith(`${fieldPrefix}.`),
    ),
  );
}

interface RowsProps<T extends RowItem> {
  title: string;
  items: T[];
  onChange: (items: T[]) => void;
  kind: RowKind;
  fieldErrors: ApiAssetFieldErrors;
  clearErrors: (fieldPrefix?: string) => void;
}

function Rows<T extends RowItem>({
  title,
  items,
  onChange,
  kind,
  fieldErrors,
  clearErrors,
}: RowsProps<T>) {
  const { t } = useTranslation("apiAsset");
  const add = (): void => {
    const row: RowItem =
      kind === "params"
        ? {
            name: "",
            in: "query",
            dataType: "string",
            required: false,
            description: "",
            example: "",
          }
        : { name: "", dataType: "string", description: "", example: "" };
    clearErrors(kind);
    onChange([...items, row as T]);
  };
  const update = (index: number, patch: Partial<RowItem>): void => {
    clearErrors(`${kind}.${index}`);
    onChange(
      items.map((item, current) =>
        current === index ? ({ ...item, ...patch } as T) : item,
      ),
    );
  };
  return (
    <div className="form-card">
      <h3>{title}</h3>
      <div className="tbl-wrap">
        <table className="dt mobile-edit-table">
          <thead>
            <tr>
              <th>{t("rows.name")}</th>
              {kind === "params" ? <th>{t("rows.location")}</th> : null}
              <th>{t("rows.type")}</th>
              <th>{t("rows.description")}</th>
              {kind === "params" ? <th>{t("rows.required")}</th> : null}
              <th>{t("rows.example")}</th>
              <th>{t("rows.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row, index) => {
              const prefix = `${kind}.${index}`;
              const nameField = `${prefix}.name`;
              const locationField = `${prefix}.in`;
              const typeField = `${prefix}.dataType`;
              const nameError = fieldErrors[nameField];
              const locationError = fieldErrors[locationField];
              const typeError = fieldErrors[typeField];
              const rowError = fieldErrors[prefix];
              return (
                <React.Fragment key={index}>
                  <tr>
                    <td data-label={t("rows.name")}>
                      <Input
                        aria-label={t("rows.rowName", { row: index + 1 })}
                        aria-invalid={Boolean(nameError || rowError) || undefined}
                        aria-describedby={[
                          nameError ? apiAssetErrorId(nameField) : "",
                          rowError ? apiAssetErrorId(prefix) : "",
                        ].filter(Boolean).join(" ") || undefined}
                        data-api-asset-field={rowError && !nameError ? prefix : nameField}
                        className={`inp mono${nameError || rowError ? " invalid" : ""}`}
                        value={row.name}
                        onChange={(event) => update(index, { name: event.target.value })}
                      />
                      {nameError ? <small id={apiAssetErrorId(nameField)} className="api-asset-field-error">{nameError}</small> : null}
                    </td>
                    {kind === "params" ? (
                      <td data-label={t("rows.location")}>
                        <Select<string>
                          aria-label={t("rows.rowLocation", { row: index + 1 })}
                          aria-invalid={Boolean(locationError) || undefined}
                          aria-describedby={locationError ? apiAssetErrorId(locationField) : undefined}
                          data-api-asset-field={locationField}
                          className={`sel${locationError ? " invalid" : ""}`}
                          items={["query", "path", "header", "body"].map((value) => ({ label: value, value }))}
                          value={(row as ApiAssetParam).in}
                          onValueChange={(value) => update(index, { in: value || "query" })}
                        />
                        {locationError ? <small id={apiAssetErrorId(locationField)} className="api-asset-field-error">{locationError}</small> : null}
                      </td>
                    ) : null}
                    <td data-label={t("rows.type")}>
                      <Input
                        aria-label={t("rows.rowType", { row: index + 1 })}
                        aria-invalid={Boolean(typeError) || undefined}
                        aria-describedby={typeError ? apiAssetErrorId(typeField) : undefined}
                        data-api-asset-field={typeField}
                        className={`inp${typeError ? " invalid" : ""}`}
                        value={row.dataType}
                        onChange={(event) => update(index, { dataType: event.target.value })}
                      />
                      {typeError ? <small id={apiAssetErrorId(typeField)} className="api-asset-field-error">{typeError}</small> : null}
                    </td>
                    <td data-label={t("rows.description")}>
                      <Input
                        aria-label={t("rows.rowDescription", { row: index + 1 })}
                        className="inp"
                        value={row.description || ""}
                        onChange={(event) => update(index, { description: event.target.value })}
                      />
                    </td>
                    {kind === "params" ? (
                      <td data-label={t("rows.required")}>
                        <Checkbox
                          aria-label={t("rows.rowRequired", { row: index + 1 })}
                          checked={(row as ApiAssetParam).required}
                          onCheckedChange={(required) => update(index, { required })}
                        />
                      </td>
                    ) : null}
                    <td data-label={t("rows.example")}>
                      <Input
                        aria-label={t("rows.rowExample", { row: index + 1 })}
                        value={row.example || ""}
                        onChange={(event) => update(index, { example: event.target.value })}
                      />
                    </td>
                    <td data-label="">
                      <Button
                        className="btn ghost-danger"
                        variant="danger"
                        type="button"
                        onClick={() => {
                          clearErrors(kind);
                          onChange(items.filter((_, current) => current !== index));
                        }}
                      >
                        {t("rows.delete")}
                      </Button>
                    </td>
                  </tr>
                  {rowError ? (
                    <tr className="api-asset-error-row">
                      <td colSpan={kind === "params" ? 7 : 5}>
                        <div
                          id={apiAssetErrorId(prefix)}
                          className="api-asset-field-error"
                        >
                          {rowError}
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <Button className="btn" variant="secondary" type="button" onClick={add}>
        {t("rows.add")}
      </Button>
    </div>
  );
}

function ApiAssetStatusBadge({ status }: { status: unknown }) {
  const { t } = useTranslation("apiAsset");
  return <StatusBadge status={status} metaMap={{
    enabled: { label: t("status.enabled"), className: "st-on" },
    disabled: { label: t("status.disabled"), className: "st-off" },
  }} />;
}

interface SystemPickerProps {
  systems: readonly MockSystem[];
  value: string;
  error?: string | undefined;
  onChange: (value: string) => void;
}

function SystemPicker({ systems, value, error, onChange }: SystemPickerProps) {
  const { t } = useTranslation("apiAsset");
  const [query, setQuery] = React.useState("");
  const options = systems.filter(
    (system) =>
      String(system.id) === value || !query ||
      [system.name, system.short_name].some((item) =>
        String(item || "")
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
  );
  return (
    <div className="system-picker">
      <Input
        aria-label={t("system.search")}
        className="inp"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t("system.search")}
      />
      {/* System <select> intentionally remains native: per-option disabled semantics are not expressible in the frozen DAP Select items API. */}
      <select
        aria-label={t("system.downstream")}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={error ? apiAssetErrorId("systemId") : undefined}
        data-api-asset-field="systemId"
        className={`sel${error ? " invalid" : ""}`}
        value={value || ""}
        onChange={(event) => onChange(event.target.value)}
        required
      >
        <option value="">{t("system.placeholder")}</option>
        {options.map((system) => (
          <option
            key={system.id}
            value={system.id}
            disabled={system.status !== "enabled"}
          >
            {system.name}（{system.short_name}）
            {system.status !== "enabled" ? t("system.disabledSuffix") : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

type ApiAssetFormData = Omit<MockApiAsset, "downstreamSystemId"> & {
  downstreamSystemId: string;
};
type ApiTextFieldKey =
  | "code"
  | "name"
  | "path"
  | "version"
  | "type"
  | "ownerDept"
  | "ownerName"
  | "maintainerName";
const API_TEXT_FIELDS: readonly [ApiTextFieldKey, `fields.${ApiTextFieldKey}`][] = [
  ["code", "fields.code"],
  ["name", "fields.name"],
  ["path", "fields.path"],
  ["version", "fields.version"],
  ["type", "fields.type"],
  ["ownerDept", "fields.ownerDept"],
  ["ownerName", "fields.ownerName"],
  ["maintainerName", "fields.maintainerName"],
];

function toFormData(item: MockApiAsset | null | undefined): ApiAssetFormData {
  if (!item) return { ...blank, params: [], responseFields: [], relations: [] };
  return { ...item, downstreamSystemId: String(item.systemId || item.downstreamSystemId || "") };
}

interface EditorProps {
  item: MockApiAsset | null;
  systems: readonly MockSystem[];
  onSave: (payload: MockApiAsset) => void | Promise<unknown>;
  onCancel: () => void;
  error: string;
  fieldErrors: ApiAssetFieldErrors;
  saveFailureRevision: number;
  clearSaveErrors: (fieldPrefix?: string) => void;
}

function Editor({
  item,
  systems,
  onSave,
  onCancel,
  error,
  fieldErrors: serverFieldErrors,
  saveFailureRevision,
  clearSaveErrors: clearServerErrors,
}: EditorProps) {
  const { t } = useTranslation("apiAsset");
  const [form, setForm] = React.useState<ApiAssetFormData>(() =>
    toFormData(item),
  );
  const initial = React.useMemo(
    () => normalizeRelations(item?.relations),
    [item],
  );
  const [tables, setTables] = React.useState<TableReference[]>(initial.tables);
  const [indicators, setIndicators] = React.useState<IndicatorReference[]>(
    initial.indicators,
  );
  const [localFieldErrors, setLocalFieldErrors] = React.useState<ApiAssetFieldErrors>({});
  const [saving, setSaving] = React.useState(false);
  const savingRef = React.useRef(false);
  const fieldErrors = { ...serverFieldErrors, ...localFieldErrors };
  const clearErrors = (fieldPrefix?: string): void => {
    clearServerErrors(fieldPrefix);
    setLocalFieldErrors((current) => clearFieldErrors(current, fieldPrefix));
  };
  const set = <K extends keyof ApiAssetFormData>(
    key: K,
    value: ApiAssetFormData[K],
  ): void => {
    clearErrors(key === "downstreamSystemId" ? "systemId" : String(key));
    setForm((current) => ({ ...current, [key]: value }));
  };
  React.useEffect(() => {
    if (saveFailureRevision > 0) focusApiAssetField(serverFieldErrors);
  }, [saveFailureRevision, serverFieldErrors]);
  const submit = async (): Promise<void> => {
    if (savingRef.current) return;
    clearErrors();
    const payload: MockApiAsset = {
      ...form,
      systemId: Number(form.downstreamSystemId),
      downstreamSystemId: Number(form.downstreamSystemId),
      code: form.code.trim().toUpperCase(),
      relations: relationRows(tables, indicators, initial.others),
    };
    const validationErrors = validateApiAssetForm(
      { ...payload, downstreamSystemId: form.downstreamSystemId },
      systems,
      t,
    );
    setLocalFieldErrors(validationErrors);
    if (Object.keys(validationErrors).length) {
      focusApiAssetField(validationErrors);
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      await onSave(payload);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  const relationErrors = Object.entries(fieldErrors).filter(([field]) =>
    /^relations\.\d+$/.test(field),
  );
  const firstRelationError = relationErrors[0];
  const fieldSummary = Object.keys(fieldErrors).length
    ? t("editor.checkFields", { fields: Object.keys(fieldErrors).map((field) => apiAssetFieldLabel(field, t)).join(t("editor.fieldSeparator")) })
    : "";
  const bannerMessages = [
    ...(error ? [error] : []),
    ...(fieldSummary ? [fieldSummary] : []),
  ];
  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: t("moduleTitle"), onClick: onCancel },
          { label: item ? t("editor.edit") : t("editor.create") },
        ]}
        icon={item ? "edit" : "plus"}
        title={item ? t("editor.edit") : t("editor.create")}
        subtitle={t("editor.subtitle")}
      />
      <ActionErrorBanner
        title={error ? t("editor.saveError") : t("editor.formError")}
        messages={bannerMessages}
      />
      <div className="form-card">
        <h3>{t("editor.basicInfo")}</h3>
        <div className="form-grid">
          {API_TEXT_FIELDS.map(([key, labelKey]) => {
            const label = t(labelKey);
            const fieldError = fieldErrors[key];
            return (
              <div className="fl" key={key}>
                <label>{label}</label>
                <Input
                  aria-label={label}
                  aria-invalid={Boolean(fieldError) || undefined}
                  aria-describedby={fieldError ? apiAssetErrorId(key) : undefined}
                  data-api-asset-field={key}
                  className={`inp${key === "code" || key === "path" ? " mono" : ""}${fieldError ? " invalid" : ""}`}
                  value={form[key]}
                  disabled={Boolean(item) && key === "code"}
                  onChange={(event) => set(key, event.target.value)}
                />
                {fieldError ? <small id={apiAssetErrorId(key)} className="api-asset-field-error">{fieldError}</small> : null}
              </div>
            );
          })}
          <div className="fl">
            <label>{t("system.downstream")}</label>
            <SystemPicker
              systems={systems}
              value={form.downstreamSystemId}
              error={fieldErrors["systemId"]}
              onChange={(value) => set("downstreamSystemId", value)}
            />
            {fieldErrors["systemId"] ? <small id={apiAssetErrorId("systemId")} className="api-asset-field-error">{fieldErrors["systemId"]}</small> : null}
          </div>
          <div className="fl">
            <label>{t("editor.method")}</label>
            <Select<string>
              aria-label={t("editor.method")}
              aria-invalid={Boolean(fieldErrors["method"]) || undefined}
              aria-describedby={fieldErrors["method"] ? apiAssetErrorId("method") : undefined}
              data-api-asset-field="method"
              className={`sel${fieldErrors["method"] ? " invalid" : ""}`}
              items={["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].map((value) => ({ label: value, value }))}
              value={form.method}
              onValueChange={(value) => set("method", value || "GET")}
            />
            {fieldErrors["method"] ? <small id={apiAssetErrorId("method")} className="api-asset-field-error">{fieldErrors["method"]}</small> : null}
          </div>
          <div className="fl">
            <label>{t("fields.status")}</label>
            <div
              role="group"
              aria-label={t("fields.status")}
              aria-invalid={Boolean(fieldErrors["status"]) || undefined}
              data-api-asset-field="status"
              tabIndex={fieldErrors["status"] ? -1 : undefined}
              aria-describedby={fieldErrors["status"] ? apiAssetErrorId("status") : undefined}
            >
              {!["enabled", "disabled"].includes(form.status) ? (
                <>
                  <p role="status">{t("editor.unknownHistoricalStatus", { status: form.status || t("editor.emptyValue") })}</p>
                  <Select<string>
                    aria-label={t("editor.chooseStatus")}
                    value={form.status}
                    items={[
                      { value: form.status, label: t("editor.unknownStatus", { status: form.status || t("editor.emptyValue") }) },
                      { value: "enabled", label: t("status.enabled") },
                      { value: "disabled", label: t("status.disabled") },
                    ]}
                    onValueChange={(value) => { if (value) set("status", value); }}
                  />
                </>
              ) : <BinaryStatusToggle
                mode="status"
                name="status"
                value={form.status}
                className={fieldErrors["status"] ? "invalid" : ""}
                ariaLabel={t("fields.status")}
                labels={{ enabled: t("status.enabled"), disabled: t("status.disabled") }}
                onChange={(value) =>
                  set(
                    "status",
                    typeof value === "boolean"
                      ? value
                        ? "enabled"
                        : "disabled"
                      : value,
                  )
                }
              />}
            </div>
            {fieldErrors["status"] ? <small id={apiAssetErrorId("status")} className="api-asset-field-error">{fieldErrors["status"]}</small> : null}
          </div>
          <div className="fl full">
            <label>{t("fields.description")}</label>
            <Textarea
              aria-label={t("fields.description")}
              data-api-asset-field="description"
              aria-invalid={Boolean(fieldErrors["description"]) || undefined}
              aria-describedby={fieldErrors["description"] ? apiAssetErrorId("description") : undefined}
              className="ta"
              value={form.description}
              onChange={(event) => set("description", event.target.value)}
            />
            {fieldErrors["description"] ? <small id={apiAssetErrorId("description")} className="api-asset-field-error">{fieldErrors["description"]}</small> : null}
          </div>
          <div className="fl full">
            <label>{t("fields.remark")}</label>
            <Textarea
              aria-label={t("fields.remark")}
              data-api-asset-field="remark"
              aria-invalid={Boolean(fieldErrors["remark"]) || undefined}
              aria-describedby={fieldErrors["remark"] ? apiAssetErrorId("remark") : undefined}
              className="ta"
              value={form.remark}
              onChange={(event) => set("remark", event.target.value)}
            />
            {fieldErrors["remark"] ? <small id={apiAssetErrorId("remark")} className="api-asset-field-error">{fieldErrors["remark"]}</small> : null}
          </div>
        </div>
      </div>
      <Rows<ApiAssetParam>
        title={t("fields.params")}
        items={form.params}
        onChange={(value) => set("params", value)}
        kind="params"
        fieldErrors={fieldErrors}
        clearErrors={clearErrors}
      />
      <Rows<ApiAssetResponseField>
        title={t("fields.responseFields")}
        items={form.responseFields}
        onChange={(value) => set("responseFields", value)}
        kind="responseFields"
        fieldErrors={fieldErrors}
        clearErrors={clearErrors}
      />
      <div className="form-card">
        <h3>{t("editor.relatedAssets")}</h3>
        <div
          role="group"
          aria-label={t("fields.relations")}
          aria-invalid={relationErrors.length ? true : undefined}
          aria-describedby={firstRelationError ? apiAssetErrorId(firstRelationError[0]) : undefined}
          data-api-asset-field={firstRelationError?.[0]}
          tabIndex={firstRelationError ? -1 : undefined}
        >
          <AssetReferenceSelector
            selectedTables={tables}
            selectedIndicators={indicators}
            onTablesChange={(value) => {
              clearErrors("relations");
              setTables(value);
            }}
            onIndicatorsChange={(value) => {
              clearErrors("relations");
              setIndicators(value);
            }}
          />
        </div>
        {relationErrors.map(([field, message]) => (
          <small key={field} id={apiAssetErrorId(field)} className="api-asset-field-error">
            {message}
          </small>
        ))}
      </div>
      <div className="form-actions">
        <Button className="btn" variant="secondary" type="button" onClick={onCancel} disabled={saving}>
          {t("editor.cancel")}
        </Button>
        <Button
          className="btn primary"
          variant="primary"
          type="button"
          onClick={submit}
          disabled={saving}
        >
          {saving ? t("editor.saving") : t("editor.save")}
        </Button>
      </div>
    </>
  );
}

interface ApiEmptyStateProps {
  query: string;
}
function ApiEmptyState({ query }: ApiEmptyStateProps) {
  const { t } = useTranslation("apiAsset");
  return (
    <EmptyState title={query ? t("list.emptyQuery") : t("list.empty")} />
  );
}
function systemLabel(item: MockApiAsset, t: ApiAssetT): string {
  return item.downstreamSystemName || t("system.unlinked");
}
function systemCode(item: MockApiAsset): string {
  return item.downstreamSystemShortName
    ? `（${item.downstreamSystemShortName}）`
    : "";
}

interface ApiCardsProps {
  items: readonly MockApiAsset[];
  onView: (code: string) => void;
  onEdit: (code: string) => void;
  onToggle: (item: MockApiAsset) => void | Promise<unknown>;
  pendingIds: readonly string[];
  canEdit: boolean;
}

function ApiCards({
  items,
  onView,
  onEdit,
  onToggle,
  pendingIds,
  canEdit,
}: ApiCardsProps) {
  const { t } = useTranslation("apiAsset");
  return (
    <CardGridView
      items={items}
      getKey={(item) => item.code}
      onItemClick={(item) => onView(item.code)}
      renderBadges={(item) => (
        <>
          <span className="tag tag-neutral">{item.method}</span>
          <ApiAssetStatusBadge status={item.status} />
        </>
      )}
      renderTitle={(item) => item.name}
      renderSubtitle={(item) => item.code}
      renderDesc={(item) => (
        <span className="mono" title={item.path}>
          {item.path}
        </span>
      )}
      renderFootLeft={(item) => (
        <span className="t-owner">
          {systemLabel(item, t)}
          {systemCode(item)}
        </span>
      )}
      renderFootMeta={(item) => (
        <span className="m">
          {t("system.owner")} <b>{item.ownerName || t("system.notSet")}</b>
        </span>
      )}
      renderFootActions={(item) => (
        <RowActions
          disabled={pendingIds.includes(item.code)}
          onView={() => onView(item.code)}
          onEdit={canEdit ? () => onEdit(item.code) : undefined}
          toggle={
            canEdit
              ? {
                  enabled: item.status === "enabled",
                  label: item.name,
                  onToggle: () => onToggle(item),
                }
              : undefined
          }
        />
      )}
    />
  );
}

interface ApiGroupsProps {
  items: readonly MockApiAsset[];
  onView: (code: string) => void;
}
function ApiGroups({ items, onView }: ApiGroupsProps) {
  const { t } = useTranslation("apiAsset");
  const groupKey = (item: MockApiAsset): string =>
    item.downstreamSystemId == null || !item.downstreamSystemName
      ? "__unlinked__"
      : String(item.downstreamSystemId);
  return (
    <GroupView
      items={items}
      getKey={(item) => item.code}
      onItemClick={(item) => onView(item.code)}
      groupBy={groupKey}
      groupOrder={["__unlinked__"]}
      renderGroupLabel={(key) => {
        const item = items.find((entry) => groupKey(entry) === key);
        return key === "__unlinked__" ? (
          t("list.unlinkedGroup")
        ) : (
          <>
            {item?.downstreamSystemName}
            {item?.downstreamSystemShortName
              ? `（${item.downstreamSystemShortName}）`
              : ""}
          </>
        );
      }}
      renderGroupCount={(count) => t("list.groupCount", { count })}
      renderCardName={(item) => item.code}
      renderCardBody={(item) => (
        <>
          <span>{item.name}</span>
          <span className="gc-owner mono">
            {item.method} {item.path}
          </span>
        </>
      )}
    />
  );
}

interface ApiListProps {
  items: readonly MockApiAsset[];
  query: string;
  view: ViewMode;
  onChangeView: (view: ViewMode) => void;
  apiAsset: UseApiAssetModuleResult;
  canEdit: boolean;
}

function ApiList({
  items,
  query,
  view,
  onChangeView,
  apiAsset,
  canEdit,
}: ApiListProps) {
  const { t } = useTranslation("apiAsset");
  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">
            <span className="pt-code">{t("page.code")}</span>{t("page.title")}
          </div>
          <div className="page-sub">
            {t("page.summary", { count: apiAsset.total })}
          </div>
        </div>
        <div className="head-actions">
          <ViewModeSwitcher value={view} onChange={onChangeView} />
          {canEdit ? (
            <Button
              className="btn primary"
              variant="primary"
              type="button"
              onClick={apiAsset.create}
            >
              {t("page.create")}
            </Button>
          ) : null}
        </div>
      </div>
      {!items.length ? (
        <ApiEmptyState query={query} />
      ) : view === "list" ? (
        <div className="tbl-wrap">
          <WideTableScroll ariaLabel={t("list.ariaLabel")} className="api-assets-wide-scroll">
            <table className="dt mobile-card-table api-assets-wide-table">
            <thead>
              <tr>
                <th>{t("list.api")}</th>
                <th>{t("list.request")}</th>
                <th>{t("list.downstream")}</th>
                <th>{t("list.owner")}</th>
                <th>{t("list.status")}</th>
                <th>{t("list.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.code}>
                  <td data-label={t("list.api")}>
                    <b>{item.name}</b>
                    <div className="mono">{item.code}</div>
                  </td>
                  <td data-label={t("list.request")}>
                    <span className="mono">
                      {item.method} {item.path}
                    </span>
                  </td>
                  <td data-label={t("list.downstream")}>
                    {systemLabel(item, t)}
                    {systemCode(item)}
                  </td>
                  <td data-label={t("list.owner")}>{item.ownerName}</td>
                  <td data-label={t("list.status")}>
                    <ApiAssetStatusBadge status={item.status} />
                  </td>
                  <td data-label={t("list.actions")} className="mobile-card-actions">
                    <RowActions
                      disabled={apiAsset.pendingIds.includes(item.code)}
                      onView={() => apiAsset.view(item.code)}
                      onEdit={
                        canEdit ? () => apiAsset.edit(item.code) : undefined
                      }
                      toggle={
                        canEdit
                          ? {
                              enabled: item.status === "enabled",
                              label: item.name,
                              onToggle: () => apiAsset.toggle(item),
                            }
                          : undefined
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
            </table>
          </WideTableScroll>
        </div>
      ) : view === "card" ? (
        <ApiCards
          items={items}
          onView={apiAsset.view}
          onEdit={apiAsset.edit}
          onToggle={apiAsset.toggle}
          pendingIds={apiAsset.pendingIds}
          canEdit={canEdit}
        />
      ) : (
        <ApiGroups items={items} onView={apiAsset.view} />
      )}
      <TablePagination
        page={apiAsset.page}
        pageSize={apiAsset.pageSize}
        total={apiAsset.total}
        onPageChange={apiAsset.setPage}
        onPageSizeChange={apiAsset.setPageSize}
        loading={apiAsset.loading}
        ariaLabel={t("list.pagination")}
      />
    </>
  );
}

export interface ApiAssetViewProps {
  apiAsset: UseApiAssetModuleResult;
  query: string;
  route: ApiAssetRoute;
  view: ViewMode;
  onChangeView: (view: ViewMode) => void;
  canEdit?: boolean | undefined;
}

export function ApiAssetView({
  apiAsset,
  query,
  route,
  view,
  onChangeView,
  canEdit = false,
}: ApiAssetViewProps) {
  const { t } = useTranslation("apiAsset");
  if (route.page === "list" && apiAsset.loading)
    return (
      <LoadingState title={t("view.loading")} desc={t("view.loadingDescription")} />
    );
  if (route.page === "list" && apiAsset.error)
    return (
      <ErrorState
        title={t("view.loadError")}
        desc={apiAsset.error}
        onRetry={apiAsset.load}
      />
    );
  if (!canEdit && ["new", "edit"].includes(route.page)) {
    return (
      <EmptyState
        title={t("view.permissionTitle")}
        desc={t("view.permissionDescription")}
      />
    );
  }
  if (["view", "edit"].includes(route.page) && apiAsset.detailLoading)
    return <LoadingState title={t("view.loadingDetail")} desc={t("view.loadingDetailDescription")} />;
  if (["view", "edit"].includes(route.page) && apiAsset.detailError)
    return <ErrorState title={t("view.detailError")} desc={apiAsset.detailError} onRetry={apiAsset.loadDetail} />;
  if (["view", "edit"].includes(route.page) && !apiAsset.current)
    return <EmptyState title={t("view.missingTitle")} desc={t("view.missingDescription")} actionText={t("view.backToList")} onAction={apiAsset.back} />;
  if (route.page === "new" || route.page === "edit")
    return (
      <Editor
        item={route.page === "edit" ? apiAsset.current : null}
        systems={apiAsset.systems}
        onSave={apiAsset.save}
        onCancel={apiAsset.back}
        error={apiAsset.saveError}
        fieldErrors={apiAsset.saveFieldErrors}
        saveFailureRevision={apiAsset.saveFailureRevision}
        clearSaveErrors={apiAsset.clearSaveErrors}
      />
    );
  if (route.page === "view" && apiAsset.current) {
    const item = apiAsset.current;
    const relations = normalizeRelations(item.relations);
    return (
      <>
        <PageHeader
          breadcrumbs={[
            { label: t("moduleTitle"), onClick: apiAsset.back },
            { label: item.name },
          ]}
          icon="api"
          title={item.name}
          subtitle={item.code}
        />
        <div className="detail-head">
          <div className="indicator-detail-grid">
            <div className="indicator-detail-item">
              <div className="indicator-detail-label">{t("detail.request")}</div>
              <div className="indicator-detail-value mono">
                {item.method} {item.path}
              </div>
            </div>
            <div className="indicator-detail-item">
              <div className="indicator-detail-label">{t("detail.downstream")}</div>
              <div className="indicator-detail-value">
                {systemLabel(item, t)}
                {systemCode(item)}
              </div>
            </div>
            <div className="indicator-detail-item">
              <div className="indicator-detail-label">{t("detail.status")}</div>
              <div className="indicator-detail-value">
                <ApiAssetStatusBadge status={item.status} />
              </div>
            </div>
            <div className="indicator-detail-item">
              <div className="indicator-detail-label">{t("detail.ownership")}</div>
              <div className="indicator-detail-value">
                {item.ownerDept} / {item.ownerName}
              </div>
            </div>
            <div className="indicator-detail-item full">
              <div className="indicator-detail-label">{t("detail.description")}</div>
              <div className="indicator-detail-value">
                {item.description || "-"}
              </div>
            </div>
          </div>
        </div>
        <div className="form-card">
          <h3>{t("detail.relatedAssets")}</h3>
          <AssetReferenceSelector
            selectedTables={relations.tables}
            selectedIndicators={relations.indicators}
            onTablesChange={() => undefined}
            onIndicatorsChange={() => undefined}
            readonly
          />
        </div>
        {canEdit ? (
          <Button
            className="btn"
            variant="secondary"
            type="button"
            onClick={() => apiAsset.edit(item.code)}
          >
            {t("view.edit")}
          </Button>
        ) : null}
      </>
    );
  }
  return (
    <ApiList
      items={apiAsset.filtered}
      query={query}
      view={view}
      onChangeView={onChangeView}
      apiAsset={apiAsset}
      canEdit={canEdit}
    />
  );
}
