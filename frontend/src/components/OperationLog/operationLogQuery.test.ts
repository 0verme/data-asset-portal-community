import assert from "node:assert/strict";
import test from "node:test";

import {
  createOperationLogQueryState,
  resolveOperationLogPageSize,
  resolveOperationLogRequestPage,
  withOperationLogFilter,
} from "./operationLogQuery.ts";

test("operation log filter changes reset pagination in the same state update", () => {
  const current = { ...createOperationLogQueryState(), page: 4 };
  const filter = { ...current.filter, result: "success" };

  assert.deepEqual(withOperationLogFilter(current, filter), { filter, page: 1 });
});

test("operation log keyword changes use page one before the reset effect commits", () => {
  assert.equal(resolveOperationLogRequestPage(4, "new", "old"), 1);
  assert.equal(resolveOperationLogRequestPage(4, "same", "same"), 4);
});

test("operation log respects returned page size and infers legacy server caps on page one", () => {
  assert.equal(resolveOperationLogPageSize(1, 100, { items: Array(50), total: 201 }), 50);
  assert.equal(resolveOperationLogPageSize(2, 100, { items: Array(50), total: 201 }), 100);
  assert.equal(resolveOperationLogPageSize(1, 100, { items: Array(20), total: 20 }), 100);
  assert.equal(resolveOperationLogPageSize(1, 100, { items: Array(50), total: 201, pageSize: 40 }), 40);
});
