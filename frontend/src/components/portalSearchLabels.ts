import type { PortalScopeConfig } from "../config/portalSearch.ts";
import type { SearchResultGroup } from "../api/search.ts";

export type PortalSearchTranslationKey =
  | "scopes.all"
  | "scopes.asset"
  | "scopes.system"
  | "scopes.field"
  | "scopes.root"
  | "scopes.indicator"
  | "scopes.report"
  | "scopes.api"
  | "scopes.downstream"
  | "scopes.codeTable"
  | "groups.asset"
  | "groups.system"
  | "groups.field"
  | "groups.root"
  | "groups.indicator"
  | "groups.downstream"
  | "groups.report"
  | "groups.api"
  | "groups.codeTable"
  | "stats.sourceSystems"
  | "stats.sourceTables"
  | "stats.fields"
  | "stats.indicators"
  | "stats.downstreamSystems"
  | "stats.downstreamDeliveries"
  | "stats.subjectAreas"
  | "stats.subjectTables"
  | "stats.reports"
  | "stats.apis"
  | "stats.roots";

type LabelEntry = { source: string; key: PortalSearchTranslationKey };

const SCOPE_LABELS: Readonly<Record<string, LabelEntry>> = {
  all: { source: "全部", key: "scopes.all" },
  asset: { source: "资产", key: "scopes.asset" },
  system: { source: "系统", key: "scopes.system" },
  field: { source: "字段", key: "scopes.field" },
  root: { source: "词根", key: "scopes.root" },
  indicator: { source: "指标", key: "scopes.indicator" },
  report: { source: "报表", key: "scopes.report" },
  api: { source: "API", key: "scopes.api" },
  downstream: { source: "下游推送", key: "scopes.downstream" },
  codeTable: { source: "码值表", key: "scopes.codeTable" },
};

const GROUP_LABELS: Readonly<Record<string, LabelEntry>> = {
  asset: { source: "资产", key: "groups.asset" },
  system: { source: "系统", key: "groups.system" },
  field: { source: "字段", key: "groups.field" },
  root: { source: "词根", key: "groups.root" },
  indicator: { source: "指标", key: "groups.indicator" },
  downstream: { source: "下游推送", key: "groups.downstream" },
  report: { source: "报表", key: "groups.report" },
  api: { source: "API", key: "groups.api" },
  codeTable: { source: "码值表", key: "groups.codeTable" },
};

const STAT_LABELS: Readonly<Record<string, PortalSearchTranslationKey>> = {
  源系统: "stats.sourceSystems",
  源表: "stats.sourceTables",
  字段: "stats.fields",
  指标: "stats.indicators",
  下游系统: "stats.downstreamSystems",
  下游推送: "stats.downstreamDeliveries",
  主题域: "stats.subjectAreas",
  主题表: "stats.subjectTables",
  报表: "stats.reports",
  API: "stats.apis",
  词根: "stats.roots",
};

export function resolvePortalScopeLabel(
  scope: Pick<PortalScopeConfig, "key" | "label">,
  translate: (key: PortalSearchTranslationKey) => string,
): string {
  const entry = SCOPE_LABELS[scope.key];
  return entry?.source === scope.label ? translate(entry.key) : scope.label;
}

export function resolveSearchGroupLabel(
  group: Pick<SearchResultGroup, "type" | "label">,
  translate: (key: PortalSearchTranslationKey) => string,
): string {
  const entry = GROUP_LABELS[group.type];
  return entry?.source === group.label ? translate(entry.key) : group.label;
}

export function resolvePortalStatLabel(
  label: string,
  translate: (key: PortalSearchTranslationKey) => string,
): string {
  const key = STAT_LABELS[label];
  return key ? translate(key) : label;
}
