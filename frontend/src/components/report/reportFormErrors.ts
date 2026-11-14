import type { TFunction } from "i18next";

import { normalizeApiError } from "../../api/errorNormalizer.ts";
import { formFieldErrorEntries, mapApiFormFieldErrors } from "../../utils/formFieldErrorMapping.ts";
import type { FormFieldErrors } from "../../ui/formErrors.ts";

export const REPORT_SERVER_FIELD_NAMES = [
  "code",
  "name",
  "type",
  "domain",
  "ownerDept",
  "ownerName",
  "statPeriod",
  "statCaliber",
  "effectiveDate",
  "expireDate",
] as const;

export interface ReportApiFieldErrors {
  fieldErrors: FormFieldErrors;
  hasUnmappedErrors: boolean;
}

export function mapReportApiFieldErrors(error: unknown, t?: TFunction<"report">): ReportApiFieldErrors {
  const normalized = normalizeApiError(error);
  if (normalized.code === "REPORT_ALREADY_EXISTS") {
    return { fieldErrors: { code: t ? t("validation.codeExists") : "该报表编码已存在，请修改后重试。" }, hasUnmappedErrors: false };
  }
  if (normalized.kind !== "validation" && normalized.kind !== "conflict") {
    return { fieldErrors: {}, hasUnmappedErrors: false };
  }

  const mapped = mapApiFormFieldErrors(error, REPORT_SERVER_FIELD_NAMES);
  return {
    fieldErrors: formFieldErrorEntries(mapped.filter(({ field }) => field !== "form")),
    hasUnmappedErrors: mapped.some(({ field }) => field === "form"),
  };
}

export interface ReportValidationValues {
  code: string;
  name: string;
  type: string;
  domain: string;
  statPeriod: string;
  statCaliber: string;
  ownerDept: string;
  ownerName: string;
  effectiveDate: string;
  expireDate: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const REPORT_CODE_RE = /^[A-Z][A-Z0-9_-]{2,63}$/;

/** Map existing ReportEditor local validation rules to their rendered field paths. */
export function validateReportForm(form: ReportValidationValues, t?: TFunction<"report">): FormFieldErrors {
  const errors: Record<string, string> = {};
  const text = (
    key: "validation.codeRequired" | "validation.codeFormat" | "validation.nameRequired" | "validation.typeRequired" | "validation.domainRequired" | "validation.ownerDepartmentRequired" | "validation.ownerRequired" | "validation.periodRequired" | "validation.caliberRequired" | "validation.effectiveDateFormat" | "validation.expireDateFormat" | "validation.expireDateBeforeEffective",
    fallback: string,
  ) => t ? t(key, { defaultValue: fallback }) : fallback;
  const code = form.code.trim();
  if (!code) errors["code"] = text("validation.codeRequired", "报表编码不能为空");
  else if (!REPORT_CODE_RE.test(code.toUpperCase())) {
    errors["code"] = text("validation.codeFormat", "报表编码仅允许大写字母、数字、下划线和中划线，且需以字母开头");
  }

  if (!form.name.trim()) errors["name"] = text("validation.nameRequired", "报表名称不能为空");
  if (!form.type.trim()) errors["type"] = text("validation.typeRequired", "报表类型不能为空");
  if (!form.domain.trim()) errors["domain"] = text("validation.domainRequired", "请选择主题域");
  if (!form.ownerDept.trim()) errors["ownerDept"] = text("validation.ownerDepartmentRequired", "归属部门不能为空");
  if (!form.ownerName.trim()) errors["ownerName"] = text("validation.ownerRequired", "负责人不能为空");
  if (!form.statPeriod.trim()) errors["statPeriod"] = text("validation.periodRequired", "请选择统计周期");
  if (!form.statCaliber.trim()) errors["statCaliber"] = text("validation.caliberRequired", "请选择或输入统计口径");

  if (form.effectiveDate.trim() && !DATE_RE.test(form.effectiveDate.trim())) {
    errors["effectiveDate"] = text("validation.effectiveDateFormat", "生效日期必须使用 yyyy-mm-dd");
  }
  if (form.expireDate.trim() && !DATE_RE.test(form.expireDate.trim())) {
    errors["expireDate"] = text("validation.expireDateFormat", "失效日期必须使用 yyyy-mm-dd");
  }
  const validEffectiveDate = DATE_RE.test(form.effectiveDate.trim());
  const validExpireDate = DATE_RE.test(form.expireDate.trim());
  if (validEffectiveDate && validExpireDate && form.expireDate.trim() < form.effectiveDate.trim()) {
    errors["expireDate"] = text("validation.expireDateBeforeEffective", "失效日期不能早于生效日期");
  }
  return errors;
}
