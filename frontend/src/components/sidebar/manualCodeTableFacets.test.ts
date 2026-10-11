import assert from "node:assert/strict";
import test from "node:test";

import { MANUAL_CODE_TABLES } from "../../data/manualCodeTables.ts";
import { getManualCodeTableFacetCounts } from "./manualCodeTableFacets.ts";

const STYLES = [
  { value: "enum" },
  { value: "dim" },
  { value: "status" },
  { value: "map" },
  { value: "custom" },
] as const;

test("manual code-table fixtures use supported style facet values", () => {
  const supportedStyles = new Set<string>(STYLES.map((style) => style.value));
  for (const item of MANUAL_CODE_TABLES) {
    assert.ok(supportedStyles.has(item.style), `${item.tableCode} uses unsupported style ${item.style}`);
  }
});

test("facet counts apply search and peer filters while ignoring their own selection", () => {
  const all = getManualCodeTableFacetCounts(MANUAL_CODE_TABLES, STYLES, "", "", "");
  assert.equal(all.styleTotal, 8);
  assert.deepEqual(all.styles, { enum: 0, dim: 4, status: 3, map: 1, custom: 0 });
  assert.equal(all.statusTotal, 8);
  assert.deepEqual(all.statuses, { enabled: 7, disabled: 1 });

  const disabledOnly = getManualCodeTableFacetCounts(
    MANUAL_CODE_TABLES,
    STYLES,
    "",
    "",
    "disabled",
  );
  assert.equal(disabledOnly.styleTotal, 1);
  assert.deepEqual(disabledOnly.styles, { enum: 0, dim: 0, status: 1, map: 0, custom: 0 });

  const statusStyle = getManualCodeTableFacetCounts(
    MANUAL_CODE_TABLES,
    STYLES,
    "",
    "status",
    "",
  );
  assert.equal(statusStyle.statusTotal, 3);
  assert.deepEqual(statusStyle.statuses, { enabled: 2, disabled: 1 });

  const searched = getManualCodeTableFacetCounts(
    MANUAL_CODE_TABLES,
    STYLES,
    "legacy",
    "",
    "",
  );
  assert.equal(searched.styleTotal, 1);
  assert.equal(searched.styles["status"], 1);
  assert.equal(searched.statusTotal, 1);
  assert.deepEqual(searched.statuses, { enabled: 0, disabled: 1 });
});
