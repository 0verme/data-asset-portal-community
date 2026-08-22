import assert from "node:assert/strict";
import test from "node:test";

import {
  MODULE_REGISTRY,
  getModuleDefinition,
  listModuleCodes,
  resolveDefaultEnabledModules,
  validateModuleRegistry,
} from "./moduleRegistry.js";

test("module registry is internally consistent and complete", () => {
  assert.equal(validateModuleRegistry(), true);
  const codes = listModuleCodes();
  assert.ok(codes.includes("dwm"));
  assert.ok(codes.includes("mapping"));
  assert.ok(codes.includes("apiAsset"));
  assert.ok(codes.includes("push"));
  assert.ok(codes.includes("report"));
  assert.ok(codes.includes("codeTable"));
  assert.ok(codes.includes("portal"));
  assert.equal(codes.length, 12);
});

test("all repository modules are open by default", () => {
  const enabled = resolveDefaultEnabledModules();
  assert.deepEqual([...enabled].sort(), [...listModuleCodes()].sort());
  assert.equal(getModuleDefinition("mapping").requires.length, 0);
  assert.equal(getModuleDefinition("apiAsset").requires.length, 0);
});

test("path prefixes are unique across modules", () => {
  const seen = new Set();
  for (const item of MODULE_REGISTRY) {
    for (const prefix of item.pathPrefixes || []) {
      if (!prefix) continue;
      assert.equal(seen.has(prefix), false, `duplicate path ${prefix}`);
      seen.add(prefix);
    }
  }
});
