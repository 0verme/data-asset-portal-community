import type { MockManualCodeTable } from "../../data/manualCodeTables.ts";

export interface ManualCodeTableFacetCounts {
  styleTotal: number;
  styles: Record<string, number>;
  statusTotal: number;
  statuses: { enabled: number; disabled: number };
}

export function getManualCodeTableFacetCounts(
  items: readonly MockManualCodeTable[],
  styles: readonly { value: string }[],
  query: string,
  styleFilter: string,
  statusFilter: string,
): ManualCodeTableFacetCounts {
  const keyword = String(query || "").trim().toLowerCase();
  const queryItems = items.filter((item) =>
    !keyword ||
    [item.tableCode, item.tableName, item.owner, item.remark].some((value) =>
      String(value || "").toLowerCase().includes(keyword),
    ),
  );
  const styleFacetItems = queryItems.filter(
    (item) => !statusFilter || item.status === statusFilter,
  );
  const statusFacetItems = queryItems.filter(
    (item) => !styleFilter || item.style === styleFilter,
  );

  return {
    styleTotal: styleFacetItems.length,
    styles: Object.fromEntries(
      styles.map((style) => [
        style.value,
        styleFacetItems.filter((item) => item.style === style.value).length,
      ]),
    ),
    statusTotal: statusFacetItems.length,
    statuses: {
      enabled: statusFacetItems.filter((item) => item.status === "enabled").length,
      disabled: statusFacetItems.filter((item) => item.status === "disabled").length,
    },
  };
}
