import assert from "node:assert/strict";
import test from "node:test";

import { createToastId, DEFAULT_TOAST_DURATION, resolveToastDuration } from "./toastConfig.ts";

test("toast adapters retain the legacy default timeout and allow explicit overrides", () => {
  assert.equal(DEFAULT_TOAST_DURATION, 3200);
  assert.equal(resolveToastDuration(), 3200);
  assert.equal(resolveToastDuration(750), 750);
  assert.equal(resolveToastDuration(0), 0);
});

test("toast IDs are stable and distinguish both tone and message without exposing text", () => {
  const successId = createToastId("保存成功", "success");
  assert.equal(successId, createToastId("保存成功", "success"));
  assert.notEqual(successId, createToastId("保存失败", "success"));
  assert.notEqual(successId, createToastId("保存成功", "error"));
  assert.doesNotMatch(successId, /保存成功/);
});
