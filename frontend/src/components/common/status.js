export const BINARY_STATUS_LABELS = {
  enabled: "启用",
  disabled: "禁用",
};

const LEGACY_BINARY_LABELS = {
  启用: "启用",
  停用: "禁用",
  已启用: "启用",
  已停用: "禁用",
};

export const BINARY_STATUS_OPTIONS = [
  { value: "enabled", name: BINARY_STATUS_LABELS.enabled },
  { value: "disabled", name: BINARY_STATUS_LABELS.disabled },
];

export function getBinaryStatusValue(value) {
  if (value === "disabled" || value === false) return "disabled";
  return "enabled";
}

export function normalizeBinaryStatusLabel(value, fallback) {
  if (value === "enabled" || value === true) return BINARY_STATUS_LABELS.enabled;
  if (value === "disabled" || value === false) return BINARY_STATUS_LABELS.disabled;

  if (typeof fallback === "string" && LEGACY_BINARY_LABELS[fallback]) {
    return LEGACY_BINARY_LABELS[fallback];
  }

  return fallback || (typeof value === "string" ? value : "-");
}

export function normalizeBinaryStatusOptions(options = []) {
  const source = Array.isArray(options) && options.length ? options : BINARY_STATUS_OPTIONS;
  return source.map((item) => ({
    ...item,
    name: normalizeBinaryStatusLabel(item?.value, item?.name),
  }));
}
