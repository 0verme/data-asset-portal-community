import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getIndicatorDimensions } from "./indicator.ts";
import { INDICATOR_DIMENSIONS, INDICATORS } from "../data/indicators.ts";

const read = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), "utf8");
const indicatorApiSource = read("./indicator.ts");

test("remote dimension directory uses the dedicated indicators route", () => {
  assert.match(indicatorApiSource, /requestRemote\('\/indicators\/dimensions'\)/);
});

test("mock mode keeps the eight retail demo dimensions", async () => {
  const catalog = await getIndicatorDimensions();
  const expected = INDICATOR_DIMENSIONS.filter((item) => item.value !== "all");

  assert.deepEqual(
    catalog.map((item) => item.code),
    expected.map((item) => item.value),
  );
  assert.deepEqual(
    catalog.map((item) => item.label),
    expected.map((item) => item.label),
  );
  assert.equal(
    catalog.reduce((sum, item) => sum + (item.count || 0), 0),
    INDICATORS.length,
  );
});

test("the sidebar and page read dimensions from the module, not a static list", () => {
  const page = read("../components/IndicatorPage.tsx");
  const sidebar = read("../components/sidebar/IndicatorSidebar.tsx");
  const hook = read("../hooks/useIndicatorModule.ts");
  const location = read("../routing/location.ts");

  for (const source of [page, sidebar]) {
    assert.doesNotMatch(source, /INDICATOR_DIMENSION_OPTIONS|DIMENSION_META|DIMENSION_ORDER/);
  }
  assert.match(sidebar, /indicatorDimensions\.map/);
  assert.match(page, /dimensionOptions/);
  assert.match(page, /findIndicatorDimensionOption/);
  assert.match(hook, /buildIndicatorDimensionOptions\(indicatorDimensionCatalog, indicatorFacets\.dimension\)/);
  // Deep links accept any real code so a newly written dimension survives a page reload.
  assert.match(location, /readIndicatorDimension/);
  assert.doesNotMatch(location, /INDICATOR_DIMENSION_OPTIONS/);
});

test("no industry dimension vocabulary is baked into the resolution modules", () => {
  const pathOptions = read("../data/indicatorPathOptions.ts");
  const dimensions = read("../data/indicatorDimensions.ts");

  for (const source of [pathOptions, dimensions]) {
    assert.doesNotMatch(source, /INDICATOR_DIMENSION_(CODE|VALUE|LABEL)_MAP/);
    assert.doesNotMatch(
      source,
      /客户维度|员工维度|借据维度|合同维度|机构维度|商品维度|会员维度|门店维度|库存维度|营销维度|履约维度|售后维度/,
    );
  }
});
