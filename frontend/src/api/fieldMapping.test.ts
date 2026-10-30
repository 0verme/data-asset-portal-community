import assert from "node:assert/strict";
import test from "node:test";

import {
  filterFieldMappingRows,
  getFieldMappingMockExportRows,
  getFieldMappingSourceSystems,
  getFieldMappings,
  normalizeFieldMappingStats,
  summarizeTables,
} from "./fieldMapping.ts";
import { formatSystemLabel } from "../components/fieldMapping/fieldMappingUtils.ts";

test("same-name mock systems are filtered by stable source system id", () => {
  const rows = [
    { tablePk: 301, sourceSystemId: 101, srcSystem: "会员档案数据源", systemCode: "MEM", srcTable: "MEMBER_A" },
    { tablePk: 302, sourceSystemId: 102, srcSystem: "会员档案数据源", systemCode: "MEM_TEST", srcTable: "MEMBER_B" },
  ];

  assert.deepEqual(
    filterFieldMappingRows(rows, { sourceSystemId: "101" }).map((row) => row.srcTable),
    ["MEMBER_A"],
  );
  assert.deepEqual(
    filterFieldMappingRows(rows, { sourceSystemId: "102" }).map((row) => row.srcTable),
    ["MEMBER_B"],
  );
  assert.deepEqual(
    filterFieldMappingRows(rows, { tablePk: 302 }).map((row) => row.srcTable),
    ["MEMBER_B"],
  );
});

test("table summaries keep mappings separate by complete business identity", () => {
  const rows = [
    {
      sourceSystemId: 166,
      srcTable: "EXTR_FINANCE_BOOK",
      targetLayer: "DWF",
      targetTable: "DWF.F_AGT_EXTR_FINANCE_BOOK",
      loadMode: "incr_zip",
      srcField: "BOOK_ID",
      targetField: "BOOK_ID",
    },
    {
      sourceSystemId: 166,
      srcTable: "EXTR_FINANCE_BOOK",
      targetLayer: "DWF",
      targetTable: "DWF.F_AGT_EXTR_FINANCE_BOOK",
      loadMode: "incr_zip",
      srcField: "AMOUNT",
      targetField: "AMOUNT",
    },
    {
      sourceSystemId: 166,
      srcTable: "EXTR_FINANCE_BOOK",
      targetLayer: "DWF",
      targetTable: "DWF.F_EVT_EXTR_FINANCE_BOOK",
      loadMode: "incr",
      srcField: "BOOK_ID",
      targetField: "BOOK_ID",
    },
    {
      sourceSystemId: 166,
      srcTable: "EXTR_FINANCE_BOOK",
      targetLayer: "DWF",
      targetTable: "DWF.F_AGT_EXTR_FINANCE_BOOK",
      loadMode: "full",
      srcField: "BOOK_ID",
      targetField: "BOOK_ID",
    },
  ];

  const tables = summarizeTables(rows);

  assert.equal(tables.length, 3);
  assert.equal(
    tables.find((row) => row.loadMode === "incr_zip")?.fieldCount,
    2,
  );
  assert.equal(
    tables.filter((row) => row.targetTable === "DWF.F_AGT_EXTR_FINANCE_BOOK").length,
    2,
  );
});

test("mock field export includes every filtered row regardless of current page and keeps sort order", async () => {
  const sourceSystem = (await getFieldMappingSourceSystems()).find((item) => item.count > 1);
  assert.ok(sourceSystem, "mock catalog should contain a source system with multiple fields");
  const params = {
    sourceSystemId: sourceSystem.sourceSystemId,
    page: 2,
    pageSize: 1,
    sortKey: "srcField",
    sortDirection: "asc",
  };
  const currentPage = await getFieldMappings(params);
  const exportedRows = getFieldMappingMockExportRows("field", params);
  assert.equal(currentPage.items.length, 1);
  assert.equal(exportedRows.length, sourceSystem.count);
  assert.ok(exportedRows.length > currentPage.items.length);
  const fieldNames = exportedRows.map((row) => row.srcField);
  for (let index = 1; index < fieldNames.length; index += 1) {
    const previousField = fieldNames[index - 1] ?? "";
    const currentField = fieldNames[index] ?? "";
    assert.ok(previousField.localeCompare(currentField) <= 0);
  }
});

test("field mapping stats preserve a true zero count from the data envelope", () => {
  const stats = normalizeFieldMappingStats({ data: { fieldCount: 0 } });
  assert.equal(stats.fieldCount, 0);
});

test("field mapping stats reject missing or invalid fieldCount instead of defaulting to zero", () => {
  for (const fieldCount of [undefined, null, -1, 1.5, "0"]) {
    assert.throws(
      () => normalizeFieldMappingStats({ data: { fieldCount } }),
      /有效的字段计数/,
    );
  }
});

test("source-system options retain duplicate names and expose name/code labels", async () => {
  const options = await getFieldMappingSourceSystems();
  assert.equal(new Set(options.map((item) => item.id)).size, options.length);
  options.forEach((item) => {
    assert.equal(formatSystemLabel(item), `${item.name} · ${item.systemCode}`);
    assert.doesNotMatch(formatSystemLabel(item), new RegExp(`#${item.id}`));
  });
});
