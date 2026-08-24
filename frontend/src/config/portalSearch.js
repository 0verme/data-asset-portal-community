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

/** Scope chips shown on the portal homepage (order preserved). */
export const PORTAL_SCOPE_CONFIGS = [
  { key: "all", label: "全部" },
  { key: "system", label: "系统", moduleKey: "upstream" },
  { key: "field", label: "字段", moduleKey: "mapping" },
  { key: "root", label: "词根", moduleKey: "root" },
  { key: "indicator", label: "指标", moduleKey: "indicator" },
  { key: "report", label: "报表", moduleKey: "report" },
  { key: "api", label: "API", moduleKey: "apiAsset" },
  { key: "downstream", label: "下游推送", moduleKey: "push" },
  { key: "codeTable", label: "码值表", moduleKey: "codeTable" },
];

export const PORTAL_HOT_TAGS = [
  { q: "订单" },
  { q: "商品" },
  { q: "会员" },
  { q: "门店" },
  { q: "库存" },
  { q: "销售额", moduleKeys: ["indicator", "report"] },
  { q: "DWS_TRADE_SALES_STAT_1D", mono: true, moduleKeys: ["dwm"] },
  { q: "JOB_BI_01", mono: true, moduleKeys: ["push"] },
];

/** Search entity type → repository module code used by menu filtering. */
export const SEARCH_SCOPE_TO_MODULE = {
  asset: "dwm",
  system: "upstream",
  field: "mapping",
  root: "root",
  indicator: "indicator",
  report: "report",
  api: "apiAsset",
  downstream: "push",
  codeTable: "codeTable",
};

export function filterPortalScopesByModules(moduleKeys = []) {
  const enabledModules = new Set(moduleKeys);
  return PORTAL_SCOPE_CONFIGS.filter((item) => !item.moduleKey || enabledModules.has(item.moduleKey));
}

export function filterPortalHotTagsByModules(moduleKeys = []) {
  const enabledModules = new Set(moduleKeys);
  return PORTAL_HOT_TAGS.filter((item) => {
    if (!Array.isArray(item.moduleKeys) || item.moduleKeys.length === 0) return true;
    return item.moduleKeys.some((moduleKey) => enabledModules.has(moduleKey));
  });
}
