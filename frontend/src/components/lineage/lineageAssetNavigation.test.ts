import assert from "node:assert/strict";
import test from "node:test";

import type { LineageNode } from "../../api/lineage.ts";
import {
  buildLineageSchemaGroups,
  countLineageTables,
  filterLineageSchemaGroups,
  setAllLineageSchemasExpanded,
  toggleLineageSchemaExpansion,
  UNCLASSIFIED_SCHEMA_KEY,
} from "./lineageAssetNavigation.ts";

function node(
  id: string,
  name: string,
  namespace = "",
  attributes: Record<string, unknown> = {},
  kind = "table",
  schema?: string,
): LineageNode {
  return {
    id,
    name,
    kind,
    namespace,
    ...(schema !== undefined ? { schema } : {}),
    displayName: name,
    attributes,
  };
}

test("builds dynamic groups from table-node schema metadata, not table-name prefixes", () => {
  const groups = buildLineageSchemaGroups([
    node("t-2", "DWM_ORDER", "layer-dwm", { layer: "dwm" }, "table", "warehouse_b"),
    node("job-1", "JOB_BUILD_ORDER", "scheduler", {}, "task"),
    node("t-1", "DWD_CUSTOMER", "layer-dwd", { layer: "dwd", schema: "warehouse_a" }),
  ]);

  assert.deepEqual(groups.map(({ schemaName, tables }) => [schemaName, tables.map(({ name }) => name)]), [
    ["warehouse_a", ["DWD_CUSTOMER"]],
    ["warehouse_b", ["DWM_ORDER"]],
  ]);
});

test("normalizes schema presentation while preserving case-sensitive identities", () => {
  const groups = buildLineageSchemaGroups([
    node("lower", "ORDERS", "ignored", { schema: "sales" }),
    node("upper", "ORDERS", "ignored", { schemaName: "SALES" }),
  ]);

  assert.equal(groups.length, 2, "case-sensitive identifiers must not be merged");
  assert.deepEqual(groups.map(({ displayName }) => displayName), ["SALES", "SALES"]);
  assert.deepEqual(groups.map(({ schemaName }) => schemaName), ["SALES", "sales"]);
  assert.notEqual(groups[0]?.key, groups[1]?.key);

  const explicit = buildLineageSchemaGroups([
    node("top-level", "CUSTOMER", "processing-layer", { schema: "stale" }, "table", "curated"),
  ]);
  assert.equal(explicit[0]?.schemaName, "curated", "the explicit API schema field is authoritative");
});

test("puts tables without schema metadata in the unclassified group", () => {
  const groups = buildLineageSchemaGroups([
    node("missing", "TABLE_WITHOUT_SCHEMA", "source-finance"),
    node("blank", "TABLE_WITH_BLANK_SCHEMA", "processing-dwm", { schema: " " }),
  ]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.key, UNCLASSIFIED_SCHEMA_KEY);
  assert.equal(groups[0]?.displayName, "未分类");
  assert.equal(groups[0]?.tables.length, 2);
});

test("deduplicates by stable node ID and preserves same-name tables in distinct schemas", () => {
  const groups = buildLineageSchemaGroups([
    node("same-id", "SHARED_TABLE", "processing", { schema: "alpha" }),
    node("same-id", "SHARED_TABLE", "processing", { schema: "alpha" }),
    node("alpha-copy", "SHARED_TABLE", "processing", { schema: "alpha" }),
    node("beta-copy", "SHARED_TABLE", "processing", { schema: "beta" }),
  ]);

  assert.equal(countLineageTables(groups), 3);
  assert.deepEqual(groups.map((group) => group.tables.map(({ id }) => id)), [
    ["alpha-copy", "same-id"],
    ["beta-copy"],
  ]);
  assert.equal(new Set(groups.flatMap((group) => group.tables.map(({ id }) => id))).size, 3);
});

test("sorts schemas and tables deterministically", () => {
  const forward = buildLineageSchemaGroups([
    node("z", "Z_TABLE", "layer", { schema: "zeta" }),
    node("b", "B_TABLE", "layer", { schema: "alpha" }),
    node("a2", "a_table", "layer", { schema: "alpha" }),
    node("a1", "A_TABLE", "layer", { schema: "alpha" }),
  ]);
  const reverse = buildLineageSchemaGroups([
    node("a1", "A_TABLE", "layer", { schema: "alpha" }),
    node("a2", "a_table", "layer", { schema: "alpha" }),
    node("b", "B_TABLE", "layer", { schema: "alpha" }),
    node("z", "Z_TABLE", "layer", { schema: "zeta" }),
  ]);

  assert.deepEqual(forward, reverse);
  assert.deepEqual(forward.map(({ schemaName }) => schemaName), ["alpha", "zeta"]);
});

test("searches schema names or table names locally and restores all groups on clear", () => {
  const groups = buildLineageSchemaGroups([
    node("a1", "CUSTOMER", "layer", { schema: "sales" }),
    node("a2", "ORDER", "layer", { schema: "sales" }),
    node("b1", "ORDER_ARCHIVE", "layer", { schema: "archive" }),
  ]);

  const schemaMatches = filterLineageSchemaGroups(groups, "SALES");
  assert.deepEqual(schemaMatches.map((group) => group.tables.map(({ name }) => name)), [["CUSTOMER", "ORDER"]]);
  const tableMatches = filterLineageSchemaGroups(groups, "order");
  assert.deepEqual(tableMatches.map(({ schemaName, tables }) => [schemaName, tables.map(({ name }) => name)]), [
    ["archive", ["ORDER_ARCHIVE"]],
    ["sales", ["ORDER"]],
  ]);
  assert.deepEqual(filterLineageSchemaGroups(groups, "no-such-table"), []);
  assert.deepEqual(filterLineageSchemaGroups(groups, ""), groups);
  assert.equal(groups.length, 2, "filtering must not mutate the source expansion model");
});

test("supports schema toggle and all-expand/all-collapse operations", () => {
  const groups = buildLineageSchemaGroups([
    node("a", "A", "layer", { schema: "alpha" }),
    node("b", "B", "layer", { schema: "beta" }),
  ]);
  const [first, second] = groups;
  assert.ok(first && second);

  const initial = new Set([first.key]);
  const toggled = toggleLineageSchemaExpansion(initial, second.key);
  assert.deepEqual([...toggled], [first.key, second.key]);
  const collapsed = toggleLineageSchemaExpansion(toggled, first.key);
  assert.deepEqual([...collapsed], [second.key]);
  assert.deepEqual([...setAllLineageSchemasExpanded(groups, true)], [first.key, second.key]);
  assert.deepEqual([...setAllLineageSchemasExpanded(groups, false)], []);
});
