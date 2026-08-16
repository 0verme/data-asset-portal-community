export const ASSET_NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

export const ASSET_NAME_RULE_MESSAGE = "只允许字母、数字和下划线，且必须以字母开头。";

export function isValidAssetName(value) {
  return ASSET_NAME_RE.test(String(value || "").trim());
}
