import assert from "node:assert/strict";
import test from "node:test";

import { i18n, i18nReady } from "./index.ts";

function flattenKeys(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [prefix.replace(/_(zero|one|two|few|many|other)$/, "")];
  }
  return Object.entries(value).flatMap(([key, child]) => flattenKeys(child, prefix ? `${prefix}.${key}` : key));
}

test("zh-CN and en-US resources have matching keys for Phase 0 namespaces", async () => {
  await i18nReady;
  for (const namespace of ["common", "navigation", "auth", "warehouse"] as const) {
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
