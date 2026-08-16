import assert from "node:assert/strict";
import test from "node:test";

import {
  createOperationLogQueryState,
  resolveOperationLogRequestPage,
  withOperationLogFilter,
} from "./operationLogQuery.js";

test("operation log filter changes reset pagination in the same state update", () => {
  const current = { ...createOperationLogQueryState(), page: 4 };
  const filter = { ...current.filter, result: "success" };

  assert.deepEqual(withOperationLogFilter(current, filter), { filter, page: 1 });
});

test("operation log keyword changes use page one before the reset effect commits", () => {
  assert.equal(resolveOperationLogRequestPage(4, "new", "old"), 1);
  assert.equal(resolveOperationLogRequestPage(4, "same", "same"), 4);
});
