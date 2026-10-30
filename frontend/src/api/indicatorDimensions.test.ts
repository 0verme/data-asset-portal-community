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
  // Deep links accept any real code so bank dimensions survive a page reload.
  assert.match(location, /readIndicatorDimension/);
  assert.doesNotMatch(location, /INDICATOR_DIMENSION_OPTIONS/);
});
