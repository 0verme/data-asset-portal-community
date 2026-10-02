import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_PORTAL_SCOPE,
  filterPortalHotKeywordsByModules,
  isMonospaceHotKeyword,
  filterPortalScopesByModules,
  PORTAL_SCOPE_CONFIGS,
  readPortalSearchParams,
  SEARCH_SCOPE_TO_MODULE,
} from "./portalSearch.ts";

const ASSET_SCOPE = { key: "asset", label: "资产", moduleKey: "dwm" };

test("the portal offers an asset scope chip backed by the dwm module", () => {
  assert.ok(PORTAL_SCOPE_CONFIGS.some((item) => item.key === "asset"));
  assert.equal(SEARCH_SCOPE_TO_MODULE["asset"], "dwm");
  assert.deepEqual(
    filterPortalScopesByModules(["dwm"]).find((item) => item.key === "asset"),
    ASSET_SCOPE,
  );
});

test("the asset scope chip follows the visible module set", () => {
  const withoutDwm = filterPortalScopesByModules(["upstream", "mapping"]);
  assert.equal(
    withoutDwm.some((item) => item.key === "asset"),
    false,
  );
  assert.equal(withoutDwm.some((item) => item.key === "all"), true);
});

test("scope=asset survives URL parsing for share, refresh and history", () => {
  const validScopes = new Set(filterPortalScopesByModules(["dwm"]).map((item) => item.key));

  assert.deepEqual(readPortalSearchParams(validScopes, "?q=包裹数&scope=asset"), {
    query: "包裹数",
    scope: "asset",
  });
  assert.deepEqual(readPortalSearchParams(validScopes, "?scope=asset"), {
    query: "",
    scope: "asset",
  });
  assert.deepEqual(readPortalSearchParams(validScopes, ""), {
    query: "",
    scope: DEFAULT_PORTAL_SCOPE,
  });
});

test("an unknown or hidden scope still falls back to all", () => {
  const validScopes = new Set(filterPortalScopesByModules(["dwm"]).map((item) => item.key));

  assert.deepEqual(readPortalSearchParams(validScopes, "?q=包裹数&scope=privateOnly"), {
    query: "包裹数",
    scope: DEFAULT_PORTAL_SCOPE,
  });
  const withoutDwm = new Set(
    filterPortalScopesByModules(["upstream"]).map((item) => item.key),
  );
  assert.equal(readPortalSearchParams(withoutDwm, "?scope=asset").scope, DEFAULT_PORTAL_SCOPE);
});

test("API recommendations follow visible module categories and keep the first duplicate", () => {
  const items = [
    { id: 1, keyword: "资产", category: "all", sortOrder: 10 },
    { id: 2, keyword: "DWS_TRADE_SALES_STAT_1D", category: "asset", sortOrder: 20 },
    { id: 3, keyword: "资产", category: "field", sortOrder: 30 },
  ];
  assert.deepEqual(filterPortalHotKeywordsByModules(items, ["dwm"]), items.slice(0, 2));
  assert.deepEqual(filterPortalHotKeywordsByModules(items, []), items.slice(0, 1));
});

test("code-like long keywords use monospace styling without embedding suggestions", () => {
  assert.equal(isMonospaceHotKeyword("RISK_BLACKLIST_${yyyyMMdd}.txt"), true);
  assert.equal(isMonospaceHotKeyword("/DWS/DWS"), true);
  assert.equal(isMonospaceHotKeyword("监管报送"), false);
});
