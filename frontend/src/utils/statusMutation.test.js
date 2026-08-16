import assert from "node:assert/strict";
import test from "node:test";

import { runOptimisticStatusMutation } from "./statusMutation.js";

test("failed optimistic status mutation rolls back and reports once", async () => {
  let status = "enabled";
  let errors = 0;
  const result = await runOptimisticStatusMutation({
    apply: () => { status = "disabled"; },
    request: async () => { throw new Error("failed"); },
    rollback: () => { status = "enabled"; },
    onError: () => { errors += 1; },
  });
  assert.equal(result, null);
  assert.equal(status, "enabled");
  assert.equal(errors, 1);
});

test("successful optimistic status mutation keeps the new status", async () => {
  let status = "disabled";
  let errors = 0;
  await runOptimisticStatusMutation({
    apply: () => { status = "enabled"; },
    request: async () => ({ status: "enabled" }),
    rollback: () => { status = "disabled"; },
    onError: () => { errors += 1; },
  });
  assert.equal(status, "enabled");
  assert.equal(errors, 0);
});
