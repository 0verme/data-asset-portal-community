import assert from "node:assert/strict";
import test from "node:test";

import {
  SAFE_FALLBACK_MODULES,
  buildMockCapabilities,
  buildSafeFallbackCapabilities,
  modulesFromPayload,
} from "./capabilities.js";
import { listModuleCodes } from "../modules/moduleRegistry.js";

test("remote payload cannot hide repository modules", () => {
  const result = modulesFromPayload({
    modules: [
      { code: "portal", enabled: true, reason: null },
      { code: "dwm", enabled: true, reason: null },
      { code: "push", enabled: false, reason: "disabled_by_configuration" },
    ],
  });
  assert.equal(result.enabledCodes.has("dwm"), true);
  assert.equal(result.enabledCodes.has("push"), true);
  assert.deepEqual([...result.enabledCodes].sort(), [...listModuleCodes()].sort());
});

test("safe fallback keeps every repository module navigable", () => {
  const result = buildSafeFallbackCapabilities(new Error("network down"));
  assert.equal(result.status, "error");
  assert.deepEqual([...result.enabledCodes].sort(), [...SAFE_FALLBACK_MODULES].sort());
  assert.deepEqual([...result.enabledCodes].sort(), [...listModuleCodes()].sort());
});

test("mock and remote capability sets share the same open module contract", () => {
  const result = buildMockCapabilities();
  assert.equal(result.status, "ready");
  assert.deepEqual([...result.enabledCodes].sort(), [...listModuleCodes()].sort());
});

test("backend and frontend share module code spelling for apiAsset", () => {
  const result = modulesFromPayload({
    modules: [{ code: "apiAsset", enabled: true, reason: null }],
  });
  assert.equal(result.enabledCodes.has("apiAsset"), true);
});
