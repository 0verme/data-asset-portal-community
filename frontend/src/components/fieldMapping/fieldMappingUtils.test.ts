import assert from "node:assert/strict";
import test from "node:test";

import {
  areFieldMappingFiltersEqual,
  buildFieldMappingRequestFilters,
  buildLinkedFilters,
  formatSystemLabel,
  compareValues,
  isLinkedRoute,
  isTransformRule,
  sortMarker,
} from "./fieldMappingUtils.ts";

test("field mapping rules identify only known transformations", () => {
  assert.equal(isTransformRule("直接映射"), false);
  assert.equal(isTransformRule("日期格式化"), true);
  assert.equal(isTransformRule("未知规则"), false);
});

test("linked field mapping routes build stable filters", () => {
  const route = { sourceSystemId: "101", sourceTable: "MEMBER_PROFILE", dwfTable: "DWF_MEMBER_PROFILE" };
  assert.equal(isLinkedRoute(route), true);
  assert.deepEqual(buildLinkedFilters(route, "核心系统"), {
    sourceSystemId: "101",
    srcTable: "MEMBER_PROFILE",
    srcField: "",
    emptyComment: "",
    targetTable: "DWF_MEMBER_PROFILE",
    targetField: "",
  });
});

test("linked request filters rely on the stable upstream system id", () => {
  const filters = buildLinkedFilters({
    sourceTable: "MEMBER_PROFILE",
    dwfTable: "DWF_MEMBER_PROFILE",
  }, "鏍稿績绯荤粺");

  assert.deepEqual(buildFieldMappingRequestFilters(filters, { sourceSystemId: "101" }), {
    ...filters,
    sourceSystemId: "101",
  });
  assert.deepEqual(buildFieldMappingRequestFilters(filters, {}), filters);
  assert.equal(areFieldMappingFiltersEqual(filters, { ...filters }), true);
  assert.equal(areFieldMappingFiltersEqual(filters, { ...filters, srcField: "MEMBER_CODE" }), false);
});

test("field mapping comparison and sort markers preserve direction", () => {
  assert.equal(compareValues(2, 10), -8);
  assert.ok(compareValues("会员", "商品") !== 0);
  assert.equal(sortMarker({ key: "srcTable", direction: "asc" }, "srcTable"), " ↑");
  assert.equal(sortMarker({ key: "srcTable", direction: "desc" }, "srcTable"), " ↓");
  assert.equal(sortMarker({ key: "srcTable", direction: "asc" }, "targetTable"), "");
});

test("system labels use name and code without exposing the primary key", () => {
  assert.equal(formatSystemLabel({ id: 101, name: "会员档案数据源", systemCode: "MEM" }), "会员档案数据源 · MEM");
  assert.doesNotMatch(formatSystemLabel({ id: 101, name: "会员档案数据源", systemCode: "MEM" }), /101|#/);
});
