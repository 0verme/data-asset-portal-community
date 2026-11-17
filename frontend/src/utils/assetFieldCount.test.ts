import assert from "node:assert/strict";
import test from "node:test";

import { getAssetFieldCount } from "./assetFieldCount.ts";

test("asset field counts preserve true zero and valid positive counts", () => {
  assert.equal(getAssetFieldCount(0), 0);
  assert.equal(getAssetFieldCount(12), 12);
});

test("missing and invalid asset field counts remain unknown", () => {
  for (const value of [undefined, null, -1, 1.5, "12", Number.NaN]) {
    assert.equal(getAssetFieldCount(value), null);
  }
});
