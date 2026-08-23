// Copyright 2025 Jearhe
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import {
  ASSET_LAYOUT_OPTIONS,
  DEFAULT_ASSET_ROUTE,
  DEFAULT_API_ASSET_FILTER,
  DEFAULT_API_ASSET_ROUTE,
  DEFAULT_API_ASSET_VIEW,
  DEFAULT_DETAIL_TAB,
  DEFAULT_LAYOUT,
  DEFAULT_PUSH_FILTER,
  DEFAULT_PUSH_ROUTE,
  DEFAULT_PUSH_VIEW,
  DEFAULT_MAPPING_ROUTE,
  DEFAULT_INDICATOR_FILTER,
  DEFAULT_INDICATOR_ROUTE,
  DEFAULT_INDICATOR_VIEW,
  DEFAULT_REPORT_FILTER,
  DEFAULT_REPORT_ROUTE,
  DEFAULT_REPORT_VIEW,
  DEFAULT_SYSTEM_ROUTE,
  DEFAULT_UP_FILTER,
  DEFAULT_UP_ROUTE,
  DEFAULT_UP_VIEW,
  INDICATOR_VIEW_OPTIONS,
  ASSET_VIEW_OPTIONS,
} from "../config/defaults.js";
import { INDICATOR_DIMENSION_OPTIONS } from "../data/indicators.js";
import { LAYER_OPTIONS } from "../config/assets.js";
import { getActiveModuleRoute } from "./navigation.js";

export function parseInitialLocation() {
  if (typeof window === "undefined") {
    return {
      module: "portal",
      query: "",
      assetRoute: DEFAULT_ASSET_ROUTE,
      assetLayout: DEFAULT_LAYOUT,
      assetDomain: null,
      assetLayer: null,
      assetDetailTab: DEFAULT_DETAIL_TAB,
      indicatorRoute: DEFAULT_INDICATOR_ROUTE,
      indicatorFilter: DEFAULT_INDICATOR_FILTER,
      indicatorView: DEFAULT_INDICATOR_VIEW,
      reportRoute: DEFAULT_REPORT_ROUTE,
      reportFilter: DEFAULT_REPORT_FILTER,
      reportView: DEFAULT_REPORT_VIEW,
      apiAssetRoute: DEFAULT_API_ASSET_ROUTE,
      apiAssetFilter: DEFAULT_API_ASSET_FILTER,
      apiAssetView: DEFAULT_API_ASSET_VIEW,
      pushRoute: DEFAULT_PUSH_ROUTE,
      pushFilter: DEFAULT_PUSH_FILTER,
      pushView: DEFAULT_PUSH_VIEW,
      upRoute: DEFAULT_UP_ROUTE,
      upFilter: DEFAULT_UP_FILTER,
      upstreamView: DEFAULT_UP_VIEW,
      mappingRoute: DEFAULT_MAPPING_ROUTE,
      lineageRoute: { rootId: null, direction: "both", depth: 2, view: "table" },
      systemRoute: DEFAULT_SYSTEM_ROUTE,
    };
  }

  const pathname = (window.location.pathname || "/").replace(/\/+$/, "") || "/";
  const searchParams = new URLSearchParams(window.location.search || "");
  const segments = pathname.split("/").filter(Boolean);
  const top = segments[0] || "";

  const indicatorView = INDICATOR_VIEW_OPTIONS.has(searchParams.get("view"))
    ? searchParams.get("view")
    : DEFAULT_INDICATOR_VIEW;
  const indicatorFilter = {
    dimension: INDICATOR_DIMENSION_OPTIONS.some((item) => item.value === searchParams.get("dimension"))
      ? searchParams.get("dimension")
      : DEFAULT_INDICATOR_FILTER.dimension,
    status: ["all", "enabled", "disabled"].includes(searchParams.get("status"))
      ? searchParams.get("status")
      : DEFAULT_INDICATOR_FILTER.status,
  };
  const reportFilter = {
    type: searchParams.get("type") || DEFAULT_REPORT_FILTER.type,
    status: ["enabled", "disabled"].includes(searchParams.get("status"))
      ? searchParams.get("status")
      : DEFAULT_REPORT_FILTER.status,
    ownerDept: searchParams.get("ownerDept") || DEFAULT_REPORT_FILTER.ownerDept,
  };
  const reportView = ASSET_VIEW_OPTIONS.has(searchParams.get("view")) ? searchParams.get("view") : DEFAULT_REPORT_VIEW;
  const apiAssetFilter = { status: ["enabled", "disabled"].includes(searchParams.get("status")) ? searchParams.get("status") : null, method: searchParams.get("method") || null, downstreamSystemId: searchParams.get("downstreamSystemId") || null };
  const apiAssetView = ASSET_VIEW_OPTIONS.has(searchParams.get("view")) ? searchParams.get("view") : DEFAULT_API_ASSET_VIEW;
  const pushFilter = {
    status: ["enabled", "disabled"].includes(searchParams.get("status"))
      ? searchParams.get("status")
      : DEFAULT_PUSH_FILTER.status,
    protocol: searchParams.get("protocol") || DEFAULT_PUSH_FILTER.protocol,
    dept: searchParams.get("dept") || DEFAULT_PUSH_FILTER.dept,
    importanceLevel: ["important", "normal"].includes(searchParams.get("importanceLevel"))
      ? searchParams.get("importanceLevel")
      : DEFAULT_PUSH_FILTER.importanceLevel,
  };
  const pushView = ["card", "list"].includes(searchParams.get("view"))
    ? searchParams.get("view")
    : DEFAULT_PUSH_VIEW;
  const upFilter = {
    status: ["enabled", "disabled"].includes(searchParams.get("status"))
      ? searchParams.get("status")
      : DEFAULT_UP_FILTER.status,
    dbType: searchParams.get("dbType") || DEFAULT_UP_FILTER.dbType,
  };
  const upstreamView = ["card", "list"].includes(searchParams.get("view"))
    ? searchParams.get("view")
    : DEFAULT_UP_VIEW;
  const assetLayout = ASSET_LAYOUT_OPTIONS.has(searchParams.get("layout"))
    ? searchParams.get("layout")
    : DEFAULT_LAYOUT;
  const assetDetailTab = searchParams.get("tab") === "ddl"
    ? "ddl"
    : DEFAULT_DETAIL_TAB;
  const requestedLayer = searchParams.get("layer")?.trim().toUpperCase() || "";
  const assetLayer = LAYER_OPTIONS.some((item) => item.code === requestedLayer)
    ? requestedLayer
    : null;
  const lineageRoute = {
    rootId: searchParams.get("rootId") || null,
    direction: ["upstream", "downstream", "both"].includes(searchParams.get("direction")) ? searchParams.get("direction") : "both",
    depth: [1, 2, 3, 4, 5].includes(Number(searchParams.get("depth"))) ? Number(searchParams.get("depth")) : 2,
    view: ["table", "detail"].includes(searchParams.get("view")) ? searchParams.get("view") : "table",
  };

  const base = {
    query: searchParams.get("q") || "",
    assetRoute: DEFAULT_ASSET_ROUTE,
    assetLayout,
    assetDomain: searchParams.get("domain") || null,
    assetLayer,
    assetDetailTab,
    indicatorRoute: DEFAULT_INDICATOR_ROUTE,
    indicatorFilter,
    indicatorView,
    reportRoute: DEFAULT_REPORT_ROUTE,
    reportFilter,
    reportView,
    apiAssetRoute: DEFAULT_API_ASSET_ROUTE,
    apiAssetFilter,
    apiAssetView,
    pushRoute: DEFAULT_PUSH_ROUTE,
    pushFilter,
    pushView,
    upRoute: DEFAULT_UP_ROUTE,
    upFilter,
    upstreamView,
    mappingRoute: DEFAULT_MAPPING_ROUTE,
    lineageRoute,
    systemRoute: DEFAULT_SYSTEM_ROUTE,
  };

  if (top === "indicator-maintenance") {
    if (segments[1] === "new") {
      return { ...base, module: "indicator", indicatorRoute: { page: "new", id: null } };
    }
    if (segments[1] && segments[2] === "edit") {
      return { ...base, module: "indicator", indicatorRoute: { page: "edit", id: decodeURIComponent(segments[1]) } };
    }
    if (segments[1]) {
      return { ...base, module: "indicator", indicatorRoute: { page: "view", id: decodeURIComponent(segments[1]) } };
    }
    return { ...base, module: "indicator" };
  }
  if (top === "report-assets") {
    if (segments[1] === "new") {
      return { ...base, module: "report", reportRoute: { page: "new", code: null } };
    }
    if (segments[1] && segments[2] === "edit") {
      return { ...base, module: "report", reportRoute: { page: "edit", code: decodeURIComponent(segments[1]) } };
    }
    if (segments[1]) {
      return { ...base, module: "report", reportRoute: { page: "view", code: decodeURIComponent(segments[1]) } };
    }
    return { ...base, module: "report" };
  }
  if (top === "api-assets") {
    if (segments[1] === "new") return { ...base, module: "apiAsset", apiAssetRoute: { page: "new", code: null } };
    if (segments[1] && segments[2] === "edit") return { ...base, module: "apiAsset", apiAssetRoute: { page: "edit", code: decodeURIComponent(segments[1]) } };
    if (segments[1]) return { ...base, module: "apiAsset", apiAssetRoute: { page: "view", code: decodeURIComponent(segments[1]) } };
    return { ...base, module: "apiAsset" };
  }
  if (top === "field-mapping") {
    return {
      ...base,
      module: "mapping",
      mappingRoute: {
        tab: searchParams.get("tab") === "field" ? "field" : "table",
        upstreamSystemId: searchParams.get("upstreamSystemId") || searchParams.get("sourceSystemId") || "",
        sourceTable: searchParams.get("sourceTable") || "",
        dwfTable: searchParams.get("dwfTable") || "",
      },
    };
  }
  if (top === "lineage") return { ...base, module: "lineage", lineageRoute };
  if (top === "data-warehouse") {
    if (segments[1] === "new") {
      return { ...base, module: "dwm", assetRoute: { page: "new", table: null } };
    }
    if (segments[1] && segments[2] === "edit") {
      return {
        ...base,
        module: "dwm",
        assetRoute: { page: "edit", table: decodeURIComponent(segments[1]) },
      };
    }
    if (segments[1]) {
      return {
        ...base,
        module: "dwm",
        assetRoute: { page: "detail", table: decodeURIComponent(segments[1]) },
      };
    }
    return { ...base, module: "dwm" };
  }
  if (top === "upstream") {
    if (segments[1] === "new") {
      return { ...base, module: "upstream", upRoute: { page: "new", id: null } };
    }
    if (segments[1] && segments[2] === "edit") {
      return {
        ...base,
        module: "upstream",
        upRoute: { page: "edit", id: decodeURIComponent(segments[1]) },
      };
    }
    if (segments[1]) {
      return {
        ...base,
        module: "upstream",
        upRoute: { page: "detail", id: decodeURIComponent(segments[1]) },
      };
    }
    return { ...base, module: "upstream" };
  }
  if (top === "push") {
    if (segments[1] === "new") {
      return { ...base, module: "push", pushRoute: { page: "sysNew", sys: null, job: null } };
    }
    if (segments[1] && segments[2] === "edit") {
      return {
        ...base,
        module: "push",
        pushRoute: { page: "sysEdit", sys: decodeURIComponent(segments[1]), job: null },
      };
    }
    if (segments[1] && segments[2] === "new") {
      return {
        ...base,
        module: "push",
        pushRoute: { page: "jobNew", sys: decodeURIComponent(segments[1]), job: null },
      };
    }
    if (segments[1] && segments[2] && segments[3] === "edit") {
      return {
        ...base,
        module: "push",
        pushRoute: { page: "jobEdit", sys: decodeURIComponent(segments[1]), job: decodeURIComponent(segments[2]) },
      };
    }
    if (segments[1] && segments[2]) {
      return {
        ...base,
        module: "push",
        pushRoute: { page: "fields", sys: decodeURIComponent(segments[1]), job: decodeURIComponent(segments[2]) },
      };
    }
    if (segments[1]) {
      return {
        ...base,
        module: "push",
        pushRoute: { page: "jobs", sys: decodeURIComponent(segments[1]), job: null },
      };
    }
    return { ...base, module: "push" };
  }
  if (top === "root-management") return { ...base, module: "root" };
  if (top === "code-table-maintenance") return { ...base, module: "codeTable" };
  if (top === "system-management") {
    if (segments[1] === "menus") {
      return { ...base, module: "system", systemRoute: { page: "menus" } };
    }
    if (segments[1] === "param-dicts") {
      return { ...base, module: "system", systemRoute: { page: "param-dicts" } };
    }
    if (segments[1] === "roles") {
      return { ...base, module: "system", systemRoute: { page: "roles" } };
    }
    if (segments[1] === "operation-logs") {
      return { ...base, module: "system", systemRoute: { page: "operation-logs" } };
    }
    return { ...base, module: "system", systemRoute: DEFAULT_SYSTEM_ROUTE };
  }
  if (top === "" || top === "portal") return { ...base, module: "portal" };
  return { ...base, module: "portal" };
}

export function buildPathname(module, moduleRoute, systemRoute) {
  if (module === "dwm") {
    if (moduleRoute.page === "new") return "/data-warehouse/new";
    if (moduleRoute.page === "edit" && moduleRoute.table) {
      return `/data-warehouse/${encodeURIComponent(moduleRoute.table)}/edit`;
    }
    if (moduleRoute.page === "detail" && moduleRoute.table) {
      return `/data-warehouse/${encodeURIComponent(moduleRoute.table)}`;
    }
    return "/data-warehouse";
  }
  if (module === "indicator") {
    if (moduleRoute.page === "new") return "/indicator-maintenance/new";
    if (moduleRoute.page === "edit" && moduleRoute.id) {
      return `/indicator-maintenance/${encodeURIComponent(moduleRoute.id)}/edit`;
    }
    if (moduleRoute.page === "view" && moduleRoute.id) {
      return `/indicator-maintenance/${encodeURIComponent(moduleRoute.id)}`;
    }
    return "/indicator-maintenance";
  }
  if (module === "report") {
    if (moduleRoute.page === "new") return "/report-assets/new";
    if (moduleRoute.page === "edit" && moduleRoute.code) {
      return `/report-assets/${encodeURIComponent(moduleRoute.code)}/edit`;
    }
    if (moduleRoute.page === "view" && moduleRoute.code) {
      return `/report-assets/${encodeURIComponent(moduleRoute.code)}`;
    }
    return "/report-assets";
  }
  if (module === "apiAsset") {
    if (moduleRoute.page === "new") return "/api-assets/new";
    if (moduleRoute.page === "edit" && moduleRoute.code) return `/api-assets/${encodeURIComponent(moduleRoute.code)}/edit`;
    if (moduleRoute.page === "view" && moduleRoute.code) return `/api-assets/${encodeURIComponent(moduleRoute.code)}`;
    return "/api-assets";
  }
  if (module === "mapping") return "/field-mapping";
  if (module === "lineage") return "/lineage";
  if (module === "root") return "/root-management";
  if (module === "codeTable") return "/code-table-maintenance";
  if (module === "upstream") {
    if (moduleRoute.page === "new") return "/upstream/new";
    if (moduleRoute.page === "edit" && moduleRoute.id) {
      return `/upstream/${encodeURIComponent(moduleRoute.id)}/edit`;
    }
    if (moduleRoute.page === "detail" && moduleRoute.id) {
      return `/upstream/${encodeURIComponent(moduleRoute.id)}`;
    }
    return "/upstream";
  }
  if (module === "push") {
    if (moduleRoute.page === "sysNew") return "/push/new";
    if (moduleRoute.page === "sysEdit" && moduleRoute.sys) {
      return `/push/${encodeURIComponent(moduleRoute.sys)}/edit`;
    }
    if (moduleRoute.page === "jobNew" && moduleRoute.sys) {
      return `/push/${encodeURIComponent(moduleRoute.sys)}/new`;
    }
    if (moduleRoute.page === "jobEdit" && moduleRoute.sys && moduleRoute.job) {
      return `/push/${encodeURIComponent(moduleRoute.sys)}/${encodeURIComponent(moduleRoute.job)}/edit`;
    }
    if (moduleRoute.page === "fields" && moduleRoute.sys && moduleRoute.job) {
      return `/push/${encodeURIComponent(moduleRoute.sys)}/${encodeURIComponent(moduleRoute.job)}`;
    }
    if (moduleRoute.page === "jobs" && moduleRoute.sys) {
      return `/push/${encodeURIComponent(moduleRoute.sys)}`;
    }
    return "/push";
  }
  if (module === "system") {
    if (systemRoute.page === "menus") return "/system-management/menus";
    if (systemRoute.page === "param-dicts") return "/system-management/param-dicts";
    if (systemRoute.page === "roles") return "/system-management/roles";
    if (systemRoute.page === "operation-logs") return "/system-management/operation-logs";
    return "/system-management/users";
  }
  if (module === "portal") return "/";
  return "/data-warehouse";
}

const DEFAULT_LINEAGE_ROUTE = { rootId: null, direction: "both", depth: 2, view: "table" };

export function buildNavigationLocation({ module, routes = {}, query = "", urlState = {} }) {
  const pathname = buildPathname(
    module,
    getActiveModuleRoute(module, routes),
    routes.system || DEFAULT_SYSTEM_ROUTE,
  );
  const params = new URLSearchParams();
  const asset = urlState.asset || {};
  const indicator = urlState.indicator || {};
  const report = urlState.report || {};
  const apiAsset = urlState.apiAsset || {};
  const upstream = urlState.upstream || {};
  const push = urlState.push || {};
  const indicatorFilter = indicator.filter || DEFAULT_INDICATOR_FILTER;
  const reportFilter = report.filter || DEFAULT_REPORT_FILTER;
  const apiAssetFilter = apiAsset.filter || DEFAULT_API_ASSET_FILTER;
  const upstreamFilter = upstream.filter || DEFAULT_UP_FILTER;
  const pushFilter = push.filter || DEFAULT_PUSH_FILTER;
  const assetLayout = asset.layout || DEFAULT_LAYOUT;
  const assetDetailTab = asset.detailTab || DEFAULT_DETAIL_TAB;
  const indicatorView = indicator.view || DEFAULT_INDICATOR_VIEW;
  const reportView = report.view || DEFAULT_REPORT_VIEW;
  const apiAssetView = apiAsset.view || DEFAULT_API_ASSET_VIEW;
  const upstreamView = upstream.view || DEFAULT_UP_VIEW;
  const pushView = push.view || DEFAULT_PUSH_VIEW;
  const mappingRoute = routes.mapping || DEFAULT_MAPPING_ROUTE;
  const lineageRoute = routes.lineage || DEFAULT_LINEAGE_ROUTE;
  const normalizedQuery = String(query || "").trim();

  if (module === "dwm") {
    if (normalizedQuery) params.set("q", normalizedQuery);
    if (asset.domain) params.set("domain", asset.domain);
    if (asset.selectedLayer) params.set("layer", asset.selectedLayer);
    if (assetLayout !== DEFAULT_LAYOUT) params.set("layout", assetLayout);
    if (routes.asset?.page === "detail" && assetDetailTab !== DEFAULT_DETAIL_TAB) {
      params.set("tab", assetDetailTab);
    }
  }

  if (module === "report") {
    if (normalizedQuery) params.set("q", normalizedQuery);
    if (reportFilter.type) params.set("type", reportFilter.type);
    if (reportFilter.status) params.set("status", reportFilter.status);
    if (reportFilter.ownerDept) params.set("ownerDept", reportFilter.ownerDept);
    if (reportView !== DEFAULT_REPORT_VIEW) {
      params.set("view", reportView);
    }
  }

  if (module === "apiAsset") {
    if (normalizedQuery) params.set("q", normalizedQuery);
    if (apiAssetFilter.status) params.set("status", apiAssetFilter.status);
    if (apiAssetFilter.method) params.set("method", apiAssetFilter.method);
    if (apiAssetFilter.downstreamSystemId) params.set("downstreamSystemId", apiAssetFilter.downstreamSystemId);
    if (apiAssetView !== DEFAULT_API_ASSET_VIEW) {
      params.set("view", apiAssetView);
    }
  }

  if (module === "indicator") {
    if (normalizedQuery) params.set("q", normalizedQuery);
    if (indicatorFilter.dimension !== "all") params.set("dimension", indicatorFilter.dimension);
    if (indicatorFilter.status !== "all") params.set("status", indicatorFilter.status);
    if (indicatorView !== DEFAULT_INDICATOR_VIEW) {
      params.set("view", indicatorView);
    }
  }

  if (module === "mapping") {
    if (mappingRoute.upstreamSystemId) params.set("upstreamSystemId", mappingRoute.upstreamSystemId);
    if (mappingRoute.sourceTable) params.set("sourceTable", mappingRoute.sourceTable);
    if (mappingRoute.dwfTable) params.set("dwfTable", mappingRoute.dwfTable);
    if (mappingRoute.tab && mappingRoute.tab !== DEFAULT_MAPPING_ROUTE.tab) {
      params.set("tab", mappingRoute.tab);
    }
  }

  if (module === "lineage") {
    if (lineageRoute.rootId) params.set("rootId", lineageRoute.rootId);
    params.set("direction", lineageRoute.direction);
    params.set("depth", lineageRoute.depth);
    if (lineageRoute.view !== DEFAULT_LINEAGE_ROUTE.view) params.set("view", lineageRoute.view);
  }

  if (module === "upstream") {
    if (normalizedQuery) params.set("q", normalizedQuery);
    if (upstreamFilter.status) params.set("status", upstreamFilter.status);
    if (upstreamFilter.dbType) params.set("dbType", upstreamFilter.dbType);
    if (upstreamView !== DEFAULT_UP_VIEW && routes.upstream?.page === "list") {
      params.set("view", upstreamView);
    }
  }

  if (module === "push") {
    if (normalizedQuery) params.set("q", normalizedQuery);
    if (pushFilter.status) params.set("status", pushFilter.status);
    if (pushFilter.protocol) params.set("protocol", pushFilter.protocol);
    if (pushFilter.dept) params.set("dept", pushFilter.dept);
    if (pushFilter.importanceLevel) params.set("importanceLevel", pushFilter.importanceLevel);
    if (pushView !== DEFAULT_PUSH_VIEW && routes.push?.page === "systems") {
      params.set("view", pushView);
    }
  }

  if (module === "codeTable" && normalizedQuery) params.set("q", normalizedQuery);

  const search = params.toString() ? `?${params.toString()}` : "";
  return { pathname, search, url: `${pathname}${search}` };
}

export function resolveHistoryAction({
  currentUrl,
  currentPathname,
  nextUrl,
  nextPathname,
  historyReady,
  isPopstate = false,
}) {
  if (currentUrl === nextUrl) return "noop";
  if (isPopstate) return "replace";
  if (historyReady && currentPathname !== nextPathname) return "push";
  return "replace";
}
