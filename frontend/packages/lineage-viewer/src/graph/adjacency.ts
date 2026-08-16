import type { NormalizedLineageEdge, NormalizedLineageNode } from "./types.js";

export interface AdjacencyIndexes {
  readonly nodeById: ReadonlyMap<string, NormalizedLineageNode>;
  readonly incomingByNodeId: ReadonlyMap<string, readonly NormalizedLineageEdge[]>;
  readonly outgoingByNodeId: ReadonlyMap<string, readonly NormalizedLineageEdge[]>;
}

export function buildAdjacencyIndexes(
  nodes: readonly NormalizedLineageNode[],
  edges: readonly NormalizedLineageEdge[],
): AdjacencyIndexes {
  const nodeById = new Map<string, NormalizedLineageNode>();
  const incoming = new Map<string, NormalizedLineageEdge[]>();
  const outgoing = new Map<string, NormalizedLineageEdge[]>();

  for (const node of nodes) {
    nodeById.set(node.id, node);
    incoming.set(node.id, []);
    outgoing.set(node.id, []);
  }
  for (const edge of edges) {
    incoming.get(edge.target)?.push(edge);
    outgoing.get(edge.source)?.push(edge);
  }
  return { nodeById, incomingByNodeId: incoming, outgoingByNodeId: outgoing };
}
