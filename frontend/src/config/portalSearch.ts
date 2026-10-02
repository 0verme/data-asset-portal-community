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
 * Portal search scopes — pluggable list.
 * Each scoped entity maps to a repository module code (moduleKey), shared with
 * the capability compatibility payload and the menu/search provider contract.
 * Adding a searchable module: append here + mock entity in api/search.js +
 * backend providers registry; engines stay unchanged.
 */

export const DEFAULT_PORTAL_SCOPE = "all";

export interface PortalScopeConfig {
 key: string;
 label: string;
 moduleKey?: string;
}

/** Scope chips shown on the portal homepage (order preserved). */
export const PORTAL_SCOPE_CONFIGS: readonly PortalScopeConfig[] = [
 { key: "all", label: "全部" },
 { key: "asset", label: "资产", moduleKey: "dwm" },
 { key: "system", label: "系统", moduleKey: "upstream" },
 { key: "field", label: "字段", moduleKey: "mapping" },
 { key: "root", label: "词根", moduleKey: "root" },
 { key: "indicator", label: "指标", moduleKey: "indicator" },
 { key: "report", label: "报表", moduleKey: "report" },
 { key: "api", label: "API", moduleKey: "apiAsset" },
 { key: "downstream", label: "下游推送", moduleKey: "push" },
 { key: "codeTable", label: "码值表", moduleKey: "codeTable" },
] as const;

export interface PortalHotKeyword {
 id: number;
 keyword: string;
 category: string;
 sortOrder: number;
}

const HOT_KEYWORD_CATEGORY_TO_MODULE: Readonly<Record<string, string>> = {
 asset: "dwm",
 system: "upstream",
 field: "mapping",
 root: "root",
 metric: "indicator",
 report: "report",
 api: "apiAsset",
 lineage: "lineage",
 code_table: "codeTable",
};

/** Search entity type → repository module code used by menu filtering. */
export const SEARCH_SCOPE_TO_MODULE: Record<string, string> = {
 asset: "dwm",
 system: "upstream",
 field: "mapping",
 root: "root",
 indicator: "indicator",
 report: "report",
 api: "apiAsset",
 downstream: "push",
 codeTable: "codeTable",
} as const;

export function filterPortalScopesByModules(
 moduleKeys: readonly string[] = [],
): PortalScopeConfig[] {
 const enabledModules = new Set(moduleKeys);
 return PORTAL_SCOPE_CONFIGS.filter(
  (item) => !item.moduleKey || enabledModules.has(item.moduleKey),
 );
}

export function filterPortalHotKeywordsByModules(
 items: readonly PortalHotKeyword[],
 moduleKeys: readonly string[] = [],
): PortalHotKeyword[] {
 const enabledModules = new Set(moduleKeys);
 const seenKeywords = new Set<string>();
 return items.filter((item) => {
  const requiredModule = HOT_KEYWORD_CATEGORY_TO_MODULE[item.category];
  if (requiredModule && !enabledModules.has(requiredModule)) return false;
  const keyword = item.keyword.trim();
  if (!keyword || seenKeywords.has(keyword)) return false;
  seenKeywords.add(keyword);
  return true;
 });
}

export function isMonospaceHotKeyword(keyword: string): boolean {
 return /[A-Z]{2}/.test(keyword) && /[_/.$-]/.test(keyword);
}

export interface PortalSearchParams {
 query: string;
 scope: string;
}

/**
 * Parse `?q=` / `?scope=` for the portal. The scope whitelist is the visible
 * scope chips, so a shared or refreshed `?scope=asset` URL keeps the asset
 * scope instead of being reset to `all`.
 */
export function readPortalSearchParams(
 validScopeKeys: ReadonlySet<string>,
 search: string = typeof window === "undefined"
  ? ""
  : window.location.search || "",
): PortalSearchParams {
 const searchParams = new URLSearchParams(search || "");
 const nextScope = searchParams.get("scope");

 return {
  query: searchParams.get("q") || "",
  scope:
   nextScope && validScopeKeys.has(nextScope) ? nextScope : DEFAULT_PORTAL_SCOPE,
 };
}
