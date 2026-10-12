import type { FormFieldErrors } from "../../ui/formErrors.ts";

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
export function validateReportForm(form: ReportValidationValues): FormFieldErrors {
  const errors: Record<string, string> = {};
  const code = form.code.trim();
  if (!code) errors["code"] = "报表编码不能为空";
  else if (!REPORT_CODE_RE.test(code.toUpperCase())) {
    errors["code"] = "报表编码仅允许大写字母、数字、下划线和中划线，且需以字母开头";
  }

  if (!form.name.trim()) errors["name"] = "报表名称不能为空";
  if (!form.type.trim()) errors["type"] = "报表类型不能为空";
  if (!form.domain.trim()) errors["domain"] = "请选择主题域";
  if (!form.ownerDept.trim()) errors["ownerDept"] = "归属部门不能为空";
  if (!form.ownerName.trim()) errors["ownerName"] = "负责人不能为空";
  if (!form.statPeriod.trim()) errors["statPeriod"] = "请选择统计周期";
  if (!form.statCaliber.trim()) errors["statCaliber"] = "请选择或输入统计口径";

  if (form.effectiveDate.trim() && !DATE_RE.test(form.effectiveDate.trim())) {
    errors["effectiveDate"] = "生效日期必须使用 yyyy-mm-dd";
  }
  if (form.expireDate.trim() && !DATE_RE.test(form.expireDate.trim())) {
    errors["expireDate"] = "失效日期必须使用 yyyy-mm-dd";
  }
  const validEffectiveDate = DATE_RE.test(form.effectiveDate.trim());
  const validExpireDate = DATE_RE.test(form.expireDate.trim());
  if (validEffectiveDate && validExpireDate && form.expireDate.trim() < form.effectiveDate.trim()) {
    errors["expireDate"] = "失效日期不能早于生效日期";
  }
  return errors;
}
