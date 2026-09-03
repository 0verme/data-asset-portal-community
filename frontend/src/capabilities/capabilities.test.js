import assert from "node:assert/strict";
import test from "node:test";

import {
  SAFE_FALLBACK_MODULES,
  buildMockCapabilities,
  buildSafeFallbackCapabilities,
  modulesFromPayload,
} from "./capabilities.ts";
import { listModuleCodes } from "../modules/moduleRegistry.ts";

test("remote payload cannot hide repository modules", () => {
  const result = modulesFromPayload({
    modules: [
      { code: "portal", enabled: true, reason: null },
      { code: "dwm", enabled: true, reason: null },
      { code: "push", enabled: false, reason: "disabled_by_configuration" },
    ],
  });
  assert.equal(result.loadStatus, "ready");
  assert.equal(result.loadError, null);
  assert.equal(result.enabledCodes.has("dwm"), true);
  assert.equal(result.enabledCodes.has("push"), true);
  assert.deepEqual([...result.enabledCodes].sort(), [...listModuleCodes()].sort());
});

test("safe fallback keeps every repository module navigable", () => {
  const result = buildSafeFallbackCapabilities(new Error("network down"));
  assert.equal(result.loadStatus, "error");
  assert.match(result.loadError, /network down/);
  assert.deepEqual([...result.enabledCodes].sort(), [...SAFE_FALLBACK_MODULES].sort());
  assert.deepEqual([...result.enabledCodes].sort(), [...listModuleCodes()].sort());
});

test("mock and remote capability sets share the same open module contract", () => {
  const result = buildMockCapabilities();
  assert.equal(result.loadStatus, "ready");
  assert.equal(result.loadError, null);
  assert.deepEqual([...result.enabledCodes].sort(), [...listModuleCodes()].sort());
});

test("backend and frontend share module code spelling for apiAsset", () => {
  const result = modulesFromPayload({
    modules: [{ code: "apiAsset", enabled: true, reason: null }],
  });
  assert.equal(result.enabledCodes.has("apiAsset"), true);
});
