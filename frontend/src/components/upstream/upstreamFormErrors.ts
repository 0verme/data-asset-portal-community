import { isValidTime } from "../common/time.ts";
import { getUpstreamFieldLabel } from "./upstreamFieldContract.ts";

export const UPSTREAM_SAVE_GENERIC_ERROR = "保存失败，请检查填写内容。";
export const UPSTREAM_SAVE_RETRY_ERROR = "保存失败，请稍后重试。";

export interface UpstreamFormError {
  field: string | null;
  label: string;
  message: string;
  rawMessage?: string;
}

export interface UpstreamApiErrorResult {
  fieldErrors: UpstreamFormError[];
  message: string;
  rawMessage: string;
}

type UnknownRecord = Record<string, unknown>;
type UpstreamField =
  | "form"
  | "id"
  | "abbr"
  | "name"
  | "dbType"
  | "owner"
  | "dept"
  | "status"
  | "host"
  | "db"
  | "schema"
  | "unloadTimes";

const FIELD_ALIASES: Readonly<Record<string, UpstreamField>> = Object.freeze({
  body: "form",
  db_type: "dbType",
  dept_name: "dept",
  host_name: "host",
  status_code: "status",
  system_id: "id",
  unload_times: "unloadTimes",
});

const KNOWN_FIELDS = new Set<UpstreamField>([
  "form",
  "id",
  "abbr",
  "name",
  "dbType",
  "owner",
  "dept",
  "status",
  "host",
  "db",
  "schema",
  "unloadTimes",
]);

const FIELD_PATH_PATTERN = /^([A-Za-z_$][\w$]*)(?:\[(\d+)\]|\.(\d+))?$/;
const DETAIL_FIELD_PATTERN = /^([A-Za-z_$][\w$]*(?:\[\d+\]|\.\d+)?)\s*[:：]\s*(.+)$/;
const INTERNAL_FIELD_PATTERN = /\b(?:id|abbr|name|dbType|owner|dept|status|host|db|schema|unloadTimes|body)\b/i;
const TECHNICAL_ERROR_PATTERN = /\b(?:is required|is not allowed|field required|validation(?: error| failed)?|422)\b/i;

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : String(value ?? "").trim();
}

function baseField(field: string | null): string {
  return field?.split("[")[0] || "";
}

function fieldLabel(field: string | null): string {
  const base = baseField(field) as UpstreamField;
  if (!KNOWN_FIELDS.has(base)) return "表单内容";
  if (base === "form") return "表单内容";
  return String(getUpstreamFieldLabel(base));
}

function normalizeFieldPath(value: unknown): string | null {
  const rawField = text(value);
  if (!rawField) return null;

  const match = FIELD_PATH_PATTERN.exec(rawField);
  if (!match) return null;

  const rawBase = match[1];
  if (!rawBase) return null;
  const canonicalBase = FIELD_ALIASES[rawBase] || rawBase as UpstreamField;
  if (!KNOWN_FIELDS.has(canonicalBase)) return null;

  const index = match[2] ?? match[3];
  if (index !== undefined && canonicalBase !== "unloadTimes") return null;
  return index === undefined ? canonicalBase : `${canonicalBase}[${index}]`;
}

function getApiError(error: unknown): UnknownRecord | null {
  const errorRecord = asRecord(error);
  const payload = asRecord(errorRecord?.["payload"]);
  return asRecord(payload?.["error"]);
}

function getErrorDetails(error: unknown): unknown[] {
  const details = getApiError(error)?.["details"];
  return Array.isArray(details) ? details : [];
}

function getErrorCode(error: unknown): string {
  return text(getApiError(error)?.["code"]).toUpperCase();
}

function getRawErrorMessage(error: unknown): string {
  const errorRecord = asRecord(error);
  const apiError = getApiError(error);
  return text(apiError?.["message"]) || text(errorRecord?.["message"]);
}

function readDetail(detail: unknown): { field: string | null; rawMessage: string } {
  if (typeof detail === "string") {
    const rawMessage = detail.trim();
    const match = DETAIL_FIELD_PATTERN.exec(rawMessage);
    return {
      field: normalizeFieldPath(match?.[1]),
      rawMessage: match?.[2]?.trim() || rawMessage,
    };
  }

  const record = asRecord(detail);
  if (!record) return { field: null, rawMessage: "" };

  const location = Array.isArray(record["loc"]) ? record["loc"].slice().reverse().find((item) => typeof item === "string") : undefined;
  const rawField = record["field"] ?? location;
  const rawMessage = text(record["message"] ?? record["msg"]);
  return { field: normalizeFieldPath(rawField), rawMessage };
}

function allowedValue(rawMessage: string): string {
  return rawMessage.match(/(?:is not allowed|not allowed|not permitted)\s*:\s*(.+)$/i)?.[1]?.trim() || "";
}

function formatKnownMessage(field: string, rawMessage: string): string {
  const label = fieldLabel(field);
  const base = baseField(field);
  const lowerMessage = rawMessage.toLowerCase();

  if (base === "unloadTimes" && /at least one time|contain at least/i.test(lowerMessage)) {
    return "至少保留一个卸数时间点";
  }
  if (base === "unloadTimes" && /time format|hh:mm/.test(lowerMessage)) {
    return "卸数时间点格式必须为 HH:mm";
  }
  if (/is required|field required|must not be empty|cannot be empty|不能为空/i.test(rawMessage)) {
    return base === "dbType" ? "请选择数据库类型" : `${label}不能为空`;
  }
  if (/is not allowed|not allowed|not permitted|must be one of|invalid enum/i.test(lowerMessage)) {
    if (base === "dbType" || base === "dept") {
      const value = allowedValue(rawMessage);
      return value
        ? `${label}“${value}”当前不可用，请重新选择`
        : `${label}当前值不可用，请重新选择`;
    }
    if (base === "status") return "请选择有效的状态";
    return `${label}当前值不可用，请重新选择`;
  }
  if (base === "status" && /invalid/.test(lowerMessage)) return "请选择有效的状态";
  if (/format.*invalid|invalid format/.test(lowerMessage)) return `${label}格式不正确`;

  if (/[\u4e00-\u9fff]/.test(rawMessage) && !INTERNAL_FIELD_PATTERN.test(rawMessage) && !TECHNICAL_ERROR_PATTERN.test(rawMessage)) {
    return rawMessage;
  }
  return `${label}填写内容不符合要求`;
}

function buildFieldError(field: string | null, rawMessage: string): UpstreamFormError {
  const message = field ? formatKnownMessage(field, rawMessage) : UPSTREAM_SAVE_GENERIC_ERROR;
  return {
    field,
    label: fieldLabel(field),
    message,
    ...(rawMessage ? { rawMessage } : {}),
  };
}

function uniqueErrors(errors: readonly UpstreamFormError[]): UpstreamFormError[] {
  const seen = new Set<string>();
  return errors.filter((error) => {
    const key = error.field || "form";
    if (seen.has(key)) return false;
    seen.add(key);
    return Boolean(error.message);
  });
}

export function validateUpstreamForm(form: unknown): UpstreamFormError[] {
  const values = asRecord(form) || {};
  const errors: UpstreamFormError[] = [];
  const add = (field: string, message: string): void => {
    errors.push({ field, label: fieldLabel(field), message });
  };
  const value = (key: string): string => text(values[key]);
  const unloadTimes = Array.isArray(values["unloadTimes"]) ? values["unloadTimes"] : [];

  if (!value("id")) add("id", "系统标识不能为空");
  if (!value("abbr")) add("abbr", "系统简称不能为空");
  if (!value("name")) add("name", "系统名称不能为空");
  if (!value("dbType")) add("dbType", "请选择数据库类型");
  if (!value("host")) add("host", "JDBC 地址不能为空");
  if (!unloadTimes.length) {
    add("unloadTimes", "至少保留一个卸数时间点");
  } else {
    unloadTimes.forEach((item, index) => {
      if (!isValidTime(item)) add(`unloadTimes[${index}]`, "卸数时间点格式必须为 HH:mm");
    });
  }

  return errors;
}

export function normalizeUpstreamApiError(error: unknown): UpstreamApiErrorResult {
  const details = getErrorDetails(error);
  const fieldErrors = uniqueErrors(
    details
      .map((detail) => readDetail(detail))
      .filter(({ rawMessage }) => Boolean(rawMessage))
      .map(({ field, rawMessage }) => buildFieldError(field, rawMessage)),
  );
  const rawMessage = [
    ...details.map((detail) => readDetail(detail).rawMessage).filter(Boolean),
    getRawErrorMessage(error),
  ].join("；");

  if (fieldErrors.length) {
    return { fieldErrors, message: "", rawMessage };
  }

  const code = getErrorCode(error);
  const message = code === "UPSTREAM_SYSTEM_ALREADY_EXISTS"
    ? "系统标识已存在，请更换后重试。"
    : code === "UPSTREAM_DATA_SOURCE_ERROR"
      ? UPSTREAM_SAVE_RETRY_ERROR
      : UPSTREAM_SAVE_GENERIC_ERROR;
  return { fieldErrors: [], message, rawMessage };
}

export function mergeUpstreamFieldErrors(
  clientErrors: readonly UpstreamFormError[],
  serverErrors: readonly UpstreamFormError[],
): UpstreamFormError[] {
  return uniqueErrors([...clientErrors, ...serverErrors]);
}

export function getUpstreamErrorSummary(errors: readonly UpstreamFormError[]): string[] {
  const normalized = uniqueErrors(errors);
  if (!normalized.length) return [];
  return [
    `还有 ${normalized.length} 项需要修改`,
    ...Array.from(new Set(normalized.map((error) => error.label))),
  ];
}

export function isSameUpstreamField(left: string | null, right: string): boolean {
  return Boolean(left) && (left === right || baseField(left) === baseField(right));
}

export function scrollToFirstUpstreamError(errors: readonly UpstreamFormError[]): boolean {
  const fieldKeys = new Set(errors.map((error) => error.field).filter((field): field is string => Boolean(field)));
  if (!fieldKeys.size || typeof document === "undefined") return false;

  const fieldElement = Array.from(document.querySelectorAll<HTMLElement>("[data-form-field]")).find((element) => {
    const field = element.getAttribute("data-form-field");
    return field ? fieldKeys.has(field) : false;
  });
  if (!fieldElement) return false;

  fieldElement.scrollIntoView?.({ behavior: "smooth", block: "center" });
  const focusTarget = fieldElement.querySelector<HTMLElement>("input, select, textarea, button, [tabindex]");
  if (focusTarget && typeof focusTarget.focus === "function") {
    try {
      focusTarget.focus({ preventScroll: true });
    } catch {
      focusTarget.focus();
    }
  }
  return true;
}
