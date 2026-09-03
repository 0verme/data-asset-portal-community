import assert from "node:assert/strict";
import test from "node:test";

import { getAssetTables } from "./assets.ts";
import { getIndicatorList } from "./indicator.ts";

test("mock asset selector exposes deterministic local identities", async () => {
  const tables = await getAssetTables({ layer: "DWM" });
  assert.ok(tables.length > 0);
  assert.ok(tables.every((table) => Number.isInteger(table.assetId) && table.assetId > 0));
  assert.ok(tables.every((table) => table.fields.every((field) => field.fieldId > 0)));
  assert.ok(tables.every((table) => table.fields.every((field) => field.assetId === table.assetId)));
});

test("legacy mock indicators retain snapshots and additive semantic defaults", async () => {
  const indicators = await getIndicatorList();
  assert.ok(indicators.length > 0);
  assert.ok(indicators.every((indicator) => indicator.sourceAssetId === null));
  assert.ok(indicators.every((indicator) => indicator.resultFieldId === null));
  assert.ok(indicators.every((indicator) => indicator.semanticState === "candidate"));
  assert.ok(indicators.every((indicator) => indicator.resultTableName && indicator.resultFieldName));
});
