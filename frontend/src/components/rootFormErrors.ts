import type { FormFieldErrors } from "../ui/formErrors.ts";
import { ROOT_ABBR_RULE_MESSAGE, isValidRootAbbr } from "../utils/rootValidation.ts";

const identityCopy = (source: string, options: Readonly<Record<string, unknown>> = {}): string =>
  Object.entries(options).reduce(
    (message, [key, value]) => message.split(`{{${key}}}`).join(String(value)),
    source,
  );

export interface RootFormValidationValues {
  abbr: string;
  cn: string;
}

/** Keep local RootEditor validation keyed to the fields rendered by the editor. */
export function validateRootForm(
  form: RootFormValidationValues,
  existingAbbrs: readonly string[],
  oldAbbr = "",
  translate: (source: string, options?: Readonly<Record<string, unknown>>) => string = identityCopy,
): FormFieldErrors {
  const errors: Record<string, string> = {};
  const normalizedAbbr = form.abbr.trim();

  if (!normalizedAbbr) {
    errors["abbr"] = translate("词根缩写不能为空");
  } else if (!isValidRootAbbr(form.abbr)) {
    errors["abbr"] = translate(ROOT_ABBR_RULE_MESSAGE);
  } else if (existingAbbrs.some((item) => item === normalizedAbbr && item !== oldAbbr)) {
    errors["abbr"] = translate("词根 {{abbr}} 已存在", { abbr: normalizedAbbr });
  }

  if (!form.cn.trim()) errors["cn"] = translate("中文名不能为空");
  return errors;
}
