export const DEFAULT_FILTERS = {
  sourceSystemId: "",
  srcTable: "",
  srcField: "",
  emptyComment: "",
  targetTable: "",
  targetField: "",
};

export const DIMENSION_TABS = [
  { key: "table", label: "表维度" },
  { key: "field", label: "字段维度" },
];

export const RULE_TAGS = {
  直接映射: "tag-info",
  日期格式化: "tag-neutral",
  字典翻译: "tag-neutral",
  脱敏: "tag-neutral",
  "脱敏(MD5)": "tag-neutral",
  待补充: "tag-warn",
};

export const LOAD_MODE_META = {
  full: { label: "全量", tone: "tag-neutral" },
  incr: { label: "增量", tone: "tag-ok" },
  incr_zip: { label: "增量拉链", tone: "tag-info" },
  full_zip: { label: "全量拉链", tone: "tag-warn" },
};

const DIRECT_RULES = new Set(["直接映射"]);
const TRANSFORM_RULES = new Set(["日期格式化", "字典翻译", "脱敏", "脱敏(MD5)"]);

export function isTransformRule(rule) {
  if (DIRECT_RULES.has(rule)) return false;
  return TRANSFORM_RULES.has(rule);
}

export function compareValues(left, right) {
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left || "").localeCompare(String(right || ""), "zh-CN");
}

export function downloadCsv(fileName, rows) {
  const csv = rows
    .map((row) => row.map((value) => {
      const text = String(value ?? "");
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
    }).join(","))
    .join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  window.setTimeout(() => {
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, 100);
}

function normalizeValue(value) {
  return String(value || "").trim().toLowerCase();
}

export function getSourceSystemId(system) {
  if (!system || typeof system !== "object") return "";
  return system.sourceSystemId ?? system.id ?? system.upstreamSystemId ?? "";
}

export function getRouteSourceSystemId(route) {
  return route?.sourceSystemId || route?.upstreamSystemId || "";
}

export function formatSystemLabel(system, code) {
  const item = system && typeof system === "object" ? system : { name: system, systemCode: code };
  const name = String(item.name ?? item.systemName ?? item.srcSystem ?? "").trim();
  const systemCode = String(item.systemCode ?? item.abbr ?? item.systemAbbr ?? code ?? "").trim();
  if (name && systemCode) return `${name} · ${systemCode}`;
  return name || systemCode;
}

export function resolveSourceSystemLabel(route, sourceSystems) {
  const sourceSystemId = normalizeValue(getRouteSourceSystemId(route));
  const sourceSystemMatch = sourceSystems.find((item) => normalizeValue(getSourceSystemId(item)) === sourceSystemId);
  return sourceSystemMatch ? formatSystemLabel(sourceSystemMatch) : "";
}

// Kept as an additive compatibility export for existing callers. It now
// returns the same disambiguating label as the source-system selector.
export const resolveSourceSystemName = resolveSourceSystemLabel;

export function buildLinkedFilters(route, _sourceSystemLabel) {
  return {
    ...DEFAULT_FILTERS,
    sourceSystemId: getRouteSourceSystemId(route),
    srcTable: route.sourceTable || "",
    targetTable: route.dwfTable || "",
  };
}

export function areFieldMappingFiltersEqual(left, right) {
  return Object.keys(DEFAULT_FILTERS).every((key) => left?.[key] === right?.[key]);
}

export function buildFieldMappingRequestFilters(filters, route) {
  const { srcSystem: _legacySourceSystemName, ...rest } = filters || {};
  return {
    ...rest,
    sourceSystemId: getRouteSourceSystemId(route) || rest.sourceSystemId || "",
  };
}

export function isLinkedRoute(route) {
  return Boolean(getRouteSourceSystemId(route) || route.sourceTable || route.dwfTable);
}

export function sortMarker(sort, key) {
  if (sort.key !== key) return "";
  return sort.direction === "asc" ? " ↑" : " ↓";
}
