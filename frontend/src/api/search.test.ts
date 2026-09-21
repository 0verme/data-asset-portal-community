import assert from "node:assert/strict";
import test from "node:test";

import { getAssetTablePage } from "./assets.ts";
import { buildMockSearchResult, type SearchResult } from "./search.ts";

const ALL_MODULES: ReadonlySet<string> = new Set([
  "dwm",
  "upstream",
  "mapping",
  "root",
  "indicator",
  "report",
  "apiAsset",
  "push",
  "codeTable",
]);

/** Field-only business words of the mock dataset (absent from table metadata). */
const FIELD_ONLY_KEYWORD = "SKU 标识";
const MULTI_FIELD_KEYWORD = "标识";

function assetGroup(result: SearchResult) {
  const group = result.groups.find((item) => item.type === "asset");
  assert.ok(group, "asset group is expected");
  return group;
}

test("mock asset search recalls an asset through a field-only keyword", () => {
  const result = buildMockSearchResult(FIELD_ONLY_KEYWORD, "asset", 5, ALL_MODULES);
  const group = assetGroup(result);

  assert.equal(result.scope, "asset");
  assert.deepEqual(result.groups.map((item) => item.type), ["asset"]);
  assert.equal(group.count, 9);
  assert.equal(group.items.length, 5);
  assert.equal(group.hasMore, true);
  assert.equal(result.total, 9);
  assert.equal(result.hasMore, true);
  for (const item of group.items) {
    assert.equal(item.type, "asset");
    assert.ok(
      item.matchedFields.some((match) => match.label === "字段"),
      "a field-only hit must be explained by a field matchedFields entry",
    );
  }
});

test("mock asset search returns an asset once when several fields match", () => {
  const result = buildMockSearchResult(MULTI_FIELD_KEYWORD, "asset", 50, ALL_MODULES);
  const group = assetGroup(result);
  const ids = group.items.map((item) => item.id);

  assert.equal(new Set(ids).size, ids.length, "assets must not be duplicated");
  assert.equal(group.count, ids.length);
  assert.equal(group.hasMore, false);

  const multi = group.items.find((item) => item.id === "dwm_product_sku_detail_di");
  assert.ok(multi, "expected a mock asset with several matching fields");
  const fieldMatches = multi.matchedFields.filter((match) => match.label === "字段");
  assert.ok(fieldMatches.length >= 2);
  assert.ok(fieldMatches.length <= 3, "matchedFields must stay light");
  assert.equal(fieldMatches[0]?.value, "sku_id SKU 标识");
});

test("mock groups keep the remote count/hasMore/items contract", () => {
  const result = buildMockSearchResult(FIELD_ONLY_KEYWORD, "all", 5, ALL_MODULES);

  for (const group of result.groups) {
    assert.deepEqual(Object.keys(group).sort(), [
      "count",
      "hasMore",
      "items",
      "label",
      "module",
      "type",
    ]);
    assert.equal(group.count > group.items.length, group.hasMore);
  }
  assert.equal(
    result.total,
    result.groups.reduce((sum, group) => sum + group.count, 0),
  );
  assert.equal(result.estimatedTotal, result.total);
  assert.equal(
    result.hasMore,
    result.groups.some((group) => group.hasMore),
  );
});

test("mock asset scope is repeatable and keeps a non-matching group", () => {
  const first = buildMockSearchResult(FIELD_ONLY_KEYWORD, "asset", 5, ALL_MODULES);
  const second = buildMockSearchResult(FIELD_ONLY_KEYWORD, "asset", 5, ALL_MODULES);
  assert.deepEqual(first, second);

  const empty = buildMockSearchResult("完全不存在的业务词", "asset", 5, ALL_MODULES);
  assert.deepEqual(empty.groups.map((group) => group.type), ["asset"]);
  assert.equal(empty.groups[0]?.count, 0);
  assert.equal(empty.groups[0]?.hasMore, false);
  assert.equal(empty.total, 0);
});

test("mock asset scope follows the enabled module set", () => {
  const withoutDwm = buildMockSearchResult(
    FIELD_ONLY_KEYWORD,
    "asset",
    5,
    new Set(["upstream"]),
  );
  assert.deepEqual(withoutDwm.groups, []);
});

test("mock asset search results are always recallable by the mock asset list", async () => {
  // The mock asset list also expands the base catalog into layer variants, so
  // the list may return more assets; the search results must never be a dead end.
  for (const keyword of [FIELD_ONLY_KEYWORD, "会员", "DWM"]) {
    const result = buildMockSearchResult(keyword, "asset", 50, ALL_MODULES);
    const group = assetGroup(result);
    const page = await getAssetTablePage({ keyword, page: 1, pageSize: 200 });
    const listed = new Set(page.items.map((item) => item.name));

    for (const item of group.items) {
      assert.ok(
        listed.has(item.id),
        `search result ${item.id} must be recallable in the asset list (${keyword})`,
      );
    }
    assert.ok(page.total >= group.count);
    assert.ok(group.count > 0);
  }
});

test("mock non-asset entities keep their existing contract", () => {
  const result = buildMockSearchResult("会员", "system", 5, ALL_MODULES);
  const group = result.groups[0];
  assert.ok(group);
  assert.equal(group.type, "system");
  assert.deepEqual(Object.keys(group).sort(), [
    "count",
    "hasMore",
    "items",
    "label",
    "module",
    "type",
  ]);
  for (const item of group.items) {
    assert.equal(item.type, "system");
    assert.equal(item.assetId, undefined);
    assert.deepEqual(Object.keys(item).sort(), [
      "category",
      "id",
      "matchedFields",
      "meta",
      "module",
      "ref",
      "subtitle",
      "title",
      "type",
    ]);
  }
});
