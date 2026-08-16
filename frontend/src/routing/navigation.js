import {
  DEFAULT_ASSET_ROUTE,
  DEFAULT_API_ASSET_ROUTE,
  DEFAULT_INDICATOR_ROUTE,
  DEFAULT_MAPPING_ROUTE,
  DEFAULT_PUSH_ROUTE,
  DEFAULT_REPORT_ROUTE,
  DEFAULT_ROOT_ROUTE,
  DEFAULT_SYSTEM_ROUTE,
  DEFAULT_UP_ROUTE,
} from "../config/defaults.js";

const MODULE_NAV_STACK_PREFIX = "dap:nav-stack:";

export const MODULE_META = {
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
    moduleKey: "apiAsset", moduleName: "API 资产", defaultRoute: DEFAULT_API_ASSET_ROUTE,
    defaultPath: "/api-assets", listLabel: "API 资产列表", backText: "返回 API 资产列表",
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

function cloneRoute(route) {
  if (!route || typeof route !== "object") return route;
  return { ...route };
}

export function getModuleListRoute(moduleKey) {
  const meta = MODULE_META[moduleKey];
  return meta ? cloneRoute(meta.defaultRoute) : null;
}

export function getModuleDetailRoute(moduleKey, id) {
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

export function getModuleEditRoute(moduleKey, id) {
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

export function getPushSystemDetailRoute(systemId) {
  return systemId ? { page: "jobs", sys: systemId, job: null } : getModuleListRoute("push");
}

export function getPushSystemEditRoute(systemId) {
  return systemId ? { page: "sysEdit", sys: systemId, job: null } : { page: "sysNew", sys: null, job: null };
}

export function getPushInterfaceDetailRoute(systemId, jobId) {
  if (!systemId) return getModuleListRoute("push");
  return jobId ? { page: "fields", sys: systemId, job: jobId } : getPushSystemDetailRoute(systemId);
}

export function getPushInterfaceEditRoute(systemId, jobId) {
  if (!systemId) return getModuleListRoute("push");
  return jobId ? { page: "jobEdit", sys: systemId, job: jobId } : { page: "jobNew", sys: systemId, job: null };
}

function readStack(moduleKey) {
  if (typeof window === "undefined" || !window.sessionStorage) return [];
  try {
    const raw = window.sessionStorage.getItem(`${MODULE_NAV_STACK_PREFIX}${moduleKey}`);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeStack(moduleKey, stack) {
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

export function pushModuleNavigationState(moduleKey, state) {
  if (!moduleKey || !state) return;
  const stack = readStack(moduleKey);
  writeStack(moduleKey, [...stack, state]);
}

export function popModuleNavigationState(moduleKey) {
  if (!moduleKey) return null;
  const stack = readStack(moduleKey);
  if (!stack.length) return null;
  const next = stack.slice(0, -1);
  const entry = stack[stack.length - 1];
  writeStack(moduleKey, next);
  return entry;
}

export function clearModuleNavigationState(moduleKey) {
  if (!moduleKey) return;
  writeStack(moduleKey, []);
}

export function buildModuleBreadcrumbs(moduleKey, items = [], onModuleClick) {
  const meta = MODULE_META[moduleKey];
  if (!meta) return items;

  return [
    {
      label: meta.moduleName,
      onClick: onModuleClick,
    },
    ...items,
  ];
}
