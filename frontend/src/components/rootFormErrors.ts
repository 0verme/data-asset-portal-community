import type { FormFieldErrors } from "../ui/formErrors.ts";
import { ROOT_ABBR_RULE_MESSAGE, isValidRootAbbr } from "../utils/rootValidation.ts";

export interface RootFormValidationValues {
  abbr: string;
  cn: string;
}

/** Keep local RootEditor validation keyed to the fields rendered by the editor. */
export function validateRootForm(
  form: RootFormValidationValues,
  existingAbbrs: readonly string[],
  oldAbbr = "",
): FormFieldErrors {
  const errors: Record<string, string> = {};
  const normalizedAbbr = form.abbr.trim();

  if (!normalizedAbbr) {
    errors["abbr"] = "词根缩写不能为空";
  } else if (!isValidRootAbbr(form.abbr)) {
    errors["abbr"] = ROOT_ABBR_RULE_MESSAGE;
  } else if (existingAbbrs.some((item) => item === normalizedAbbr && item !== oldAbbr)) {
    errors["abbr"] = `词根 ${normalizedAbbr} 已存在`;
  }

  if (!form.cn.trim()) errors["cn"] = "中文名不能为空";
  return errors;
}
