import type { NormalizedLineageGraph } from "../graph/index.js";
import { fieldReferenceKey } from "../interactions/index.js";
import type { LineageSearchResult } from "../public-api/search.js";

export interface SearchState {
  readonly matchedNodeIds: ReadonlySet<string>;
  readonly dimmedNodeIds: ReadonlySet<string>;
  readonly matchedFieldKeys: ReadonlySet<string>;
  readonly dimmedFieldKeys: ReadonlySet<string>;
  readonly dimmedEdgeKeys: ReadonlySet<string>;
}

export function calculateSearchState(
  sourceGraph: NormalizedLineageGraph | null,
  viewGraph: NormalizedLineageGraph | null,
  results: readonly LineageSearchResult[],
  active: boolean,
): SearchState {
  if (sourceGraph === null || viewGraph === null || !active) return emptySearchState();
  const matchedNodeIds = new Set(results.map((result) => result.nodeId));
  const matchedFieldKeys = new Set(
    results.filter((result) => result.kind === "field").map((result) => fieldReferenceKey(result)),
  );
  const dimmedFieldKeys =
    results.length > 0 && matchedFieldKeys.size === 0
      ? new Set<string>()
      : new Set(
          sourceGraph.nodes.flatMap((node) =>
            (node.fields ?? [])
              .map((field) => fieldReferenceKey({ nodeId: node.id, fieldId: field.id }))
              .filter((key) => !matchedFieldKeys.has(key)),
          ),
        );
  return {
    matchedNodeIds,
    dimmedNodeIds: new Set(
      viewGraph.nodes.map((node) => node.id).filter((id) => !matchedNodeIds.has(id)),
    ),
    matchedFieldKeys,
    dimmedFieldKeys,
    dimmedEdgeKeys: new Set(
      viewGraph.edges
        .filter((edge) => !matchedNodeIds.has(edge.source) || !matchedNodeIds.has(edge.target))
        .map((edge) => edge.key),
    ),
  };
}

export function emptySearchState(): SearchState {
  return {
    matchedNodeIds: new Set(),
    dimmedNodeIds: new Set(),
    matchedFieldKeys: new Set(),
    dimmedFieldKeys: new Set(),
    dimmedEdgeKeys: new Set(),
  };
}
