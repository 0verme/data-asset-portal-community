import assert from "node:assert/strict";
import test from "node:test";

import {
  getPushBusinessOptions,
  getUpstreamBusinessOptions,
  parseBusinessOptionCatalog,
} from "./businessOptions.ts";

const expected = ["UPSTREAM_DB_TYPE", "UPSTREAM_DEPT", "PUSH_PROTOCOL"] as const;

test("business option contract preserves configured custom values and missing vs empty categories", () => {
  const result = parseBusinessOptionCatalog(
    {
      categories: {
        UPSTREAM_DB_TYPE: [
          { code: "CUSTOM_DB", name: "制造数据库", value: "制造数据库", ext: { ignored: true } },
        ],
        UPSTREAM_DEPT: [],
        PUSH_PROTOCOL: [],
      },
      missingCategories: ["UPSTREAM_DEPT"],
    },
    expected,
  );

  assert.deepEqual(result, {
    categories: {
      UPSTREAM_DB_TYPE: [
        { code: "CUSTOM_DB", name: "制造数据库", value: "制造数据库" },
      ],
      UPSTREAM_DEPT: [],
      PUSH_PROTOCOL: [],
    },
    missingCategories: ["UPSTREAM_DEPT"],
  });
});

test("Mock mode keeps the configured Demo business option catalogs", async () => {
  const [upstream, push] = await Promise.all([
    getUpstreamBusinessOptions(),
    getPushBusinessOptions(),
  ]);
  assert.deepEqual(upstream.missingCategories, []);
  assert.ok((upstream.categories["UPSTREAM_DB_TYPE"] ?? []).length > 1);
  assert.ok((upstream.categories["UPSTREAM_DEPT"] ?? []).length > 1);
  assert.ok((push.categories["PUSH_PROTOCOL"] ?? []).some((item) => item.value === "HTTP"));
  assert.ok((push.categories["PUSH_DELIMITER"] ?? []).length > 1);
  assert.ok((push.categories["FILE_ENCODING"] ?? []).length > 1);
  assert.ok((push.categories["FREQ_TYPE"] ?? []).length > 1);
});

test("malformed success envelopes are errors, not empty candidate lists", () => {
  for (const payload of [
    null,
    [],
    { categories: { UPSTREAM_DB_TYPE: [] }, missingCategories: [] },
    { categories: { UPSTREAM_DB_TYPE: [{ code: "x", name: "x", value: "x" }], UPSTREAM_DEPT: [] } },
    { categories: { UPSTREAM_DB_TYPE: [], UPSTREAM_DEPT: [] }, missingCategories: ["OTHER"] },
    { categories: { UPSTREAM_DB_TYPE: [{ code: "x", name: "x", value: " " }], UPSTREAM_DEPT: [] }, missingCategories: [] },
  ]) {
    assert.throws(() => parseBusinessOptionCatalog(payload, expected));
  }
});
