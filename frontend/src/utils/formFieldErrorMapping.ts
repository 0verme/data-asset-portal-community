import { normalizeApiError, type NormalizedApiErrorKind } from "../api/errorNormalizer.ts";
import { clearFormFieldErrors, type FormFieldErrors } from "../ui/formErrors.ts";

export interface FormFieldErrorEntry {
  field: string;
  message: string;
}

function safeFieldMessage(kind: NormalizedApiErrorKind): string {
  if (kind === "validation") return "服务端校验未通过，请检查此字段。";
  if (kind === "conflict") return "此字段与现有数据冲突，请修改后重试。";
  return "操作失败，请检查后重试。";
}

function readStructuredField(detail: unknown): string | null {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return null;
  const field = (detail as Record<string, unknown>)["field"];
  return typeof field === "string" && field.trim() ? field.trim() : null;
}

/** Convert a server error through the shared normalizer, allowing only caller-owned field paths. */
export function mapApiFormFieldErrors(
  error: unknown,
  allowedFields: readonly string[],
): FormFieldErrorEntry[] {
  const normalized = normalizeApiError(error);
  const allowed = new Set(allowedFields);
  const mapped: Record<string, string> = {};
  const details = Array.isArray(normalized.details)
    ? normalized.details
    : normalized.details && typeof normalized.details === "object"
      ? [normalized.details]
      : [];

  for (const detail of details) {
    const field = readStructuredField(detail);
    if (
      field
      && allowed.has(field)
      && (normalized.kind === "validation" || normalized.kind === "conflict")
    ) {
      mapped[field] = safeFieldMessage(normalized.kind);
    } else {
      mapped["form"] = normalized.safeMessage;
    }
  }

  if (!Object.keys(mapped).length) mapped["form"] = normalized.safeMessage;
  return Object.entries(mapped).map(([field, message]) => ({ field, message }));
}

export function formFieldErrorEntries(errors: readonly FormFieldErrorEntry[]): FormFieldErrors {
  return Object.fromEntries(
    errors
      .filter((item) => item.field.trim() && item.message.trim())
      .map((item) => [item.field, item.message]),
  );
}

export function clearFormFieldErrorEntry(
  errors: readonly FormFieldErrorEntry[],
  field: string,
): FormFieldErrorEntry[] {
  const remaining = clearFormFieldErrors(formFieldErrorEntries(errors), field);
  return Object.entries(remaining).map(([name, message]) => ({ field: name, message }));
}
