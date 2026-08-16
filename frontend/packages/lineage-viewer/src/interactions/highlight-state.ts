import {
  getConnectedNodeIds,
  getDownstreamNodeIds,
  getUpstreamNodeIds,
  type NormalizedLineageGraph,
} from "../graph/index.js";
import { fieldReferenceKey, traverseFieldLineage, type FieldReference } from "./field-traversal.js";

export interface InteractionState {
  readonly selectedNodeId: string | null;
  readonly selectedFieldKey: string | null;
  readonly highlightedNodeIds: ReadonlySet<string>;
  readonly dimmedNodeIds: ReadonlySet<string>;
  readonly highlightedFieldKeys: ReadonlySet<string>;
  readonly dimmedFieldKeys: ReadonlySet<string>;
  readonly highlightedEdgeKeys: ReadonlySet<string>;
  readonly dimmedEdgeKeys: ReadonlySet<string>;
}

export function calculateInteractionState(
  graph: NormalizedLineageGraph | null,
  selectedNodeId: string | null,
  mode: "connected" | "both" | "upstream" | "downstream" | "none",
  selectedField: FieldReference | null = null,
): InteractionState {
  if (graph !== null && selectedField !== null)
    return calculateFieldInteractionState(graph, selectedField, mode);
  if (graph === null || selectedNodeId === null || !graph.nodeById.has(selectedNodeId))
    return emptyState();
  if (mode === "none") return { ...emptyState(), selectedNodeId };
  const related =
    mode === "upstream"
      ? getUpstreamNodeIds(graph, selectedNodeId)
      : mode === "downstream"
        ? getDownstreamNodeIds(graph, selectedNodeId)
        : getConnectedNodeIds(graph, selectedNodeId);
  const active = new Set([selectedNodeId, ...related]);
  const highlightedNodeIds = new Set(related);
  const highlightedEdgeKeys = new Set(
    graph.edges
      .filter((edge) => active.has(edge.source) && active.has(edge.target))
      .map((edge) => edge.key),
  );
  return {
    selectedNodeId,
    selectedFieldKey: null,
    highlightedNodeIds,
    dimmedNodeIds: new Set(graph.nodes.map((node) => node.id).filter((id) => !active.has(id))),
    highlightedFieldKeys: new Set(),
    dimmedFieldKeys: new Set(),
    highlightedEdgeKeys,
    dimmedEdgeKeys: new Set(
      graph.edges.filter((edge) => !highlightedEdgeKeys.has(edge.key)).map((edge) => edge.key),
    ),
  };
}

function calculateFieldInteractionState(
  graph: NormalizedLineageGraph,
  selectedField: FieldReference,
  mode: "connected" | "both" | "upstream" | "downstream" | "none",
): InteractionState {
  const selectedFieldKey = fieldReferenceKey(selectedField);
  const traversal =
    mode === "none"
      ? { fieldKeys: new Set([selectedFieldKey]), edgeKeys: new Set<string>() }
      : traverseFieldLineage(graph, selectedField, mode === "connected" ? "both" : mode);
  if (traversal.fieldKeys.size === 0) return emptyState();
  if (mode === "none") return { ...emptyState(), selectedFieldKey };

  const activeNodeIds = new Set<string>();
  const allFieldKeys = new Set<string>();
  for (const node of graph.nodes) {
    for (const field of node.fields ?? []) {
      const key = fieldReferenceKey({ nodeId: node.id, fieldId: field.id });
      allFieldKeys.add(key);
      if (traversal.fieldKeys.has(key)) activeNodeIds.add(node.id);
    }
  }
  return {
    selectedNodeId: null,
    selectedFieldKey,
    highlightedNodeIds: activeNodeIds,
    dimmedNodeIds: new Set(
      graph.nodes.map((node) => node.id).filter((id) => !activeNodeIds.has(id)),
    ),
    highlightedFieldKeys: new Set(
      [...traversal.fieldKeys].filter((key) => key !== selectedFieldKey),
    ),
    dimmedFieldKeys: new Set([...allFieldKeys].filter((key) => !traversal.fieldKeys.has(key))),
    highlightedEdgeKeys: traversal.edgeKeys,
    dimmedEdgeKeys: new Set(
      graph.edges.filter((edge) => !traversal.edgeKeys.has(edge.key)).map((edge) => edge.key),
    ),
  };
}

function emptyState(): InteractionState {
  return {
    selectedNodeId: null,
    selectedFieldKey: null,
    highlightedNodeIds: new Set(),
    dimmedNodeIds: new Set(),
    highlightedFieldKeys: new Set(),
    dimmedFieldKeys: new Set(),
    highlightedEdgeKeys: new Set(),
    dimmedEdgeKeys: new Set(),
  };
}
