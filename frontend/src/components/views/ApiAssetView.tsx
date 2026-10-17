import React from "react";

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
} from "../common/index.ts";
import { Button, Checkbox, Input, Select, Textarea } from "../../ui/index.ts";

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
              <th>名称</th>
              {kind === "params" ? <th>位置</th> : null}
              <th>类型</th>
              <th>说明</th>
              {kind === "params" ? <th>必填</th> : null}
              <th>示例</th>
              <th>操作</th>
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
                    <td data-label="名称">
                      <Input
                        aria-label={`第 ${index + 1} 行名称`}
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
                      <td data-label="位置">
                        <Select<string>
                          aria-label={`第 ${index + 1} 行位置`}
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
                    <td data-label="类型">
                      <Input
                        aria-label={`第 ${index + 1} 行类型`}
                        aria-invalid={Boolean(typeError) || undefined}
                        aria-describedby={typeError ? apiAssetErrorId(typeField) : undefined}
                        data-api-asset-field={typeField}
                        className={`inp${typeError ? " invalid" : ""}`}
                        value={row.dataType}
                        onChange={(event) => update(index, { dataType: event.target.value })}
                      />
                      {typeError ? <small id={apiAssetErrorId(typeField)} className="api-asset-field-error">{typeError}</small> : null}
                    </td>
                    <td data-label="说明">
                      <Input
                        aria-label={`第 ${index + 1} 行说明`}
                        className="inp"
                        value={row.description || ""}
                        onChange={(event) => update(index, { description: event.target.value })}
                      />
                    </td>
                    {kind === "params" ? (
                      <td data-label="必填">
                        <Checkbox
                          aria-label={`第 ${index + 1} 行必填`}
                          checked={(row as ApiAssetParam).required}
                          onCheckedChange={(required) => update(index, { required })}
                        />
                      </td>
                    ) : null}
                    <td data-label="示例">
                      <Input
                        aria-label={`第 ${index + 1} 行示例`}
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
                        删除
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
        + 添加
      </Button>
    </div>
  );
}

interface SystemPickerProps {
  systems: readonly MockSystem[];
  value: string;
  error?: string | undefined;
  onChange: (value: string) => void;
}

function SystemPicker({ systems, value, error, onChange }: SystemPickerProps) {
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
        aria-label="搜索系统名称或简称"
        className="inp"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="搜索系统名称或简称"
      />
      {/* System <select> intentionally remains native: per-option disabled semantics are not expressible in the frozen DAP Select items API. */}
      <select
        aria-label="下游调用系统"
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={error ? apiAssetErrorId("systemId") : undefined}
        data-api-asset-field="systemId"
        className={`sel${error ? " invalid" : ""}`}
        value={value || ""}
        onChange={(event) => onChange(event.target.value)}
        required
      >
        <option value="">请选择业务系统</option>
        {options.map((system) => (
          <option
            key={system.id}
            value={system.id}
            disabled={system.status !== "enabled"}
          >
            {system.name}（{system.short_name}）
            {system.status !== "enabled" ? "（已禁用）" : ""}
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
const API_TEXT_FIELDS: readonly [ApiTextFieldKey, string][] = [
  ["code", "API 编码"],
  ["name", "API 名称"],
  ["path", "请求路径"],
  ["version", "版本"],
  ["type", "API 类型"],
  ["ownerDept", "归属部门"],
  ["ownerName", "负责人"],
  ["maintainerName", "维护人"],
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
  const submit = (): void => {
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
    );
    setLocalFieldErrors(validationErrors);
    if (Object.keys(validationErrors).length) {
      focusApiAssetField(validationErrors);
      return;
    }
    void onSave(payload);
  };
  const relationErrors = Object.entries(fieldErrors).filter(([field]) =>
    /^relations\.\d+$/.test(field),
  );
  const firstRelationError = relationErrors[0];
  const fieldSummary = Object.keys(fieldErrors).length
    ? `请检查以下字段：${Object.keys(fieldErrors).map(apiAssetFieldLabel).join("、")}`
    : "";
  const bannerMessages = [
    ...(error ? [error] : []),
    ...(fieldSummary ? [fieldSummary] : []),
  ];
  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: "API 资产", onClick: onCancel },
          { label: item ? "编辑 API" : "新增 API" },
        ]}
        icon={item ? "edit" : "plus"}
        title={item ? "编辑 API" : "新增 API"}
        subtitle="维护 API 元数据、请求参数、响应字段与资产关联。"
      />
      <ActionErrorBanner
        title={error ? "API 资产保存失败" : "请检查 API 资产表单"}
        messages={bannerMessages}
      />
      <div className="form-card">
        <h3>基本信息</h3>
        <div className="form-grid">
          {API_TEXT_FIELDS.map(([key, label]) => {
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
            <label>下游调用系统</label>
            <SystemPicker
              systems={systems}
              value={form.downstreamSystemId}
              error={fieldErrors["systemId"]}
              onChange={(value) => set("downstreamSystemId", value)}
            />
            {fieldErrors["systemId"] ? <small id={apiAssetErrorId("systemId")} className="api-asset-field-error">{fieldErrors["systemId"]}</small> : null}
          </div>
          <div className="fl">
            <label>请求方式</label>
            <Select<string>
              aria-label="请求方式"
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
            <label>状态</label>
            <div
              role="group"
              aria-label="状态"
              aria-invalid={Boolean(fieldErrors["status"]) || undefined}
              data-api-asset-field="status"
              tabIndex={fieldErrors["status"] ? -1 : undefined}
              aria-describedby={fieldErrors["status"] ? apiAssetErrorId("status") : undefined}
            >
              <BinaryStatusToggle
                mode="status"
                name="status"
                value={form.status}
                className={fieldErrors["status"] ? "invalid" : ""}
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
              />
            </div>
            {fieldErrors["status"] ? <small id={apiAssetErrorId("status")} className="api-asset-field-error">{fieldErrors["status"]}</small> : null}
          </div>
          <div className="fl full">
            <label>说明</label>
            <Textarea
              aria-label="说明"
              className="ta"
              value={form.description}
              onChange={(event) => set("description", event.target.value)}
            />
          </div>
          <div className="fl full">
            <label>备注</label>
            <Textarea
              aria-label="备注"
              className="ta"
              value={form.remark}
              onChange={(event) => set("remark", event.target.value)}
            />
          </div>
        </div>
      </div>
      <Rows<ApiAssetParam>
        title="请求参数"
        items={form.params}
        onChange={(value) => set("params", value)}
        kind="params"
        fieldErrors={fieldErrors}
        clearErrors={clearErrors}
      />
      <Rows<ApiAssetResponseField>
        title="响应字段"
        items={form.responseFields}
        onChange={(value) => set("responseFields", value)}
        kind="responseFields"
        fieldErrors={fieldErrors}
        clearErrors={clearErrors}
      />
      <div className="form-card">
        <h3>关联资产</h3>
        <div
          role="group"
          aria-label="关联资产"
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
        <Button className="btn" variant="secondary" type="button" onClick={onCancel}>
          取消
        </Button>
        <Button
          className="btn primary"
          variant="primary"
          type="button"
          onClick={submit}
        >
          保存
        </Button>
      </div>
    </>
  );
}

interface ApiEmptyStateProps {
  query: string;
}
function ApiEmptyState({ query }: ApiEmptyStateProps) {
  return (
    <EmptyState title={query ? "未找到符合条件的 API 资产" : "暂无 API 资产"} />
  );
}
function systemLabel(item: MockApiAsset): string {
  return item.downstreamSystemName || "未关联";
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
  return (
    <CardGridView
      items={items}
      getKey={(item) => item.code}
      onItemClick={(item) => onView(item.code)}
      renderBadges={(item) => (
        <>
          <span className="tag tag-neutral">{item.method}</span>
          <StatusBadge status={item.status} />
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
          {systemLabel(item)}
          {systemCode(item)}
        </span>
      )}
      renderFootMeta={(item) => (
        <span className="m">
          负责人 <b>{item.ownerName || "未设置"}</b>
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
          "未关联"
        ) : (
          <>
            {item?.downstreamSystemName}
            {item?.downstreamSystemShortName
              ? `（${item.downstreamSystemShortName}）`
              : ""}
          </>
        );
      }}
      renderGroupCount={(count) => `${count} 个 API`}
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
  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">
            <span className="pt-code">API</span>API 资产
          </div>
          <div className="page-sub">
            共 <b>{items.length}</b> 个
            API，可按请求方式、下游调用系统和状态筛选。
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
              新增 API
            </Button>
          ) : null}
        </div>
      </div>
      {!items.length ? (
        <ApiEmptyState query={query} />
      ) : view === "list" ? (
        <div className="tbl-wrap">
          <table className="dt mobile-card-table">
            <thead>
              <tr>
                <th>API</th>
                <th>请求</th>
                <th>下游调用系统</th>
                <th>负责人</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.code}>
                  <td data-label="">
                    <b>{item.name}</b>
                    <div className="mono">{item.code}</div>
                  </td>
                  <td data-label="请求">
                    <span className="mono">
                      {item.method} {item.path}
                    </span>
                  </td>
                  <td data-label="下游系统">
                    {systemLabel(item)}
                    {systemCode(item)}
                  </td>
                  <td data-label="负责人">{item.ownerName}</td>
                  <td data-label="状态">
                    <StatusBadge status={item.status} />
                  </td>
                  <td data-label="" className="mobile-card-actions">
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
  if (apiAsset.loading)
    return (
      <LoadingState title="加载 API 资产" desc="正在读取 API 元数据台账。" />
    );
  if (apiAsset.error)
    return (
      <ErrorState
        title="API 资产加载失败"
        desc={apiAsset.error}
        onRetry={apiAsset.load}
      />
    );
  if (!canEdit && ["new", "edit"].includes(route.page)) {
    return (
      <EmptyState
        title="当前页面需要 API 资产维护权限"
        desc="API 目录可以公开浏览，新增和编辑需要相应写权限。"
      />
    );
  }
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
            { label: "API 资产", onClick: apiAsset.back },
            { label: item.name },
          ]}
          icon="api"
          title={item.name}
          subtitle={item.code}
        />
        <div className="detail-head">
          <div className="indicator-detail-grid">
            <div className="indicator-detail-item">
              <div className="indicator-detail-label">请求</div>
              <div className="indicator-detail-value mono">
                {item.method} {item.path}
              </div>
            </div>
            <div className="indicator-detail-item">
              <div className="indicator-detail-label">下游调用系统</div>
              <div className="indicator-detail-value">
                {systemLabel(item)}
                {systemCode(item)}
              </div>
            </div>
            <div className="indicator-detail-item">
              <div className="indicator-detail-label">状态</div>
              <div className="indicator-detail-value">
                <StatusBadge status={item.status} />
              </div>
            </div>
            <div className="indicator-detail-item">
              <div className="indicator-detail-label">归属</div>
              <div className="indicator-detail-value">
                {item.ownerDept} / {item.ownerName}
              </div>
            </div>
            <div className="indicator-detail-item full">
              <div className="indicator-detail-label">说明</div>
              <div className="indicator-detail-value">
                {item.description || "-"}
              </div>
            </div>
          </div>
        </div>
        <div className="form-card">
          <h3>关联资产</h3>
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
            编辑
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
