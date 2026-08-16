import assert from "node:assert/strict";
import test from "node:test";

import {
  SAFE_FALLBACK_MODULES,
  buildMockCapabilities,
  buildSafeFallbackCapabilities,
  modulesFromPayload,
} from "./capabilities.js";

test("modulesFromPayload only keeps enabled codes", () => {
  const result = modulesFromPayload({
    edition: "community-test",
    modules: [
      { code: "portal", enabled: true, reason: null },
      { code: "dwm", enabled: true, reason: null },
      { code: "push", enabled: false, reason: "disabled_by_configuration" },
    ],
  });
  assert.equal(result.edition, "community-test");
  assert.equal(result.enabledCodes.has("dwm"), true);
  assert.equal(result.enabledCodes.has("push"), false);
  assert.equal(result.enabledCodes.has("portal"), true);
});

test("safe fallback never enables private modules", () => {
  const result = buildSafeFallbackCapabilities(new Error("network down"));
  assert.equal(result.status, "error");
  assert.deepEqual([...result.enabledCodes].sort(), [...SAFE_FALLBACK_MODULES].sort());
  assert.equal(result.enabledCodes.has("push"), false);
  assert.equal(result.enabledCodes.has("mapping"), false);
  assert.equal(result.enabledCodes.has("apiAsset"), false);
});

test("mock capabilities enable defaults including private modules", () => {
  const result = buildMockCapabilities();
  assert.equal(result.status, "ready");
  assert.equal(result.enabledCodes.has("portal"), true);
  assert.equal(result.enabledCodes.has("dwm"), true);
  assert.equal(result.enabledCodes.has("push"), true);
  assert.equal(result.enabledCodes.has("mapping"), true);
});

test("backend and frontend share module code spelling for apiAsset", () => {
  const result = modulesFromPayload({
    modules: [{ code: "apiAsset", enabled: true, reason: null }],
  });
  assert.equal(result.enabledCodes.has("apiAsset"), true);
});
