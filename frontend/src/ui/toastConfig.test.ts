import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_TOAST_DURATION, resolveToastDuration } from "./toastConfig.ts";

test("toast adapters retain the legacy default timeout and allow explicit overrides", () => {
  assert.equal(DEFAULT_TOAST_DURATION, 3200);
  assert.equal(resolveToastDuration(), 3200);
  assert.equal(resolveToastDuration(750), 750);
  assert.equal(resolveToastDuration(0), 0);
});
