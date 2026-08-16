import type { NormalizedLineageGraph } from "../graph/index.js";
import type {
  LineageFieldLocation,
  LineageSearchOptions,
  LineageSearchResult,
} from "../public-api/search.js";

export function normalizeSearchOptions(
  queryOrOptions: string | LineageSearchOptions,
  filter: LineageSearchOptions = {},
): LineageSearchOptions | null {
  const values =
    typeof queryOrOptions === "string"
      ? { ...filter, query: queryOrOptions }
      : queryOrOptions !== null && typeof queryOrOptions === "object"
        ? queryOrOptions
        : {};
  const query = normalizeTerm(values.query);
  const dataType = normalizeTerm(values.dataType);
  if (query === undefined && dataType === undefined) return null;
  return {
    ...(query === undefined ? {} : { query }),
    ...(dataType === undefined ? {} : { dataType }),
  };
}

export function searchLineageGraph(
  graph: NormalizedLineageGraph | null,
  options: LineageSearchOptions | null,
): readonly LineageSearchResult[] {
  if (graph === null || options === null) return [];
  const query = options.query?.toLocaleLowerCase();
  const dataType = options.dataType?.toLocaleLowerCase();
  const results: LineageSearchResult[] = [];
  for (const node of graph.nodes) {
    if (dataType === undefined && query !== undefined && matchesName(node.id, node.label, query))
      results.push({ kind: "table", nodeId: node.id });
    for (const field of node.fields ?? []) {
      const nameMatches =
        query === undefined || matchesName(field.id, field.label ?? field.id, query);
      const typeMatches =
        dataType === undefined || field.dataType?.toLocaleLowerCase() === dataType;
      if (nameMatches && typeMatches)
        results.push({ kind: "field", nodeId: node.id, fieldId: field.id });
    }
  }
  return results;
}

export function searchFields(
  graph: NormalizedLineageGraph | null,
  keyword: string,
): readonly LineageFieldLocation[] {
  if (graph === null) return [];
  const query = normalizeTerm(keyword)?.toLocaleLowerCase();
  if (query === undefined) return [];
  const results: LineageFieldLocation[] = [];
  for (const node of graph.nodes) {
    const tableMatches = matchesName(node.id, node.label, query);
    for (const field of node.fields ?? []) {
      const label = field.label ?? field.id;
      if (
        tableMatches ||
        matchesName(field.id, label, query) ||
        field.dataType?.toLocaleLowerCase().includes(query)
      )
        results.push({ nodeId: node.id, fieldId: field.id, label });
    }
  }
  return results;
}

function normalizeTerm(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized === "" ? undefined : normalized;
}

function matchesName(id: string, label: string, query: string): boolean {
  return id.toLocaleLowerCase().includes(query) || label.toLocaleLowerCase().includes(query);
}
