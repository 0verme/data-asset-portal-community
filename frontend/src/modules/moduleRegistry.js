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

/**
 * Frontend module registry — single source for module codes, paths, and
 * default enable flags. Codes match backend capabilities and menu codes.
 */

export const MODULE_REGISTRY = [
  {
    code: "portal",
    title: "门户首页",
    path: "/",
    pathPrefixes: ["", "portal"],
    icon: "search",
    requires: [],
    enabledByDefault: true,
    nav: false,
  },
  {
    code: "upstream",
    title: "上游卸数",
    path: "/upstream",
    pathPrefixes: ["upstream"],
    icon: "download",
    requires: [],
    enabledByDefault: true,
    nav: true,
  },
  {
    code: "dwm",
    title: "数据仓库",
    path: "/data-warehouse",
    pathPrefixes: ["data-warehouse"],
    icon: "db",
    requires: [],
    enabledByDefault: true,
    nav: true,
  },
  {
    code: "mapping",
    title: "字段映射",
    path: "/field-mapping",
    pathPrefixes: ["field-mapping"],
    icon: "link",
    requires: [],
    enabledByDefault: true,
    nav: true,
  },
  {
    code: "lineage",
    title: "血缘分析",
    path: "/lineage",
    pathPrefixes: ["lineage"],
    icon: "layers",
    requires: [],
    enabledByDefault: true,
    nav: true,
  },
  {
    code: "root",
    title: "词根管理",
    path: "/root-management",
    pathPrefixes: ["root-management"],
    icon: "book",
    requires: [],
    enabledByDefault: true,
    nav: true,
  },
  {
    code: "indicator",
    title: "指标维护",
    path: "/indicator-maintenance",
    pathPrefixes: ["indicator-maintenance"],
    icon: "hash",
    requires: [],
    enabledByDefault: true,
    nav: true,
  },
  {
    code: "report",
    title: "报表资产",
    path: "/report-assets",
    pathPrefixes: ["report-assets"],
    icon: "file",
    requires: [],
    enabledByDefault: true,
    nav: true,
  },
  {
    code: "apiAsset",
    title: "API 资产",
    path: "/api-assets",
    pathPrefixes: ["api-assets"],
    icon: "api",
    requires: [],
    enabledByDefault: true,
    nav: true,
  },
  {
    code: "push",
    title: "下游推送",
    path: "/push",
    pathPrefixes: ["push"],
    icon: "upload",
    requires: [],
    enabledByDefault: true,
    nav: true,
  },
  {
    code: "codeTable",
    title: "码值表维护",
    path: "/code-table-maintenance",
    pathPrefixes: ["code-table-maintenance"],
    icon: "table",
    requires: [],
    enabledByDefault: true,
    nav: true,
  },
  {
    code: "system",
    title: "系统管理",
    path: "/system-management",
    pathPrefixes: ["system-management"],
    icon: "shield",
    requires: [],
    enabledByDefault: true,
    nav: true,
  },
];

const BY_CODE = new Map(MODULE_REGISTRY.map((item) => [item.code, item]));

const PATH_OWNERS = (() => {
  const owners = new Map();
  for (const item of MODULE_REGISTRY) {
    for (const prefix of item.pathPrefixes || []) {
      if (!prefix) continue;
      if (owners.has(prefix) && owners.get(prefix) !== item.code) {
        throw new Error(
          `duplicate frontend path prefix ${prefix} for ${owners.get(prefix)} and ${item.code}`,
        );
      }
      owners.set(prefix, item.code);
    }
  }
  return owners;
})();

export function listModuleCodes() {
  return MODULE_REGISTRY.map((item) => item.code);
}

export function getModuleDefinition(code) {
  return BY_CODE.get(code) || null;
}

export function getModuleByPathPrefix(topSegment) {
  const key = String(topSegment || "").trim();
  if (!key || key === "portal") return BY_CODE.get("portal") || null;
  const code = PATH_OWNERS.get(key);
  return code ? BY_CODE.get(code) : null;
}

/**
 * Default enabled set for mock mode / offline fallbacks.
 * Respects VITE_ENABLED_MODULES when set (comma-separated or "all").
 */
export function resolveDefaultEnabledModules(envValue = import.meta.env?.VITE_ENABLED_MODULES) {
  const raw = String(envValue ?? "").trim();
  if (!raw || raw.toLowerCase() === "all") {
    return new Set(
      MODULE_REGISTRY.filter((item) => item.enabledByDefault).map((item) => item.code),
    );
  }
  const requested = raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const known = new Set(listModuleCodes());
  const enabled = new Set(requested.filter((code) => known.has(code)));

  // Auto-disable dependents when a required module is missing (mirror backend).
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of MODULE_REGISTRY) {
      if (!enabled.has(item.code)) continue;
      for (const req of item.requires || []) {
        if (!enabled.has(req)) {
          enabled.delete(item.code);
          changed = true;
          break;
        }
      }
    }
  }
  // portal is always available for the shell.
  enabled.add("portal");
  return enabled;
}

export function isModuleEnabled(code, enabledSet) {
  if (!enabledSet) return true;
  return enabledSet.has(code);
}

export function filterMenusByCapabilities(menus, enabledSet) {
  if (!Array.isArray(menus)) return [];
  if (!enabledSet) return menus;
  return menus.filter((item) => {
    const code = item?.code;
    if (!code) return false;
    // Unknown menu codes (custom) pass through; known registry codes need capability.
    if (!BY_CODE.has(code)) return true;
    return enabledSet.has(code);
  });
}

export function validateModuleRegistry() {
  const codes = new Set();
  for (const item of MODULE_REGISTRY) {
    if (!item.code) throw new Error("module registry entry missing code");
    if (codes.has(item.code)) throw new Error(`duplicate module code: ${item.code}`);
    codes.add(item.code);
    for (const req of item.requires || []) {
      if (!BY_CODE.has(req)) {
        throw new Error(`module ${item.code} requires unknown module ${req}`);
      }
    }
  }
  return true;
}
