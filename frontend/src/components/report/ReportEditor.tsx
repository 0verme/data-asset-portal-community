import React from "react";
import { useTranslation } from "react-i18next";

import { getAssetTables, getDomains, type AssetTableItem } from "../../api/assets.ts";
import { getIndicatorList } from "../../api/indicator.ts";
import { getReportList, getReportOptions, type RemoteReportOptions } from "../../api/report.ts";
import type { MockIndicatorItem } from "../../data/indicators.ts";
import type { MockReportItem, RelatedIndicatorSummary, RelatedTableSummary } from "../../data/reports.ts";
import { buildReportOptionSets } from "../../config/reportOptions.ts";
import { getLegacyAwareOptions, normalizeDictOptions, type OptionInputItem } from "../../utils/optionUtils.ts";
import { getErrorMessage } from "../../utils/ui.ts";
import { AssetReferencePicker, BinaryStatusToggle, DangerZone, FormActionBar, PageHeader } from "../common/index.ts";
import { Icon } from "../ui.tsx";
import {
  Checkbox,
  FormErrorSummary,
  FormField,
  focusFirstFormError,
  mergeFormFieldErrors,
  Input,
  Select,
  Textarea,
  type FormFieldErrors,
} from "../../ui/index.ts";
import { validateReportForm } from "./reportFormErrors.ts";

const REPORT_FORM_ID = "report-editor-form";
type ReportFieldLabelKey =
  | "editor.fields.code"
  | "editor.fields.name"
  | "editor.fields.type"
  | "editor.fields.domain"
  | "editor.fields.ownerDept"
  | "editor.fields.ownerName"
  | "editor.fields.statPeriod"
  | "editor.fields.statCaliber"
  | "editor.fields.effectiveDate"
  | "editor.fields.expireDate";
const REPORT_FIELD_LABEL_KEYS: Readonly<Record<string, ReportFieldLabelKey>> = {
  code: "editor.fields.code",
  name: "editor.fields.name",
  type: "editor.fields.type",
  domain: "editor.fields.domain",
  ownerDept: "editor.fields.ownerDept",
  ownerName: "editor.fields.ownerName",
  statPeriod: "editor.fields.statPeriod",
  statCaliber: "editor.fields.statCaliber",
  effectiveDate: "editor.fields.effectiveDate",
  expireDate: "editor.fields.expireDate",
};

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

interface DictInputProps {
  value: string;
  onChange: (value: string) => void;
  options: readonly OptionInputItem[];
  listId: string;
  placeholder: string;
  invalid?: boolean | undefined;
  "aria-invalid"?: boolean | "false" | "true" | undefined;
}

function DictInput({ value, onChange, options, listId, placeholder, invalid = false, "aria-invalid": ariaInvalid }: DictInputProps) {
  const selectOptions = getLegacyAwareOptions(normalizeDictOptions(options), value);
  return <>
    <Input aria-label={placeholder} aria-invalid={ariaInvalid} className={`inp${invalid ? " invalid" : ""}`} list={listId} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
    <datalist id={listId}>{selectOptions.map((item) => <option key={item.value} value={item.value}>{item.name}</option>)}</datalist>
  </>;
}

function readText(item: AssetTableItem, key: string): string {
  const value = item[key];
  return typeof value === "string" ? value : "";
}

function normalizeTableCandidate(item: AssetTableItem): RelatedTableSummary {
  const assetId = Number(item.assetId);
  return {
    assetId: Number.isInteger(assetId) && assetId > 0 ? assetId : null,
    tableName: item.name,
    tableCn: readText(item, "labelCn") || readText(item, "cnName") || item.cn || item.desc || "",
    domain: item.domain || "",
    layer: item.layer || item.dataLayer || item.schemaLayer || "",
  };
}

/** Stable picker key: same-name assets stay distinguishable via assetId. */
function tableReferenceKey(item: RelatedTableSummary): string {
  const assetId = Number(item.assetId);
  return Number.isInteger(assetId) && assetId > 0
    ? `asset:${assetId}`
    : `table:${String(item.tableName || "")}`;
}

function withReferenceKey(item: RelatedTableSummary): RelatedTableSummary {
  return { ...item, refKey: tableReferenceKey(item) };
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
  serverFieldErrors?: FormFieldErrors | undefined;
  serverFieldErrorFocusRequest?: FormFieldErrors | null | undefined;
  onClearServerFieldError?: ((field: string) => void) | undefined;
}

export function ReportEditor({
  mode,
  initial,
  onSave,
  onCancel,
  onDelete,
  saveBusy = false,
  serverFieldErrors = {},
  serverFieldErrorFocusRequest = null,
  onClearServerFieldError,
}: ReportEditorProps) {
  const { t } = useTranslation("report");
  const tRef = React.useRef(t);
  tRef.current = t;
  const isEdit = mode === "edit";
  const isRemoteMode = import.meta.env?.['VITE_API_MODE'] === "remote";
  const [form, setForm] = React.useState<ReportFormData>(() => createFormState(initial));
  const [touched, setTouched] = React.useState(false);
  const formRef = React.useRef<HTMLDivElement>(null);
  const lifecycleDetailsRef = React.useRef<HTMLDetailsElement>(null);
  const [validationFocusRequest, setValidationFocusRequest] = React.useState(0);
  const handledFocusRequestRef = React.useRef(0);
  const [tableSearch, setTableSearch] = React.useState("");
  const [indicatorSearch, setIndicatorSearch] = React.useState("");
  const [tableCandidates, setTableCandidates] = React.useState<RelatedTableSummary[]>([]);
  const [indicatorCandidates, setIndicatorCandidates] = React.useState<RelatedIndicatorSummary[]>([]);
  const [refLoading, setRefLoading] = React.useState(false);
  const [refError, setRefError] = React.useState("");
  const [referenceRetryRevision, setReferenceRetryRevision] = React.useState(0);
  const [domains, setDomains] = React.useState<string[]>([]);
  const [people, setPeople] = React.useState<string[]>([]);
  const [reportItems, setReportItems] = React.useState<MockReportItem[]>([]);
  const [remoteReportOptions, setRemoteReportOptions] = React.useState<RemoteReportOptions | undefined>();
  const reportOptionSets = React.useMemo(
    () => buildReportOptionSets(reportItems, remoteReportOptions),
    [reportItems, remoteReportOptions],
  );
  const [reportOptionsLoading, setReportOptionsLoading] = React.useState(isRemoteMode);
  const [reportOptionsError, setReportOptionsError] = React.useState("");
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

    setRefLoading(true);
    setRefError("");
    setReportOptionsLoading(isRemoteMode);
    setReportOptionsError("");

    void Promise.all([
      getAssetTables(),
      getIndicatorList(),
      getDomains(),
      getReportList(),
    ] as const).then(([loadedTables, indicators, domainItems, loadedReports]) => {
      if (cancelled) return;
      const tables = Array.isArray(loadedTables) ? loadedTables : [];
      const reports = Array.isArray(loadedReports) ? loadedReports : [];
      setReportItems(reports);
      setTableCandidates(tables.map(normalizeTableCandidate));
      setIndicatorCandidates((Array.isArray(indicators) ? indicators : []).map(normalizeIndicatorCandidate));
      setDomains((Array.isArray(domainItems) ? domainItems : []).map((item) => item.name).filter(Boolean));
      const peopleValues = [
        ...reports.flatMap((item) => [item.ownerName, item.maintainerName]),
        ...tables.map((item) => item.owner),
      ].filter((item): item is string => Boolean(item && item.trim()));
      setPeople([...new Set(peopleValues)].sort((a, b) => a.localeCompare(b, "zh-CN")));
    }).catch((error: unknown) => {
      if (!cancelled) setRefError(getErrorMessage(error, tRef.current("editor.messages.referenceLoadError")));
    }).finally(() => {
      if (!cancelled) setRefLoading(false);
    });

    if (isRemoteMode) {
      // Load the authority independently: a slow/empty report list cannot delay
      // or erase valid server candidates, and the completion order is irrelevant.
      void getReportOptions().then((options) => {
        if (!cancelled) setRemoteReportOptions(options);
      }).catch((error: unknown) => {
        if (!cancelled) {
          setRemoteReportOptions(undefined);
          setReportOptionsError(getErrorMessage(error, tRef.current("editor.messages.reportOptionsRetryError")));
        }
      }).finally(() => {
        if (!cancelled) setReportOptionsLoading(false);
      });
    } else {
      setRemoteReportOptions(undefined);
      setReportOptionsLoading(false);
    }
    return () => {
      cancelled = true;
    };
  }, [isRemoteMode, referenceRetryRevision]);

  const errors: FormFieldErrors = React.useMemo(
    () => mergeFormFieldErrors(serverFieldErrors, touched ? validateReportForm(form, t) : {}),
    [form, serverFieldErrors, t, touched],
  );
  const hasLifecycleErrors = Boolean(errors["effectiveDate"] || errors["expireDate"]);

  React.useLayoutEffect(() => {
    if (!validationFocusRequest || handledFocusRequestRef.current === validationFocusRequest) return;
    handledFocusRequestRef.current = validationFocusRequest;

    let firstInvalidField = "";
    for (const marker of formRef.current?.querySelectorAll<HTMLElement>("[data-form-field]") ?? []) {
      const field = marker.getAttribute("data-form-field");
      if (field && errors[field]) {
        firstInvalidField = field;
        break;
      }
    }
    if (firstInvalidField === "effectiveDate" || firstInvalidField === "expireDate") {
      if (lifecycleDetailsRef.current) lifecycleDetailsRef.current.open = true;
    }
    focusFirstFormError(formRef.current, errors, "auto");
  }, [errors, validationFocusRequest]);

  React.useLayoutEffect(() => {
    if (!serverFieldErrorFocusRequest) return;
    if (serverFieldErrorFocusRequest["effectiveDate"] || serverFieldErrorFocusRequest["expireDate"]) {
      if (lifecycleDetailsRef.current) lifecycleDetailsRef.current.open = true;
    }
    focusFirstFormError(formRef.current, serverFieldErrorFocusRequest, "smooth");
  }, [serverFieldErrorFocusRequest]);

  const setValues = (nextValues: Partial<ReportFormData>) => {
    Object.keys(nextValues).forEach((field) => onClearServerFieldError?.(field));
    setForm((prev) => ({ ...prev, ...nextValues }));
  };

  const setValue = <K extends keyof ReportFormData>(key: K, value: ReportFormData[K]) => {
    setValues({ [key]: value });
  };

  const tableOptions = React.useMemo(() => {
    const keyword = tableSearch.trim().toLowerCase();
    const selected = new Set(form.relatedTables.map(tableReferenceKey));
    return tableCandidates.map(withReferenceKey).filter((item) => {
      if (selected.has(tableReferenceKey(item))) return false;
      if (!keyword) return true;
      return [item.tableName, item.tableCn, item.domain, item.layer]
        .some((value) => String(value || "").toLowerCase().includes(keyword));
    }).slice(0, 20);
  }, [form.relatedTables, tableCandidates, tableSearch]);

  const selectedTableReferences = React.useMemo(
    () => form.relatedTables.map(withReferenceKey),
    [form.relatedTables],
  );

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
    setValues({ relatedTables: [...form.relatedTables, withReferenceKey(item)] });
  };

  const removeRelatedTable = (referenceKey: string) => {
    setValues({ relatedTables: form.relatedTables.filter((item) => tableReferenceKey(item) !== referenceKey) });
  };

  const addRelatedIndicator = (item: RelatedIndicatorSummary) => {
    setValues({ relatedIndicators: [...form.relatedIndicators, item] });
  };

  const removeRelatedIndicator = (indicatorId: string) => {
    setValues({ relatedIndicators: form.relatedIndicators.filter((item) => item.indicatorId !== indicatorId) });
  };

  const submit = () => {
    const nextErrors = validateReportForm(form, t);
    setTouched(true);
    if (saveBusy) return;
    if (Object.keys(nextErrors).length) {
      setValidationFocusRequest((request) => request + 1);
      return;
    }

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
    <div id={REPORT_FORM_ID} ref={formRef}>
      <PageHeader
        breadcrumbs={[
          { label: t("moduleTitle"), onClick: onCancel },
          { label: isEdit ? t("editor.edit") : t("editor.create") },
        ]}
        icon={isEdit ? "edit" : "plus"}
        title={isEdit ? t("editor.edit") : t("editor.create")}
        subtitle={isEdit ? form.code : t("editor.newSubtitle")}
      />

      <FormErrorSummary
        formId={REPORT_FORM_ID}
        errors={errors}
        title={t("editor.errorSummaryTitle")}
        getFieldLabel={(field) => REPORT_FIELD_LABEL_KEYS[field] ? t(REPORT_FIELD_LABEL_KEYS[field]) : t("editor.formField")}
        onBeforeFocus={(field) => {
          if (field === "effectiveDate" || field === "expireDate") {
            if (lifecycleDetailsRef.current) lifecycleDetailsRef.current.open = true;
          }
        }}
      />
      {reportOptionsError ? (
        <div className="match-hint" role="alert" style={{ color: "var(--danger)" }}>
          {t("editor.messages.reportOptionsError", { error: reportOptionsError })}
          <button className="btn" type="button" onClick={() => setReferenceRetryRevision((revision) => revision + 1)}>
            {t("editor.messages.retryReportOptions")}
          </button>
        </div>
      ) : null}
      {reportOptionsLoading ? <div className="match-hint" role="status">{t("editor.messages.reportOptionsLoading")}</div> : null}

      <div className="form-card">
        <h3><Icon name="hash" size={14} />{t("editor.basicInfo")}</h3>
        <div className="form-grid">
          <FormField className="fl" formId={REPORT_FORM_ID} name="code" label={t("editor.fields.code")} error={errors["code"]}>
            <Input aria-label={t("editor.fields.code")} className={`inp mono${errors["code"] ? " invalid" : ""}`} value={form.code} onChange={(event) => setValue("code", event.target.value)} placeholder={t("editor.placeholders.code")} />
          </FormField>
          <FormField className="fl" formId={REPORT_FORM_ID} name="name" label={t("editor.fields.name")} error={errors["name"]}>
            <Input aria-label={t("editor.fields.name")} className={`inp${errors["name"] ? " invalid" : ""}`} value={form.name} onChange={(event) => setValue("name", event.target.value)} placeholder={t("editor.placeholders.name")} />
          </FormField>
          <div className="fl">
            <label>{t("editor.fields.alias")}</label>
            <Input aria-label={t("editor.fields.alias")} className="inp" value={form.alias} onChange={(event) => setValue("alias", event.target.value)} placeholder={t("editor.placeholders.alias")} />
          </div>
          <FormField className="fl" formId={REPORT_FORM_ID} name="type" label={t("editor.fields.type")} error={errors["type"]}>
            <>
              <Select<string>
                aria-label={t("editor.fields.type")}
                aria-invalid={Boolean(errors["type"])}
                className={`sel${errors["type"] ? " invalid" : ""}`}
                placeholder={t("editor.placeholders.type")}
                items={[{ label: t("editor.placeholders.type"), value: "" }, ...getLegacyAwareOptions(normalizeDictOptions(reportTypeOptions), form.type).map((item) => ({ label: item.name, value: item.value }))]}
                value={form.type || ""}
                onValueChange={(value) => setValue("type", value || "")}
              />
              {isRemoteMode && !reportOptionsLoading && !reportOptionsError && reportTypeOptions.length === 0 ? (
                <div className="match-hint" role="status">{t("editor.messages.typeNotConfigured")}</div>
              ) : null}
            </>
          </FormField>
          <div className="fl">
            <label>{t("editor.fields.status")}</label>
            <BinaryStatusToggle mode="status" ariaLabel={t("editor.fields.status")} labels={{ enabled: t("status.enabled"), disabled: t("status.disabled") }} value={form.status} onChange={(value) => setValue("status", normalizeStatus(value))} />
          </div>
        </div>
      </div>

      <div className="form-card">
        <h3><Icon name="user" size={14} />{t("editor.ownership")}</h3>
        <div className="form-grid">
          <FormField className="fl" formId={REPORT_FORM_ID} name="domain" label={t("editor.fields.domain")} error={errors["domain"]}>
            <Select<string>
              aria-label={t("editor.fields.domain")}
              className={`sel${errors["domain"] ? " invalid" : ""}`}
              placeholder={t("editor.placeholders.domain")}
              items={[{ label: t("editor.placeholders.domain"), value: "" }, ...[...new Set([...domains, ...(form.domain ? [form.domain] : [])])].map((name) => ({ label: name, value: name }))]}
              value={form.domain || ""}
              onValueChange={(value) => setValue("domain", value || "")}
            />
          </FormField>
          <FormField className="fl" formId={REPORT_FORM_ID} name="ownerDept" label={t("editor.fields.ownerDept")} error={errors["ownerDept"]}>
            <>
              <Select<string>
                aria-label={t("editor.fields.ownerDept")}
                aria-invalid={Boolean(errors["ownerDept"])}
                className={`sel${errors["ownerDept"] ? " invalid" : ""}`}
                placeholder={t("editor.placeholders.ownerDept")}
                items={[{ label: t("editor.placeholders.ownerDept"), value: "" }, ...getLegacyAwareOptions(normalizeDictOptions(departmentOptions), form.ownerDept).map((item) => ({ label: item.name, value: item.value }))]}
                value={form.ownerDept || ""}
                onValueChange={(value) => setValue("ownerDept", value || "")}
              />
              {isRemoteMode && !reportOptionsLoading && !reportOptionsError && departmentOptions.length === 0 ? (
                <div className="match-hint" role="status">{t("editor.messages.departmentNotConfigured")}</div>
              ) : null}
            </>
          </FormField>
          <FormField className="fl" formId={REPORT_FORM_ID} name="ownerName" label={t("editor.fields.ownerName")} error={errors["ownerName"]}>
            <Input aria-label={t("editor.fields.ownerName")} className={`inp${errors["ownerName"] ? " invalid" : ""}`} list="report-person-options" value={form.ownerName} onChange={(event) => setValues({ ownerName: event.target.value, ...(form.maintainerSameAsOwner ? { maintainerName: event.target.value } : {}) })} placeholder={t("editor.placeholders.ownerName")} />
          </FormField>
          <div className="fl">
            <Checkbox
              label={t("editor.fields.maintainerDifferent")}
              checked={!form.maintainerSameAsOwner}
              onCheckedChange={(checked) => setValues({ maintainerSameAsOwner: !checked, maintainerName: checked ? form.maintainerName : form.ownerName })}
            />
            {!form.maintainerSameAsOwner ? <Input aria-label={t("editor.fields.maintainer")} className="inp" list="report-person-options" value={form.maintainerName} onChange={(event) => setValue("maintainerName", event.target.value)} placeholder={t("editor.placeholders.maintainer")} /> : <div className="match-hint">{t("editor.messages.maintainerSameAsOwner")}</div>}
          </div>
        </div>
      </div>

      <div className="form-card">
        <h3><Icon name="book" size={14} />{t("editor.caliber")}</h3>
        <div className="form-grid">
          <div className="fl">
            <label>{t("editor.fields.statObject")}</label>
            <Input aria-label={t("editor.fields.statObject")} className="inp" value={form.statObject} onChange={(event) => setValue("statObject", event.target.value)} placeholder={t("editor.placeholders.statObject")} />
          </div>
          <FormField className="fl" formId={REPORT_FORM_ID} name="statPeriod" label={t("editor.fields.statPeriod")} error={errors["statPeriod"]}>
            <>
              <Select<string>
                aria-label={t("editor.fields.statPeriod")}
                aria-invalid={Boolean(errors["statPeriod"])}
                className={`sel${errors["statPeriod"] ? " invalid" : ""}`}
                placeholder={t("editor.placeholders.statPeriod")}
                items={[{ label: t("editor.placeholders.statPeriod"), value: "" }, ...getLegacyAwareOptions(normalizeDictOptions(periodOptions), form.statPeriod).map((item) => ({ label: item.name, value: item.value }))]}
                value={form.statPeriod || ""}
                onValueChange={(value) => setValue("statPeriod", value || "")}
              />
              {isRemoteMode && !reportOptionsLoading && !reportOptionsError && periodOptions.length === 0 ? (
                <div className="match-hint" role="status">{t("editor.messages.periodNotConfigured")}</div>
              ) : null}
            </>
          </FormField>
          <FormField className="fl full" formId={REPORT_FORM_ID} name="statCaliber" label={t("editor.fields.statCaliber")} error={errors["statCaliber"]}>
            <>
              <DictInput value={form.statCaliber} onChange={(value) => setValue("statCaliber", value)} options={statCaliberOptions} listId="report-stat-caliber-options" invalid={Boolean(errors["statCaliber"])} aria-invalid={Boolean(errors["statCaliber"])} placeholder={t("editor.placeholders.statCaliber")} />
              {isRemoteMode && !reportOptionsLoading && !reportOptionsError && statCaliberOptions.length === 0 ? (
                <div className="match-hint" role="status">{t("editor.messages.caliberNotConfigured")}</div>
              ) : null}
            </>
          </FormField>
          <details className="fl full">
            <summary>{t("editor.messages.optionalMore")}</summary>
            <div className="form-grid" style={{ marginTop: 12 }}>
              <div className="fl"><label>{t("editor.fields.dataDelay")}</label><DictInput value={form.dataDelay} onChange={(value) => setValue("dataDelay", value)} options={dataDelayOptions} listId="report-data-delay-options" placeholder={t("editor.placeholders.dataDelay")} />{isRemoteMode && !reportOptionsLoading && !reportOptionsError && dataDelayOptions.length === 0 ? <div className="match-hint" role="status">{t("editor.messages.dataDelayNotConfigured")}</div> : null}</div>
              <div className="fl full"><label>{t("editor.fields.businessScopeTags")}</label><Input aria-label={t("editor.fields.businessScopeTags")} className="inp" value={form.businessScopeTags} onChange={(event) => setValue("businessScopeTags", event.target.value)} placeholder={t("editor.placeholders.businessScopeTags")} /></div>
            </div>
          </details>
        </div>
      </div>

      <div className="form-card">
        <h3><Icon name="info" size={14} />{t("editor.additional")}</h3>
        <div className="form-grid">
          <div className="fl full"><label>{t("editor.fields.purpose")}</label><Textarea aria-label={t("editor.fields.purpose")} className="ta" value={form.purpose} onChange={(event) => setValue("purpose", event.target.value)} placeholder={t("editor.placeholders.purpose")} /></div>
          <div className="fl full"><label>{t("editor.fields.filterCondition")}</label><Textarea aria-label={t("editor.fields.filterCondition")} className="ta" value={form.filterCondition} onChange={(event) => setValue("filterCondition", event.target.value)} placeholder={t("editor.placeholders.filterCondition")} /></div>
          <div className="fl full"><label>{t("editor.fields.specialRule")}</label><Textarea aria-label={t("editor.fields.specialRule")} className="ta" value={form.specialRule} onChange={(event) => setValue("specialRule", event.target.value)} placeholder={t("editor.placeholders.specialRule")} /></div>
          <div className="fl full"><label>{t("editor.fields.remark")}</label><Textarea aria-label={t("editor.fields.remark")} className="ta" value={form.remark} onChange={(event) => setValue("remark", event.target.value)} placeholder={t("editor.placeholders.remark")} /></div>
        </div>
      </div>

      <details
        ref={lifecycleDetailsRef}
        className="form-card"
        onToggle={(event) => {
          if (hasLifecycleErrors && !event.currentTarget.open) event.currentTarget.open = true;
        }}
      >
        <summary><Icon name="calendar" size={14} />{t("editor.messages.lifecycle")}</summary>
        <div className="form-grid" style={{ marginTop: 16 }}>
          <FormField className="fl" formId={REPORT_FORM_ID} name="effectiveDate" label={t("editor.fields.effectiveDate")} error={errors["effectiveDate"]}>
            <Input aria-label={t("editor.fields.effectiveDate")} type="date" className={`inp mono${errors["effectiveDate"] ? " invalid" : ""}`} value={form.effectiveDate} onChange={(event) => setValue("effectiveDate", event.target.value)} />
          </FormField>
          <FormField className="fl" formId={REPORT_FORM_ID} name="expireDate" label={t("editor.fields.expireDate")} error={errors["expireDate"]}>
            <Input aria-label={t("editor.fields.expireDate")} type="date" className={`inp mono${errors["expireDate"] ? " invalid" : ""}`} value={form.expireDate} min={form.effectiveDate || undefined} onChange={(event) => setValue("expireDate", event.target.value)} />
          </FormField>
        </div>
      </details>

      <datalist id="report-person-options">{people.map((name) => <option key={name} value={name} />)}</datalist>

      <div className="form-card">
        <h3><Icon name="link" size={14} />{t("editor.references")}</h3>
        {refError ? (
          <div className="match-hint" role="alert" style={{ color: "var(--danger)" }}>
            {refError}{" "}
            <button className="btn" type="button" onClick={() => setReferenceRetryRevision((revision) => revision + 1)}>{t("editor.messages.retryReferences")}</button>
          </div>
        ) : null}
        {refLoading ? <div className="match-hint">{t("editor.messages.referencesLoading")}</div> : null}
        <div className="report-picker-grid">
          <AssetReferencePicker
            title={t("editor.messages.tableReference")}
            searchValue={tableSearch}
            onSearchChange={setTableSearch}
            candidates={tableOptions}
            selectedItems={selectedTableReferences}
            itemKey="refKey"
            titleKey="tableName"
            subtitleBuilder={(item) => [item.layer, item.domain, item.tableCn].filter(Boolean).join(" / ")}
            onAdd={addRelatedTable}
            onRemove={removeRelatedTable}
            emptyText={t("editor.messages.noTableCandidate")}
          />
          <AssetReferencePicker
            title={t("editor.messages.indicatorReference")}
            searchValue={indicatorSearch}
            onSearchChange={setIndicatorSearch}
            candidates={indicatorOptions}
            selectedItems={form.relatedIndicators}
            itemKey="indicatorId"
            titleKey="indicatorId"
            subtitleBuilder={(item) => [item.indicatorName, item.path].filter(Boolean).join(" / ")}
            onAdd={addRelatedIndicator}
            onRemove={removeRelatedIndicator}
            emptyText={t("editor.messages.noIndicatorCandidate")}
          />
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
              key: "delete-report",
              label: t("editor.delete"),
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
