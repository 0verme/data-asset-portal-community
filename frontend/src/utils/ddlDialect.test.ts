import assert from "node:assert/strict";
import test from "node:test";

import { generateDDLByDialect } from "./ddlDialect.ts";

test("DDL uses only explicit schema metadata and preserves its exact value", () => {
  const qualified = generateDDLByDialect({ name: "DWD_TRADE_ORDER", layer: "DWD", schema: "Warehouse_A" });
  assert.match(qualified, /CREATE TABLE IF NOT EXISTS Warehouse_A\.DWD_TRADE_ORDER/);

  const unknown = generateDDLByDialect({ name: "DWD_TRADE_ORDER", layer: "DWD" });
  assert.match(unknown, /CREATE TABLE IF NOT EXISTS DWD_TRADE_ORDER/);
  assert.doesNotMatch(unknown, /dws_dwd|dws_dwm/i);

  const unavailable = generateDDLByDialect({ name: "DWD_TRADE_ORDER", schema: null });
  assert.match(unavailable, /CREATE TABLE IF NOT EXISTS DWD_TRADE_ORDER/);
});

test("same table names remain qualified by their separate schemas", () => {
  const schemaA = generateDDLByDialect({ name: "orders", schema: "sales_a" });
  const schemaB = generateDDLByDialect({ name: "orders", schema: "sales_b" });

  assert.match(schemaA, /CREATE TABLE IF NOT EXISTS sales_a\.orders/);
  assert.match(schemaB, /CREATE TABLE IF NOT EXISTS sales_b\.orders/);
});
