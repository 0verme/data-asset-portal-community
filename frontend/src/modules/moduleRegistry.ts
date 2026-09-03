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
 * Frontend module registry — source for repository module codes, paths, and
 * static metadata. Codes match the backend capability compatibility contract
 * and menu codes; instance menu status is applied by the navigation layer.
 * `enabledByDefault` is retained metadata for the open module contract, not a
 * license, Edition, permission, menu, profile, or dependency-readiness gate.
 */

export interface ModuleDefinition {
  code: string;
  title: string;
  path: string;
  pathPrefixes: readonly string[];
  icon: string;
  requires: readonly string[];
  enabledByDefault: boolean;
  nav: boolean;
}

export const MODULE_REGISTRY: readonly ModuleDefinition[] = [
  {
    code: 'portal',
    title: '门户首页',
    path: '/',
    pathPrefixes: ['', 'portal'],
    icon: 'search',
    requires: [],
    enabledByDefault: true,
    nav: false,
  },
  {
    code: 'upstream',
    title: '上游卸数',
    path: '/upstream',
    pathPrefixes: ['upstream'],
    icon: 'download',
    requires: [],
    enabledByDefault: true,
    nav: true,
  },
  {
    code: 'dwm',
    title: '数据仓库',
    path: '/data-warehouse',
    pathPrefixes: ['data-warehouse'],
    icon: 'db',
    requires: [],
    enabledByDefault: true,
    nav: true,
  },
  {
    code: 'mapping',
    title: '字段映射',
    path: '/field-mapping',
    pathPrefixes: ['field-mapping'],
    icon: 'link',
    requires: [],
    enabledByDefault: true,
    nav: true,
  },
  {
    code: 'lineage',
    title: '血缘分析',
    path: '/lineage',
    pathPrefixes: ['lineage'],
    icon: 'layers',
    requires: [],
    enabledByDefault: true,
    nav: true,
  },
  {
    code: 'root',
    title: '词根管理',
    path: '/root-management',
    pathPrefixes: ['root-management'],
    icon: 'book',
    requires: [],
    enabledByDefault: true,
    nav: true,
  },
  {
    code: 'indicator',
    title: '指标维护',
    path: '/indicator-maintenance',
    pathPrefixes: ['indicator-maintenance'],
    icon: 'hash',
    requires: [],
    enabledByDefault: true,
    nav: true,
  },
  {
    code: 'report',
    title: '报表资产',
    path: '/report-assets',
    pathPrefixes: ['report-assets'],
    icon: 'file',
    requires: [],
    enabledByDefault: true,
    nav: true,
  },
  {
    code: 'apiAsset',
    title: 'API 资产',
    path: '/api-assets',
    pathPrefixes: ['api-assets'],
    icon: 'api',
    requires: [],
    enabledByDefault: true,
    nav: true,
  },
  {
    code: 'push',
    title: '下游推送',
    path: '/push',
    pathPrefixes: ['push'],
    icon: 'upload',
    requires: [],
    enabledByDefault: true,
    nav: true,
  },
  {
    code: 'codeTable',
    title: '码值表维护',
    path: '/code-table-maintenance',
    pathPrefixes: ['code-table-maintenance'],
    icon: 'table',
    requires: [],
    enabledByDefault: true,
    nav: true,
  },
  {
    code: 'system',
    title: '系统管理',
    path: '/system-management',
    pathPrefixes: ['system-management'],
    icon: 'shield',
    requires: [],
    enabledByDefault: true,
    nav: true,
  },
] as const;

const BY_CODE: ReadonlyMap<string, ModuleDefinition> = new Map(
  MODULE_REGISTRY.map((item) => [item.code, item]),
);

const PATH_OWNERS: ReadonlyMap<string, string> = (() => {
  const owners = new Map<string, string>();
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

export function listModuleCodes(): string[] {
  return MODULE_REGISTRY.map((item) => item.code);
}

export function getModuleDefinition(code: string): ModuleDefinition | null {
  return BY_CODE.get(code) || null;
}

export function getModuleByPathPrefix(topSegment?: string | null): ModuleDefinition | null {
  const key = String(topSegment || '').trim();
  if (!key || key === 'portal') return BY_CODE.get('portal') || null;
  const code = PATH_OWNERS.get(key);
  return code ? BY_CODE.get(code) || null : null;
}

/**
 * Return the source-backed module codes for mock mode and offline fallbacks.
 * There is no frontend module allowlist; every registered module is open.
 */
export function resolveRepositoryModuleCodes(): Set<string> {
  return new Set(listModuleCodes());
}

/** Compatibility alias retained for callers using the old enablement name. */
export function resolveDefaultEnabledModules(): Set<string> {
  return resolveRepositoryModuleCodes();
}

export function isRegisteredModule(code: string): boolean {
  return BY_CODE.has(code);
}

/** Compatibility alias; this checks registry identity, not a mutable gate. */
export function isModuleEnabled(code: string): boolean {
  return isRegisteredModule(code);
}

export function validateModuleRegistry(): boolean {
  const codes = new Set<string>();
  for (const item of MODULE_REGISTRY) {
    if (!item.code) throw new Error('module registry entry missing code');
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
