import assert from "node:assert/strict";
import test from "node:test";

import { i18n, i18nReady } from "./index.ts";

function flattenKeys(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [prefix.replace(/_(zero|one|two|few|many|other)$/, "")];
  }
  return Object.entries(value).flatMap(([key, child]) => flattenKeys(child, prefix ? `${prefix}.${key}` : key));
}

test("zh-CN and en-US resources have matching keys in every namespace", async () => {
  await i18nReady;
  for (const namespace of ["common", "navigation", "auth", "warehouse", "search", "aiAsk", "apiAsset", "fieldMapping", "indicator", "lineage", "report"] as const) {
    const zh = i18n.getResourceBundle("zh-CN", namespace);
    const en = i18n.getResourceBundle("en-US", namespace);
    assert.deepEqual(
      [...new Set(flattenKeys(en))].sort(),
      [...new Set(flattenKeys(zh))].sort(),
      `${namespace} keys must match`,
    );
  }
});

test("both locales resolve known messages; missing keys never render a raw key", async () => {
  await i18nReady;
  assert.equal(i18n.t("app.documentTitle", { lng: "zh-CN", ns: "common" }), "数据资产管理与血缘分析平台");
  assert.equal(i18n.t("app.documentTitle", { lng: "en-US", ns: "common" }), "Data Asset Management and Lineage Platform");
  assert.equal(i18n.t("menus.dwm", { lng: "en-US", ns: "navigation" }), "Data Warehouse");
  assert.equal(i18n.t("missing.phase0.key", { lng: "en-US", ns: "common", defaultValue: "Fallback label" }), "Fallback label");
});

test("count and query interpolation is localized without changing the inserted value", async () => {
  await i18nReady;
  assert.equal(i18n.t("tableCountPrefix", { lng: "en-US", ns: "warehouse" }), "Total: ");
  assert.equal(i18n.t("tableCountSuffix", { lng: "en-US", ns: "warehouse", count: 1 }), " table");
  assert.equal(i18n.t("tableCountSuffix", { lng: "en-US", ns: "warehouse", count: 5 }), " tables");
  assert.equal(i18n.t("tableCountPrefix", { lng: "zh-CN", ns: "warehouse" }) + 5 + i18n.t("tableCountSuffix", { lng: "zh-CN", ns: "warehouse", count: 5 }), "共 5 张表");
  assert.equal(i18n.t("querySummary", { lng: "en-US", ns: "warehouse", query: "dwd.orders" }), ", matching “dwd.orders”");
});

test("Phase 1 search, AI, warehouse, and shared confirmation labels resolve in both locales", async () => {
  await i18nReady;
  assert.equal(i18n.t("portal.title", { lng: "en-US", ns: "search" }), "Data Asset Management and Lineage Platform");
  assert.equal(i18n.t("portal.searchButton", { lng: "zh-CN", ns: "search" }), "搜索");
  assert.equal(i18n.t("execution.stages.retrieval", { lng: "en-US", ns: "aiAsk" }), "Retrieve assets");
  assert.equal(i18n.t("execution.detail.noRagRequestNote", { lng: "en-US", ns: "aiAsk" }), "No request was sent to the RAG HTTP Search API.");
  assert.equal(i18n.t("editor.currentTable", { lng: "en-US", ns: "warehouse", name: "dwm_trade_order_item_di" }), "Current table: dwm.dwm_trade_order_item_di");
  assert.equal(i18n.t("section.question", { lng: "en-US", ns: "aiAsk", query: "订单金额在哪张表？" }), "Question: 订单金额在哪张表？");
  assert.equal(i18n.t("confirmation.keywordHint", { lng: "en-US", ns: "common", keyword: "dwm_trade_order_item_di" }), "Enter dwm_trade_order_item_di to confirm deletion.");
  assert.equal(i18n.t("confirmation.deleteWarningNamed", { lng: "en-US", ns: "common", typeLabel: "Data table", name: "dwm_trade_order_item_di" }), "Data table “dwm_trade_order_item_di” cannot be recovered after deletion. Please proceed with caution.");
});

test("Phase 2 field-mapping resources resolve labels and interpolated values in both locales", async () => {
  await i18nReady;
  assert.equal(i18n.t("page.title", { lng: "zh-CN", ns: "fieldMapping" }), "字段映射查询");
  assert.equal(i18n.t("page.title", { lng: "en-US", ns: "fieldMapping" }), "Field Mapping");
  assert.equal(i18n.t("stats.coverage", { lng: "en-US", ns: "fieldMapping", value: 82 }), "Coverage: 82%");
  assert.equal(i18n.t("context.currentOnly", { lng: "en-US", ns: "fieldMapping", source: "业务系统 · SYS" }), "Viewing only: 业务系统 · SYS");
  assert.equal(i18n.t("export.fieldFilename", { lng: "en-US", ns: "fieldMapping" }), "field-mapping-fields.csv");
  assert.equal(i18n.t("columns.sourceTable", { lng: "en-US", ns: "fieldMapping" }), "Source table");
  assert.equal(i18n.t("loadModes.full_zip", { lng: "en-US", ns: "fieldMapping" }), "Full with history");
});

test("Phase 2 indicator resources resolve display labels and preserve interpolated data", async () => {
  await i18nReady;
  assert.equal(i18n.t("page.title", { lng: "zh-CN", ns: "indicator" }), "指标管理");
  assert.equal(i18n.t("page.title", { lng: "en-US", ns: "indicator" }), "Indicators");
  assert.equal(i18n.t("filters.dimension", { lng: "en-US", ns: "indicator", dimension: "DWM" }), "Dimension: DWM");
  assert.equal(i18n.t("validation.pathRequired", { lng: "en-US", ns: "indicator" }), "Indicator path is required");
  assert.equal(i18n.t("editor.errorSummaryTitle", { lng: "en-US", ns: "indicator" }), "Check these fields");
});

test("Phase 2 lineage resources resolve localized chrome and keep route codes interpolated", async () => {
  await i18nReady;
  assert.equal(i18n.t("page.title", { lng: "en-US", ns: "lineage" }), "Lineage");
  assert.equal(i18n.t("filters.tableView", { lng: "en-US", ns: "lineage" }), "Table overview");
  assert.equal(i18n.t("search.label", { lng: "en-US", ns: "lineage" }), "Search by table or job name");
  assert.equal(i18n.t("assetNavigation.title", { lng: "en-US", ns: "lineage" }), "Lineage asset navigation");
  assert.equal(i18n.t("assetNavigation.tableCountSingular", { lng: "en-US", ns: "lineage" }), "1 table");
  assert.equal(i18n.t("assetNavigation.tableCount", { lng: "en-US", ns: "lineage", total: 8 }), "8 tables");
  assert.equal(i18n.t("assetNavigation.tableCountFiltered", { lng: "en-US", ns: "lineage", visible: 2, total: 8 }), "2 / 8 tables");
  assert.equal(i18n.t("assetNavigation.tableNodeLabel", { lng: "en-US", ns: "lineage", table: "orders", schema: "DWM", id: "table-1" }), "orders, DWM, node ID table-1");
  assert.equal(i18n.t("assetNavigation.unclassified", { lng: "en-US", ns: "lineage" }), "Unclassified");
  assert.equal(i18n.t("page.subtitle", { lng: "en-US", ns: "lineage", snapshotId: "snapshot-42" }), "Table-level exploration and job troubleshooting · Snapshot snapshot-42");
});

test("Phase 2 report resources resolve translated UI and interpolate dynamic data", async () => {
  await i18nReady;
  assert.equal(i18n.t("page.title", { lng: "en-US", ns: "report" }), "Report assets");
  assert.equal(i18n.t("editor.placeholders.code", { lng: "en-US", ns: "report" }), "Enter a report code");
  assert.equal(i18n.t("editor.errorSummaryTitle", { lng: "en-US", ns: "report" }), "Check these fields");
  assert.equal(i18n.t("page.summary", { lng: "en-US", ns: "report", count: 8 }), "8 report assets");
});

test("Phase 2 API asset resources localize labels without changing method values", async () => {
  await i18nReady;
  assert.equal(i18n.t("editor.create", { lng: "en-US", ns: "apiAsset" }), "Add API");
  assert.equal(i18n.t("fields.method", { lng: "en-US", ns: "apiAsset" }), "HTTP method");
  assert.equal(i18n.t("rows.rowName", { lng: "en-US", ns: "apiAsset", row: 2 }), "Row 2 name");
});

test("number and date interpolation use the selected locale's Intl formatting", async () => {
  await i18nReady;
  const value = 12_345.67;
  const date = new Date("2024-01-02T00:00:00.000Z");
  assert.equal(i18n.t("formatting.number", { lng: "zh-CN", ns: "common", value }), "12,345.67");
  assert.equal(i18n.t("formatting.number", { lng: "en-US", ns: "common", value }), "12,345.67");
  const chineseDate = i18n.t("formatting.date", { lng: "zh-CN", ns: "common", value: date });
  const englishDate = i18n.t("formatting.date", { lng: "en-US", ns: "common", value: date });
  assert.notEqual(chineseDate, englishDate);
  assert.match(chineseDate, /2024/);
  assert.match(englishDate, /2024/);
});
