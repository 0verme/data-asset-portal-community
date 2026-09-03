export type BinaryStatusValue = "enabled" | "disabled";

export const BINARY_STATUS_LABELS: Record<BinaryStatusValue, string> = {
  enabled: "启用",
  disabled: "禁用",
};

// Legacy values are read-only compatibility input. New UI options and writes
// must always use the canonical enabled/disabled pair.
const LEGACY_BINARY_VALUES: Record<string, BinaryStatusValue> = {
  active: "enabled",
  inactive: "disabled",
  draft: "disabled",
  stop: "disabled",
  stopped: "disabled",
};

const LEGACY_BINARY_LABELS: Record<string, BinaryStatusValue> = {
  启用: "enabled",
  停用: "disabled",
  已启用: "enabled",
  已停用: "disabled",
};

export interface BinaryStatusOption {
  value: unknown;
  name?: string | undefined;
  [key: string]: unknown;
}

export interface NormalizedBinaryStatusOption extends Omit<BinaryStatusOption, "value"> {
  value: BinaryStatusValue;
  name: string;
}

export const BINARY_STATUS_OPTIONS: readonly NormalizedBinaryStatusOption[] = [
  { value: "enabled", name: BINARY_STATUS_LABELS.enabled },
  { value: "disabled", name: BINARY_STATUS_LABELS.disabled },
];

export function normalizeBinaryStatusValue(value: unknown): BinaryStatusValue | null {
  if (value === true) return "enabled";
  if (value === false) return "disabled";
  if (typeof value !== "string") return null;

  const normalized = value.trim().toLowerCase();
  if (normalized === "enabled" || normalized === "disabled") return normalized;
  return LEGACY_BINARY_VALUES[normalized] || LEGACY_BINARY_LABELS[value.trim()] || null;
}

export function getBinaryStatusValue(value: unknown): BinaryStatusValue {
  return normalizeBinaryStatusValue(value) || "enabled";
}

export function normalizeBinaryStatusLabel(value: unknown, fallback?: unknown): string {
  const normalized = normalizeBinaryStatusValue(value);
  if (normalized) return BINARY_STATUS_LABELS[normalized];

  if (typeof fallback === "string") {
    const fallbackValue = normalizeBinaryStatusValue(fallback);
    if (fallbackValue) return BINARY_STATUS_LABELS[fallbackValue];
  }

  return typeof fallback === "string" && fallback
    ? fallback
    : typeof value === "string"
      ? value
      : "-";
}

export function normalizeBinaryStatusOptions(
  options: readonly BinaryStatusOption[] | undefined = [],
): NormalizedBinaryStatusOption[] {
  const source: readonly BinaryStatusOption[] = options.length ? options : BINARY_STATUS_OPTIONS;
  const seen = new Set<BinaryStatusValue>();
  const normalized: NormalizedBinaryStatusOption[] = [];
  for (const item of source) {
    const value = normalizeBinaryStatusValue(item.value);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    normalized.push({ ...item, value, name: BINARY_STATUS_LABELS[value] });
  }
  return normalized.length ? normalized : [...BINARY_STATUS_OPTIONS];
}
