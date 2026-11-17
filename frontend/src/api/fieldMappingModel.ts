export const LOAD_MODE_META: Readonly<Record<string, { label: string; tone: string }>> = {
  full: { label: "全量", tone: "tag-neutral" },
  incr: { label: "增量", tone: "tag-ok" },
  incr_zip: { label: "增量拉链", tone: "tag-info" },
  full_zip: { label: "全量拉链", tone: "tag-warn" },
};

export function hasConfiguredFieldMappingValue(value: unknown): boolean {
  return String(value ?? "").trim().length > 0;
}

export function isKnownFieldMappingLoadMode(value: unknown): boolean {
  const rawValue = String(value ?? "").trim();
  return Boolean(rawValue) && Object.prototype.hasOwnProperty.call(LOAD_MODE_META, rawValue);
}

export function formatFieldMappingLoadMode(value: unknown): string {
  const rawValue = String(value ?? "").trim();
  if (!rawValue) return "未设置";
  return LOAD_MODE_META[rawValue]?.label ?? `未知（${rawValue}）`;
}

export function isCompleteFieldMappingTableConfig(
  row: { targetLayer?: unknown; targetTable?: unknown; loadMode?: unknown },
): boolean {
  return hasConfiguredFieldMappingValue(row.targetLayer)
    && hasConfiguredFieldMappingValue(row.targetTable)
    && isKnownFieldMappingLoadMode(row.loadMode);
}
