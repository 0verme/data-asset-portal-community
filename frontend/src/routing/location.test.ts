import assert from "node:assert/strict";
import test from "node:test";

import {
  buildNavigationLocation,
  parseInitialLocation,
  resolveHistoryAction,
} from "./location.ts";
import {
  createNavigationState,
  getActiveModuleRoute,
} from "./navigation.ts";
import type {
  LocationSnapshot,
  NavigationRoute,
  NavigationRoutes,
} from "./types.ts";

type LocationRouteKey =
  | "assetRoute"
  | "reportRoute"
  | "apiAssetRoute"
  | "upRoute"
  | "pushRoute"
  | "systemRoute";

type LocationCase = readonly [
  url: string,
  module: LocationSnapshot["module"],
  route: NavigationRoute | null,
  routeKey: LocationRouteKey | null,
];

function parseLocation(url: string): LocationSnapshot {
  const previousWindow = globalThis.window;
  const parsedUrl = new URL(url, "http://localhost");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: {
        pathname: parsedUrl.pathname,
        search: parsedUrl.search,
      },
    },
  });
  try {
    return parseInitialLocation();
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: previousWindow,
    });
  }
}

const emptyRoutes: NavigationRoutes = {
  asset: { page: "home", table: null },
  push: { page: "systems", sys: null, job: null },
  indicator: { page: "list", id: null },
  report: { page: "list", code: null },
  root: { page: "library", abbr: null },
  upstream: { page: "list", id: null },
  mapping: { tab: "table", sourceSystemId: "", sourceTable: "", dwfTable: "" },
  lineage: { rootId: null, direction: "both", depth: 2, view: "table" },
  system: { page: "users" },
};

test("initial location parsing restores deep links and query state", () => {
  const location = parseLocation(
    "/indicator-maintenance/指标%2F001/edit?q=orders&dimension=prd&status=enabled&view=card",
  );

  assert.equal(location.module, "indicator");
  assert.deepEqual(location.indicatorRoute, { page: "edit", id: "指标/001" });
  assert.equal(location.query, "orders");
  assert.deepEqual(location.indicatorFilter, { dimension: "prd", status: "enabled" });
  assert.equal(location.indicatorView, "card");
});

test("canonical module paths restore their existing route shapes", () => {
  const cases: LocationCase[] = [
    ["/data-warehouse/orders/edit", "dwm", { page: "edit", table: "orders" }, "assetRoute"],
    ["/report-assets/RPT%2F001/edit", "report", { page: "edit", code: "RPT/001" }, "reportRoute"],
    ["/api-assets/API%2F001", "apiAsset", { page: "view", code: "API/001" }, "apiAssetRoute"],
    ["/upstream/CRM%201", "upstream", { page: "detail", id: "CRM 1" }, "upRoute"],
    ["/push/SYS/JOB/edit", "push", { page: "jobEdit", sys: "SYS", job: "JOB" }, "pushRoute"],
    ["/system-management/roles", "system", { page: "roles" }, "systemRoute"],
    ["/root-management", "root", null, null],
    ["/code-table-maintenance", "codeTable", null, null],
    ["/portal", "portal", null, null],
  ];

  for (const [url, module, route, routeKey] of cases) {
    const location = parseLocation(url);
    assert.equal(location.module, module, url);
    if (routeKey) assert.deepEqual(location[routeKey], route, url);
  }
});

test("mapping keeps the canonical sourceSystemId parameter", () => {
  const location = parseLocation(
    "/field-mapping?tab=field&sourceSystemId=legacy-system&sourceTable=orders&dwfTable=dws_orders",
  );

  assert.equal(location.module, "mapping");
  assert.deepEqual(location.mappingRoute, {
    tab: "field",
    sourceSystemId: "legacy-system",
    sourceTable: "orders",
    dwfTable: "dws_orders",
  });
});

test("mapping normalizes the legacy upstreamSystemId URL alias", () => {
  const location = parseLocation("/field-mapping?upstreamSystemId=101");
  assert.equal(location.mappingRoute.sourceSystemId, "101");
});

test("lineage and invalid query values use the existing safe defaults", () => {
  const location = parseLocation(
    "/lineage?rootId=orders&direction=sideways&depth=99&view=graph&layout=invalid&status=unknown",
  );

  assert.equal(location.module, "lineage");
  assert.deepEqual(location.lineageRoute, {
    rootId: "orders",
    direction: "both",
    depth: 2,
    view: "table",
  });
  assert.equal(location.assetLayout, "list");
  assert.equal(location.reportFilter.status, null);
});

test("invalid push and upstream query values use their existing defaults", () => {
  const push = parseLocation("/push?view=grid&status=unknown&importanceLevel=unknown");
  assert.equal(push.pushView, "card");
  assert.deepEqual(push.pushFilter, { status: null, protocol: null, dept: null, importanceLevel: null });

  const upstream = parseLocation("/upstream?view=grid&status=unknown&dbType=");
  assert.equal(upstream.upstreamView, "card");
  assert.deepEqual(upstream.upFilter, { status: null, dbType: null });
});

test("unknown pathnames retain the portal fallback contract", () => {
  const location = parseLocation("/not-a-module?q=ignored");

  assert.equal(location.module, "portal");
  assert.equal(location.query, "ignored");
});

test("navigation URL serialization preserves pathname and query contracts", () => {
  const location = buildNavigationLocation({
    module: "dwm",
    routes: {
      ...emptyRoutes,
      asset: { page: "detail", table: "orders/daily" },
    },
    query: " orders ",
    urlState: {
      asset: {
        domain: "sales",
        selectedLayer: "DWF",
        layout: "card",
        detailTab: "ddl",
      },
    },
  });

  assert.deepEqual(location, {
    pathname: "/data-warehouse/orders%2Fdaily",
    search: "?q=orders&domain=sales&layer=DWF&layout=card&tab=ddl",
    url: "/data-warehouse/orders%2Fdaily?q=orders&domain=sales&layer=DWF&layout=card&tab=ddl",
  });
});

test("module URL serialization covers filter, view, mapping, lineage, and system routes", () => {
  const report = buildNavigationLocation({
    module: "report",
    routes: { ...emptyRoutes, report: { page: "view", code: "RPT/001" } },
    query: "sales",
    urlState: { report: { filter: { type: "daily", status: "enabled", ownerDept: "finance" }, view: "card" } },
  });
  assert.equal(
    report.url,
    "/report-assets/RPT%2F001?q=sales&type=daily&status=enabled&ownerDept=finance&view=card",
  );

  const apiAsset = buildNavigationLocation({
    module: "apiAsset",
    routes: { ...emptyRoutes, apiAsset: { page: "list", code: null } },
    urlState: { apiAsset: { filter: { status: "enabled", method: "GET", downstreamSystemId: "sys-1" }, view: "group" } },
  });
  assert.equal(apiAsset.url, "/api-assets?status=enabled&method=GET&downstreamSystemId=sys-1&view=group");

  const mapping = buildNavigationLocation({
    module: "mapping",
    routes: { ...emptyRoutes, mapping: { tab: "field", sourceSystemId: "101", sourceTable: "src", dwfTable: "dwf" } },
  });
  assert.equal(mapping.url, "/field-mapping?sourceSystemId=101&sourceTable=src&dwfTable=dwf&tab=field");

  const lineage = buildNavigationLocation({
    module: "lineage",
    routes: { ...emptyRoutes, lineage: { rootId: "root", direction: "upstream", depth: 4, view: "detail" } },
  });
  assert.equal(lineage.url, "/lineage?rootId=root&direction=upstream&depth=4&view=detail");

  const system = buildNavigationLocation({
    module: "system",
    routes: { ...emptyRoutes, system: { page: "operation-logs" } },
  });
  assert.equal(system.url, "/system-management/operation-logs");
});

test("clearing one filter dimension omits only its query parameter", () => {
  const apiAsset = buildNavigationLocation({
    module: "apiAsset",
    routes: { ...emptyRoutes, apiAsset: { page: "list", code: null } },
    urlState: {
      apiAsset: {
        filter: { status: "enabled", method: null, downstreamSystemId: "sys-1" },
      },
    },
  });
  assert.equal(apiAsset.url, "/api-assets?status=enabled&downstreamSystemId=sys-1");

  const push = buildNavigationLocation({
    module: "push",
    routes: { ...emptyRoutes, push: { page: "systems", sys: null, job: null } },
    urlState: {
      push: {
        filter: { status: "enabled", protocol: null, dept: null, importanceLevel: "important" },
      },
    },
  });
  assert.equal(push.url, "/push?status=enabled&importanceLevel=important");
});

test("API asset filter deep links distinguish a selected method from all methods", () => {
  const selected = parseLocation("/api-assets?method=POST&status=enabled");
  assert.deepEqual(selected.apiAssetFilter, {
    status: "enabled",
    method: "POST",
    downstreamSystemId: null,
  });

  const all = parseLocation("/api-assets?status=enabled");
  assert.deepEqual(all.apiAssetFilter, {
    status: "enabled",
    method: null,
    downstreamSystemId: null,
  });
});

test("module route mapping is centralized for representative and special modules", () => {
  const routes: NavigationRoutes = {
    asset: { page: "asset", table: null },
    push: { page: "push", sys: null, job: null },
    upstream: { page: "upstream", id: null },
    indicator: { page: "indicator", id: null },
    report: { page: "report", code: null },
    apiAsset: { page: "apiAsset", code: null },
    system: { page: "system" },
  };

  assert.strictEqual(getActiveModuleRoute("dwm", routes), routes.asset);
  assert.strictEqual(getActiveModuleRoute("push", routes), routes.push);
  assert.strictEqual(getActiveModuleRoute("upstream", routes), routes.upstream);
  assert.strictEqual(getActiveModuleRoute("indicator", routes), routes.indicator);
  assert.strictEqual(getActiveModuleRoute("report", routes), routes.report);
  assert.strictEqual(getActiveModuleRoute("apiAsset", routes), routes.apiAsset);
  assert.strictEqual(getActiveModuleRoute("system", routes), routes.system);
});

test("parsed location state is restored as one navigation snapshot", () => {
  const parsed = parseLocation("/push/CRM?q=job&view=list&importanceLevel=important");
  const state = createNavigationState(parsed);

  assert.equal(state.module, "push");
  assert.deepEqual(state.pushRoute, { page: "jobs", sys: "CRM", job: null });
  assert.equal(state.query, "job");
  assert.equal(state.pushViewFromUrl, "list");
  assert.equal(state.pushFilterFromUrl.importanceLevel, "important");
});

test("history policy distinguishes initial replace, pathname push, query replace, and no-op", () => {
  const common = { currentUrl: "/data-warehouse", currentPathname: "/data-warehouse" };

  assert.equal(resolveHistoryAction({ ...common, nextUrl: "/data-warehouse?q=orders", nextPathname: "/data-warehouse", historyReady: false }), "replace");
  assert.equal(resolveHistoryAction({ ...common, nextUrl: "/data-warehouse/orders", nextPathname: "/data-warehouse/orders", historyReady: true }), "push");
  assert.equal(resolveHistoryAction({ ...common, nextUrl: "/data-warehouse?q=orders", nextPathname: "/data-warehouse", historyReady: true }), "replace");
  assert.equal(resolveHistoryAction({ ...common, nextUrl: "/data-warehouse", nextPathname: "/data-warehouse", historyReady: true }), "noop");
  assert.equal(resolveHistoryAction({ ...common, nextUrl: "/portal", nextPathname: "/portal", historyReady: true, isPopstate: true }), "replace");
});
