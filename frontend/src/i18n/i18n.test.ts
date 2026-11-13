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
  for (const namespace of ["common", "navigation", "auth", "warehouse", "search", "aiAsk"] as const) {
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
