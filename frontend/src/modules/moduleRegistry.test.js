import assert from "node:assert/strict";
import test from "node:test";

import {
  MODULE_REGISTRY,
  getModuleDefinition,
  isRegisteredModule,
  listModuleCodes,
  resolveDefaultEnabledModules,
  resolveRepositoryModuleCodes,
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

test("all repository modules are source-backed and open by default", () => {
  const moduleCodes = resolveRepositoryModuleCodes();
  assert.deepEqual([...moduleCodes].sort(), [...listModuleCodes()].sort());
  assert.deepEqual([...resolveDefaultEnabledModules()].sort(), [...moduleCodes].sort());
  assert.equal(isRegisteredModule("dwm"), true);
  assert.equal(isRegisteredModule("not-a-repository-module"), false);
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
