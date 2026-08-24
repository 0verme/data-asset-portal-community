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
  DEFAULT_ASSET_ROUTE,
  DEFAULT_API_ASSET_FILTER,
  DEFAULT_API_ASSET_ROUTE,
  DEFAULT_API_ASSET_VIEW,
  DEFAULT_DETAIL_TAB,
  DEFAULT_INDICATOR_FILTER,
  DEFAULT_INDICATOR_ROUTE,
  DEFAULT_INDICATOR_VIEW,
  DEFAULT_LAYOUT,
  DEFAULT_MAPPING_ROUTE,
  DEFAULT_PUSH_FILTER,
  DEFAULT_PUSH_ROUTE,
  DEFAULT_PUSH_VIEW,
  DEFAULT_REPORT_FILTER,
  DEFAULT_REPORT_ROUTE,
  DEFAULT_REPORT_VIEW,
  DEFAULT_ROOT_ROUTE,
  DEFAULT_SYSTEM_ROUTE,
  DEFAULT_UP_FILTER,
  DEFAULT_UP_ROUTE,
  DEFAULT_UP_VIEW,
} from "../config/defaults.js";
import type {
  BreadcrumbItem,
  ModuleId,
  ModuleMeta,
  ModuleMetaKey,
  NavigationRoute,
  NavigationRoutes,
  NavigationState,
  LocationSnapshotInput,
} from "./types.js";

const MODULE_NAV_STACK_PREFIX = "dap:nav-stack:";

export const MODULE_META: Record<ModuleMetaKey, ModuleMeta> = {
  dwm: {
    moduleKey: "dwm",
    moduleName: "数据仓库",
    defaultRoute: DEFAULT_ASSET_ROUTE,
    defaultPath: "/data-warehouse",
    listLabel: "数据仓库列表",
    backText: "返回列表",
  },
  upstream: {
    moduleKey: "upstream",
    moduleName: "上游卸数",
    defaultRoute: DEFAULT_UP_ROUTE,
    defaultPath: "/upstream",
    listLabel: "上游卸数列表",
    backText: "返回列表",
  },
  mapping: {
    moduleKey: "mapping",
    moduleName: "字段映射",
    defaultRoute: DEFAULT_MAPPING_ROUTE,
    defaultPath: "/field-mapping",
    listLabel: "字段映射列表",
    backText: "返回字段映射列表",
  },
  root: {
    moduleKey: "root",
    moduleName: "词根管理",
    defaultRoute: DEFAULT_ROOT_ROUTE,
    defaultPath: "/root-management",
    listLabel: "词根列表",
    backText: "返回词根列表",
  },
  indicator: {
    moduleKey: "indicator",
    moduleName: "指标维护",
    defaultRoute: DEFAULT_INDICATOR_ROUTE,
    defaultPath: "/indicator-maintenance",
    listLabel: "指标列表",
    backText: "返回指标列表",
  },
  report: {
    moduleKey: "report",
    moduleName: "报表资产",
    defaultRoute: DEFAULT_REPORT_ROUTE,
    defaultPath: "/report-assets",
    listLabel: "报表资产列表",
    backText: "返回报表资产列表",
  },
  apiAsset: {
    moduleKey: "apiAsset",
    moduleName: "API 资产",
    defaultRoute: DEFAULT_API_ASSET_ROUTE,
    defaultPath: "/api-assets",
    listLabel: "API 资产列表",
    backText: "返回 API 资产列表",
  },
  push: {
    moduleKey: "push",
    moduleName: "下游推送",
    defaultRoute: DEFAULT_PUSH_ROUTE,
    defaultPath: "/push",
    listLabel: "下游推送列表",
    backText: "返回下游推送列表",
  },
  system: {
    moduleKey: "system",
    moduleName: "系统管理",
    defaultRoute: DEFAULT_SYSTEM_ROUTE,
    defaultPath: "/system-management/users",
    listLabel: "系统管理",
    backText: "返回系统管理",
  },
  codeTable: {
    moduleKey: "codeTable",
    moduleName: "码值表维护",
    defaultRoute: {},
    defaultPath: "/code-table-maintenance",
    listLabel: "码值表列表",
    backText: "返回码值表列表",
  },
};

function cloneRoute(route: NavigationRoute | null | undefined): NavigationRoute | null | undefined {
  if (!route || typeof route !== "object") return route;
  return { ...route };
}

const DEFAULT_LINEAGE_ROUTE = { rootId: null, direction: "both", depth: 2, view: "table" } as const;

export function getActiveModuleRoute(
  moduleKey: ModuleId,
  routes: NavigationRoutes = {},
): NavigationRoute | null | undefined {
  switch (moduleKey) {
    case "dwm": return routes.asset;
    case "push": return routes.push;
    case "upstream": return routes.upstream;
    case "report": return routes.report;
    case "apiAsset": return routes.apiAsset;
    case "indicator": return routes.indicator;
    case "mapping": return routes.mapping;
    case "lineage": return routes.lineage;
    case "root": return routes.root;
    case "system": return routes.system;
    case "codeTable": return null;
    default: return routes.indicator;
  }
}

export function createNavigationState(location: LocationSnapshotInput = {}): NavigationState {
  return {
    module: location.module || "portal",
    query: location.query || "",
    route: location.assetRoute || DEFAULT_ASSET_ROUTE,
    pushRoute: location.pushRoute || DEFAULT_PUSH_ROUTE,
    indicatorRoute: location.indicatorRoute || DEFAULT_INDICATOR_ROUTE,
    reportRoute: location.reportRoute || DEFAULT_REPORT_ROUTE,
    apiAssetRoute: location.apiAssetRoute || DEFAULT_API_ASSET_ROUTE,
    rootRoute: location.rootRoute || DEFAULT_ROOT_ROUTE,
    upRoute: location.upRoute || DEFAULT_UP_ROUTE,
    mappingRoute: location.mappingRoute || DEFAULT_MAPPING_ROUTE,
    lineageRoute: location.lineageRoute || DEFAULT_LINEAGE_ROUTE,
    systemRoute: location.systemRoute || DEFAULT_SYSTEM_ROUTE,
    assetLayoutFromUrl: location.assetLayout || DEFAULT_LAYOUT,
    assetDomainFromUrl: location.assetDomain ?? null,
    assetLayerFromUrl: location.assetLayer ?? null,
    assetDetailTabFromUrl: location.assetDetailTab || DEFAULT_DETAIL_TAB,
    pushViewFromUrl: location.pushView || DEFAULT_PUSH_VIEW,
    pushFilterFromUrl: location.pushFilter || DEFAULT_PUSH_FILTER,
    upFilterFromUrl: location.upFilter || DEFAULT_UP_FILTER,
    upstreamViewFromUrl: location.upstreamView || DEFAULT_UP_VIEW,
    indicatorFilter: location.indicatorFilter || DEFAULT_INDICATOR_FILTER,
    indicatorView: location.indicatorView || DEFAULT_INDICATOR_VIEW,
    reportFilter: location.reportFilter || DEFAULT_REPORT_FILTER,
    reportView: location.reportView || DEFAULT_REPORT_VIEW,
    apiAssetFilter: location.apiAssetFilter || DEFAULT_API_ASSET_FILTER,
    apiAssetView: location.apiAssetView || DEFAULT_API_ASSET_VIEW,
  };
}

export function getModuleListRoute(moduleKey: string): NavigationRoute | null {
  const meta = Object.prototype.hasOwnProperty.call(MODULE_META, moduleKey)
    ? MODULE_META[moduleKey as ModuleMetaKey]
    : undefined;
  return meta ? cloneRoute(meta.defaultRoute) || null : null;
}

export function getModuleDetailRoute(moduleKey: string, id: string | null | undefined): NavigationRoute | null {
  if (!id) return getModuleListRoute(moduleKey);
  switch (moduleKey) {
    case "dwm":
      return { page: "detail", table: id };
    case "upstream":
      return { page: "detail", id };
    case "indicator":
      return { page: "view", id };
    case "report":
      return { page: "view", code: id };
    case "apiAsset":
      return { page: "view", code: id };
    case "root":
      return { page: "edit", abbr: id };
    default:
      return getModuleListRoute(moduleKey);
  }
}

export function getModuleEditRoute(moduleKey: string, id?: string | null): NavigationRoute | null {
  switch (moduleKey) {
    case "dwm":
      return id ? { page: "edit", table: id } : { page: "new", table: null };
    case "upstream":
      return id ? { page: "edit", id } : { page: "new", id: null };
    case "indicator":
      return id ? { page: "edit", id } : { page: "new", id: null };
    case "report":
      return id ? { page: "edit", code: id } : { page: "new", code: null };
    case "apiAsset":
      return id ? { page: "edit", code: id } : { page: "new", code: null };
    default:
      return getModuleListRoute(moduleKey);
  }
}

export function getPushSystemDetailRoute(systemId: string | null | undefined): NavigationRoute | null {
  return systemId ? { page: "jobs", sys: systemId, job: null } : getModuleListRoute("push");
}

export function getPushSystemEditRoute(systemId: string | null | undefined): NavigationRoute | null {
  return systemId
    ? { page: "sysEdit", sys: systemId, job: null }
    : { page: "sysNew", sys: null, job: null };
}

export function getPushInterfaceDetailRoute(
  systemId: string | null | undefined,
  jobId: string | null | undefined,
): NavigationRoute | null {
  if (!systemId) return getModuleListRoute("push");
  return jobId
    ? { page: "fields", sys: systemId, job: jobId }
    : getPushSystemDetailRoute(systemId);
}

export function getPushInterfaceEditRoute(
  systemId: string | null | undefined,
  jobId: string | null | undefined,
): NavigationRoute | null {
  if (!systemId) return getModuleListRoute("push");
  return jobId
    ? { page: "jobEdit", sys: systemId, job: jobId }
    : { page: "jobNew", sys: systemId, job: null };
}

function readStack(moduleKey: string): unknown[] {
  if (typeof window === "undefined" || !window.sessionStorage) return [];
  try {
    const raw = window.sessionStorage.getItem(`${MODULE_NAV_STACK_PREFIX}${moduleKey}`);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeStack(moduleKey: string, stack: unknown[]): void {
  if (typeof window === "undefined" || !window.sessionStorage) return;
  try {
    if (!stack.length) {
      window.sessionStorage.removeItem(`${MODULE_NAV_STACK_PREFIX}${moduleKey}`);
      return;
    }
    window.sessionStorage.setItem(`${MODULE_NAV_STACK_PREFIX}${moduleKey}`, JSON.stringify(stack.slice(-12)));
  } catch {
    // ignore storage failures and fall back to default navigation
  }
}

export function pushModuleNavigationState(moduleKey: string, state: unknown): void {
  if (!moduleKey || !state) return;
  const stack = readStack(moduleKey);
  writeStack(moduleKey, [...stack, state]);
}

export function popModuleNavigationState(moduleKey: string): unknown | null {
  if (!moduleKey) return null;
  const stack = readStack(moduleKey);
  if (!stack.length) return null;
  const next = stack.slice(0, -1);
  const entry = stack[stack.length - 1];
  writeStack(moduleKey, next);
  return entry ?? null;
}

export function clearModuleNavigationState(moduleKey: string): void {
  if (!moduleKey) return;
  writeStack(moduleKey, []);
}

export function buildModuleBreadcrumbs(
  moduleKey: string,
  items: BreadcrumbItem[] = [],
  onModuleClick?: () => void,
): BreadcrumbItem[] {
  const meta = Object.prototype.hasOwnProperty.call(MODULE_META, moduleKey)
    ? MODULE_META[moduleKey as ModuleMetaKey]
    : undefined;
  if (!meta) return items;

  return [
    {
      label: meta.moduleName,
      onClick: onModuleClick,
    },
    ...items,
  ];
}
