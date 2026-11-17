import assert from "node:assert/strict";
import test from "node:test";

import { getQualifiedAssetTableName } from "./assetTableName.ts";

test("qualified asset table names use the exact configured schema", () => {
  assert.equal(getQualifiedAssetTableName("DWD_TRADE_ORDER", "Warehouse_A"), "Warehouse_A.DWD_TRADE_ORDER");
});

test("missing schema remains unqualified instead of being guessed", () => {
  assert.equal(getQualifiedAssetTableName("DWD_TRADE_ORDER"), "DWD_TRADE_ORDER");
  assert.equal(getQualifiedAssetTableName("DWD_TRADE_ORDER", null), "DWD_TRADE_ORDER");
});
