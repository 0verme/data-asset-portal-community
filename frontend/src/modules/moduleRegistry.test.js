import assert from "node:assert/strict";
import test from "node:test";

import {
  MODULE_REGISTRY,
  filterMenusByCapabilities,
  getModuleDefinition,
  listModuleCodes,
  resolveDefaultEnabledModules,
  validateModuleRegistry,
} from "./moduleRegistry.js";

test("module registry is internally consistent", () => {
  assert.equal(validateModuleRegistry(), true);
  const codes = listModuleCodes();
  assert.ok(codes.includes("dwm"));
  assert.ok(codes.includes("mapping"));
  assert.ok(codes.includes("apiAsset"));
  assert.ok(codes.includes("portal"));
});

test("mapping and apiAsset are independent of private connection modules", () => {
  assert.deepEqual(getModuleDefinition("mapping").requires, []);
  assert.deepEqual(getModuleDefinition("apiAsset").requires, []);
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

test("resolveDefaultEnabledModules keeps decoupled public modules", () => {
  const enabled = resolveDefaultEnabledModules("portal,dwm,mapping,system");
  assert.equal(enabled.has("portal"), true);
  assert.equal(enabled.has("dwm"), true);
  assert.equal(enabled.has("mapping"), true);
  assert.equal(enabled.has("system"), true);
});

test("filterMenusByCapabilities hides disabled modules", () => {
  const menus = [
    { code: "dwm", name: "数据仓库" },
    { code: "push", name: "下游推送" },
    { code: "unknownCustom", name: "自定义" },
  ];
  const filtered = filterMenusByCapabilities(menus, new Set(["portal", "dwm"]));
  assert.deepEqual(
    filtered.map((item) => item.code),
    ["dwm", "unknownCustom"],
  );
});
