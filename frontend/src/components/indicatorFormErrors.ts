import type { FormFieldErrors } from "../ui/formErrors.ts";

export interface IndicatorFormValidationValues {
  id: string;
  name: string;
  registrar: string;
  registeredAt: string;
  path: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Keep local IndicatorEditor validation keyed to the rendered field paths. */
export function validateIndicatorForm(form: IndicatorFormValidationValues): FormFieldErrors {
  const errors: Record<string, string> = {};
  if (!form.id.trim()) errors["id"] = "指标 ID 不能为空";
  if (!form.name.trim()) errors["name"] = "指标中文名不能为空";
  if (!form.registrar.trim()) errors["registrar"] = "登记人不能为空";
  if (!DATE_RE.test(form.registeredAt.trim())) errors["registeredAt"] = "登记日期必须使用 yyyy-mm-dd";
  if (!form.path.trim()) errors["path"] = "指标路径不能为空";
  return errors;
}
