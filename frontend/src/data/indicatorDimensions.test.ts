import assert from "node:assert/strict";
import test from "node:test";

import {
  buildIndicatorDimensionOptions,
  findIndicatorDimensionOption,
  indicatorDimensionCodeLabel,
  indicatorDimensionLabel,
  type IndicatorDimensionCatalogEntry,
  normalizeIndicatorDimensionCode,
  resolveIndicatorDimension,
  UNASSIGNED_DIMENSION_LABEL,
} from "./indicatorDimensions.ts";
import { INDICATOR_DIMENSIONS, INDICATORS } from "./indicators.ts";

// Synthetic seven-code fixture: labels must come from the catalog, so the
// exact wording and counts only need to be self-consistent.
const SEVEN_CODE_CATALOG: IndicatorDimensionCatalogEntry[] = [
  { code: "cus", label: "客户维度", count: 61 },
  { code: "emp", label: "员工维度", count: 24 },
  { code: "ord", label: "交易维度", count: 19 },
  { code: "ful", label: "履约维度", count: 11 },
  { code: "due", label: "借据维度", count: 7 },
  { code: "con", label: "合同维度", count: 5 },
  { code: "org", label: "机构维度", count: 1 },
];

const countsOf = (options: ReturnType<typeof buildIndicatorDimensionOptions>) =>
  Object.fromEntries(options.map((item) => [item.value, item.code]));

test("seven-dimension data renders every dimension with its catalog label", () => {
  const counts = Object.fromEntries(
    SEVEN_CODE_CATALOG.map((entry) => [entry.code, entry.count ?? 0]),
  );

  const options = buildIndicatorDimensionOptions(SEVEN_CODE_CATALOG, counts);

  assert.deepEqual(
    options.map((item) => item.value),
    ["cus", "emp", "ord", "ful", "due", "con", "org"],
  );
  assert.deepEqual(countsOf(options), {
    cus: "CUS",
    emp: "EMP",
    ord: "ORD",
    ful: "FUL",
    due: "DUE",
    con: "CON",
    org: "ORG",
  });
  assert.deepEqual(
    options.map((item) => item.label),
    ["客户维度", "员工维度", "交易维度", "履约维度", "借据维度", "合同维度", "机构维度"],
  );
  const total = options.reduce((sum, item) => sum + (counts[item.value] || 0), 0);
  assert.equal(total, 128);
});

test("eight-dimension Community Demo keeps its retail dimensions and order", () => {
  const demoCatalog = INDICATOR_DIMENSIONS.filter((item) => item.value !== "all").map(
    (item) => ({ code: item.value, label: item.label }),
  );
  const counts = INDICATORS.reduce<Record<string, number>>((acc, item) => {
    acc[item.dimension] = (acc[item.dimension] || 0) + 1;
    return acc;
  }, {});

  const options = buildIndicatorDimensionOptions(demoCatalog, counts);

  assert.deepEqual(
    options.map((item) => item.value),
    ["prd", "mem", "ord", "str", "inv", "mkt", "ful", "svc"],
  );
  assert.deepEqual(
    options.map((item) => item.label),
    ["商品维度", "会员维度", "交易维度", "门店维度", "库存维度", "营销维度", "履约维度", "售后维度"],
  );
  // Every seeded indicator must land in one of the rendered buckets.
  for (const indicator of INDICATORS) {
    assert.ok(
      options.some((item) => item.value === indicator.dimension),
      `${indicator.id} dimension ${indicator.dimension} is missing`,
    );
  }
});

test("unknown dimension codes are appended instead of being filtered out", () => {
  const options = buildIndicatorDimensionOptions(
    [
      { code: "cus", label: "客户维度" },
      { code: "org", label: "机构维度" },
    ],
    { cus: 12, org: 1, channel: 7, chn2: 7 },
  );

  assert.deepEqual(
    options.map((item) => item.value),
    ["cus", "org", "channel", "chn2"],
  );
  // No configured label: the badge falls back to the raw code, not to "--".
  assert.equal(findIndicatorDimensionOption(options, "channel")?.label, "CHANNEL");
  assert.equal(findIndicatorDimensionOption(options, "channel")?.code, "CHANNEL");
});

test("a newly added dimension needs no frontend change", () => {
  const options = buildIndicatorDimensionOptions(
    [
      { code: "cus", label: "客户维度" },
      { code: "rio", label: "区域维度", count: 0 },
    ],
    { cus: 3, rio: 4 },
  );

  assert.deepEqual(
    options.map((item) => [item.value, item.label]),
    [
      ["cus", "客户维度"],
      ["rio", "区域维度"],
    ],
  );

  // A dimension that is only configured (no data yet) does not add an empty row.
  const configuredOnly = buildIndicatorDimensionOptions(
    [{ code: "cus", label: "客户维度" }, { code: "rio", label: "区域维度", count: 0 }],
    { cus: 3 },
  );
  assert.deepEqual(
    configuredOnly.map((item) => item.value),
    ["cus"],
  );
});

test("empty dimension codes keep the bucket total equal to the list total", () => {
  const counts = { cus: 10, "": 4 };

  const options = buildIndicatorDimensionOptions(SEVEN_CODE_CATALOG.slice(0, 1), counts);

  assert.deepEqual(
    options.map((item) => item.value),
    ["cus", ""],
  );
  assert.equal(options[1]?.label, UNASSIGNED_DIMENSION_LABEL);
  assert.equal(options[1]?.code, "--");
  assert.equal(
    options.reduce((sum, item) => sum + (counts[item.value as keyof typeof counts] || 0), 0),
    14,
  );
});

test("bank dimension codes survive remote row projection", () => {
  assert.equal(resolveIndicatorDimension("", "CUS"), "cus");
  assert.equal(resolveIndicatorDimension("CUS > 客户基础 > 涉农标签", "CUS"), "cus");
  assert.equal(resolveIndicatorDimension("", "  emp "), "emp");
  // Demo paths still resolve to their seeded retail code.
  assert.equal(resolveIndicatorDimension("PRD > 商品运营 > 规模", ""), "prd");
  // Nothing to resolve stays unresolved instead of inventing a dimension.
  assert.equal(resolveIndicatorDimension("", ""), "");
  assert.equal(resolveIndicatorDimension("CUS > 客户基础", ""), "");
});

test("dimension code normalization accepts codes only", () => {
  assert.equal(normalizeIndicatorDimensionCode("CHANNEL"), "channel");
  assert.equal(normalizeIndicatorDimensionCode(" Cus "), "cus");
  assert.equal(normalizeIndicatorDimensionCode(""), "");
  assert.equal(normalizeIndicatorDimensionCode(null), "");
  assert.equal(normalizeIndicatorDimensionCode("客户维度"), "");
  assert.equal(normalizeIndicatorDimensionCode("1CUS"), "");
  assert.equal(normalizeIndicatorDimensionCode("CUS-EXTRA-LONG-CODE"), "");
});

test("badge labels never fall back to a bare dash for known codes", () => {
  assert.equal(indicatorDimensionLabel("cus"), "CUS");
  assert.equal(indicatorDimensionLabel("cus", "客户维度"), "客户维度");
  assert.equal(indicatorDimensionLabel(""), UNASSIGNED_DIMENSION_LABEL);
  assert.equal(indicatorDimensionCodeLabel("cus"), "CUS");
  assert.equal(indicatorDimensionCodeLabel(""), "--");
});
