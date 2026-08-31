export const BINARY_STATUS_LABELS = {
  enabled: "启用",
  disabled: "禁用",
};

// Legacy values are read-only compatibility input. New UI options and writes
// must always use the canonical enabled/disabled pair.
const LEGACY_BINARY_VALUES = {
  active: "enabled",
  inactive: "disabled",
  draft: "disabled",
  stop: "disabled",
  stopped: "disabled",
};

const LEGACY_BINARY_LABELS = {
  启用: "enabled",
  停用: "disabled",
  已启用: "enabled",
  已停用: "disabled",
};

export const BINARY_STATUS_OPTIONS = [
  { value: "enabled", name: BINARY_STATUS_LABELS.enabled },
  { value: "disabled", name: BINARY_STATUS_LABELS.disabled },
];

export function normalizeBinaryStatusValue(value) {
  if (value === true) return "enabled";
  if (value === false) return "disabled";
  if (typeof value !== "string") return null;

  const normalized = value.trim().toLowerCase();
  if (normalized === "enabled" || normalized === "disabled") return normalized;
  return LEGACY_BINARY_VALUES[normalized] || LEGACY_BINARY_LABELS[value.trim()] || null;
}

export function getBinaryStatusValue(value) {
  return normalizeBinaryStatusValue(value) || "enabled";
}

export function normalizeBinaryStatusLabel(value, fallback) {
  const normalized = normalizeBinaryStatusValue(value);
  if (normalized) return BINARY_STATUS_LABELS[normalized];

  if (typeof fallback === "string") {
    const fallbackValue = normalizeBinaryStatusValue(fallback);
    if (fallbackValue) return BINARY_STATUS_LABELS[fallbackValue];
  }

  return fallback || (typeof value === "string" ? value : "-");
}

export function normalizeBinaryStatusOptions(options = []) {
  const source = Array.isArray(options) && options.length ? options : BINARY_STATUS_OPTIONS;
  const seen = new Set();
  const normalized = [];
  for (const item of source) {
    const value = normalizeBinaryStatusValue(item?.value);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    normalized.push({ ...item, value, name: BINARY_STATUS_LABELS[value] });
  }
  return normalized.length ? normalized : BINARY_STATUS_OPTIONS;
}
