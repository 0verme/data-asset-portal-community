import assert from "node:assert/strict";
import test from "node:test";

import {
  filterFieldMappingRows,
  getFieldMappingSourceSystems,
} from "./fieldMapping.ts";
import { formatSystemLabel } from "../components/fieldMapping/fieldMappingUtils.js";

test("same-name mock systems are filtered by stable source system id", () => {
  const rows = [
    { sourceSystemId: 101, srcSystem: "会员档案数据源", systemCode: "MEM", srcTable: "MEMBER_A" },
    { sourceSystemId: 102, srcSystem: "会员档案数据源", systemCode: "MEM_TEST", srcTable: "MEMBER_B" },
  ];

  assert.deepEqual(
    filterFieldMappingRows(rows, { sourceSystemId: "101" }).map((row) => row.srcTable),
    ["MEMBER_A"],
  );
  assert.deepEqual(
    filterFieldMappingRows(rows, { sourceSystemId: "102" }).map((row) => row.srcTable),
    ["MEMBER_B"],
  );
});

test("source-system options retain duplicate names and expose name/code labels", async () => {
  const options = await getFieldMappingSourceSystems();
  assert.equal(new Set(options.map((item) => item.id)).size, options.length);
  options.forEach((item) => {
    assert.equal(formatSystemLabel(item), `${item.name} · ${item.systemCode}`);
    assert.doesNotMatch(formatSystemLabel(item), new RegExp(`#${item.id}`));
  });
});
