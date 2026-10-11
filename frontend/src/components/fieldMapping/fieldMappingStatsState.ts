export type FieldMappingStatsStatus = "unknown" | "loading" | "error" | "ready";

export function fieldMappingStatDisplayValue(
  value: number | null | undefined,
  status: FieldMappingStatsStatus,
): number | string {
  if (typeof value === "number") return value;
  return status === "loading" ? "…" : "—";
}

export function fieldMappingStatsDisplayHint(
  status: FieldMappingStatsStatus,
  readyHint: string,
): string {
  if (status === "ready") return readyHint;
  if (status === "loading") return "统计加载中";
  if (status === "error") return "统计加载失败";
  return "等待统计";
}
