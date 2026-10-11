import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getIndicatorPathTree, normalizeIndicatorPathTree } from "./indicator.ts";
import { INDICATORS } from "../data/indicators.ts";
import {
  findIndicatorPathValuePath,
  formatIndicatorPath,
  INDICATOR_PATH_OPTIONS,
} from "../data/indicatorPathOptions.ts";

const indicatorApiSource = readFileSync(
  new URL("./indicator.ts", import.meta.url),
  "utf8",
);

test("Remote indicator path API keeps the legacy route and dimensionCode query", () => {
  assert.match(
    indicatorApiSource,
    /requestRemote\('\/indicator-path\/tree', \{ params \}\)/,
  );
});

test("indicator path response normalization accepts the service tree and dimensionCode", () => {
  const nodes = normalizeIndicatorPathTree([
    {
      label: "RETL 零售经营分析",
      value: "RETL",
      pathLabel: "RETL",
      dimensionCode: "retail",
      children: [
        {
          label: "销售分析",
          value: "销售分析",
          dimensionCode: "sales",
        },
      ],
    },
  ]) as Array<Record<string, unknown>>;

  assert.equal(nodes[0]?.["dimension"], "retail");
  const children = nodes[0]?.["children"] as Array<Record<string, unknown>>;
  assert.equal(children[0]?.["dimension"], "sales");
  assert.equal(children[0]?.["value"], "销售分析");
});

test("Mock and seeded Remote indicator paths share the canonical Demo tree", async () => {
  const mockTree = await getIndicatorPathTree();
  assert.deepEqual(mockTree, INDICATOR_PATH_OPTIONS);
  assert.equal(mockTree.length, 8);

  for (const indicator of INDICATORS) {
    const valuePath = findIndicatorPathValuePath(indicator.path, INDICATOR_PATH_OPTIONS);
    assert.equal(valuePath.length, 3, indicator.id);
    assert.equal(formatIndicatorPath(valuePath, INDICATOR_PATH_OPTIONS), indicator.path);
  }
});

test("indicator path normalizer preserves compatible array envelopes", () => {
  const item = { label: "root", value: "ROOT", dimensionCode: "base" };
  assert.deepEqual(normalizeIndicatorPathTree([item]), [
    { ...item, dimension: "base" },
  ]);
  assert.deepEqual(normalizeIndicatorPathTree({ items: [item] }), [
    { ...item, dimension: "base" },
  ]);
  assert.deepEqual(normalizeIndicatorPathTree({ data: [item] }), [
    { ...item, dimension: "base" },
  ]);
});
