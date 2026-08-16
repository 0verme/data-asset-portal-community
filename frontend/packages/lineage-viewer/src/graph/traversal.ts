import type { NormalizedLineageGraph } from "./types.js";

export function getUpstreamNodeIds(
  graph: NormalizedLineageGraph,
  nodeId: string,
): readonly string[] {
  return traverse(graph, nodeId, "incomingByNodeId", "source");
}

export function getDownstreamNodeIds(
  graph: NormalizedLineageGraph,
  nodeId: string,
): readonly string[] {
  return traverse(graph, nodeId, "outgoingByNodeId", "target");
}

export function getConnectedNodeIds(
  graph: NormalizedLineageGraph,
  nodeId: string,
): readonly string[] {
  return [
    ...new Set([...getUpstreamNodeIds(graph, nodeId), ...getDownstreamNodeIds(graph, nodeId)]),
  ].sort((left, right) => left.localeCompare(right));
}

function traverse(
  graph: NormalizedLineageGraph,
  startNodeId: string,
  indexName: "incomingByNodeId" | "outgoingByNodeId",
  adjacentField: "source" | "target",
): readonly string[] {
  if (!graph.nodeById.has(startNodeId)) return [];
  const visited = new Set<string>([startNodeId]);
  const pending = [startNodeId];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) continue;
    const edges = graph[indexName].get(current) ?? [];
    for (const edge of edges) {
      const adjacent = edge[adjacentField];
      if (!visited.has(adjacent)) {
        visited.add(adjacent);
        pending.push(adjacent);
      }
    }
  }
  visited.delete(startNodeId);
  return [...visited].sort((left, right) => left.localeCompare(right));
}
