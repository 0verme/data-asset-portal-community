import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_PORTAL_SCOPE,
  filterPortalHotTagsByModules,
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

test("hot tags stay filtered by the visible modules", () => {
  assert.ok(filterPortalHotTagsByModules(["dwm"]).some((item) => item.q === "订单"));
  assert.equal(
    filterPortalHotTagsByModules([]).some((item) => item.q === "DWS_TRADE_SALES_STAT_1D"),
    false,
  );
});
