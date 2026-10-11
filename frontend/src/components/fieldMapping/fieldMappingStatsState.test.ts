import assert from "node:assert/strict";
import test from "node:test";

import {
  fieldMappingStatDisplayValue,
  fieldMappingStatsDisplayHint,
} from "./fieldMappingStatsState.ts";

test("field mapping stats distinguish real zero from unknown, loading, and error", () => {
  assert.equal(fieldMappingStatDisplayValue(0, "ready"), 0);
  assert.equal(fieldMappingStatDisplayValue(undefined, "unknown"), "—");
  assert.equal(fieldMappingStatDisplayValue(undefined, "loading"), "…");
  assert.equal(fieldMappingStatDisplayValue(undefined, "error"), "—");
  assert.equal(fieldMappingStatsDisplayHint("unknown", "字段映射明细总数"), "等待统计");
  assert.equal(fieldMappingStatsDisplayHint("loading", "字段映射明细总数"), "统计加载中");
  assert.equal(fieldMappingStatsDisplayHint("error", "字段映射明细总数"), "统计加载失败");
  assert.equal(fieldMappingStatsDisplayHint("ready", "字段映射明细总数"), "字段映射明细总数");
});
