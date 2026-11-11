import assert from "node:assert/strict";
import test from "node:test";

import { AI_ASK_REQUEST_TIMEOUT, LONG_REQUEST_TIMEOUT } from "./request.ts";

test("AI ask request deadline includes queue wait and worker cleanup", () => {
  assert.equal(AI_ASK_REQUEST_TIMEOUT, Math.max(LONG_REQUEST_TIMEOUT, 125_000));
  assert.ok(AI_ASK_REQUEST_TIMEOUT >= 125_000);
});
