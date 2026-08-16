import type { NormalizedLineageEdge } from "./types.js";

export function detectCycleGroups(
  nodeIds: readonly string[],
  edges: readonly NormalizedLineageEdge[],
): readonly (readonly string[])[] {
  const forward = initializeNeighbors(nodeIds);
  const reverse = initializeNeighbors(nodeIds);
  const selfLoops = new Set<string>();
  for (const edge of edges) {
    forward.get(edge.source)?.push(edge.target);
    reverse.get(edge.target)?.push(edge.source);
    if (edge.source === edge.target) selfLoops.add(edge.source);
  }
  for (const neighbors of forward.values())
    neighbors.sort((left, right) => left.localeCompare(right));
  for (const neighbors of reverse.values())
    neighbors.sort((left, right) => left.localeCompare(right));

  const finishingOrder = finishOrder(
    [...nodeIds].sort((left, right) => left.localeCompare(right)),
    forward,
  );
  const visited = new Set<string>();
  const groups: string[][] = [];
  for (const nodeId of [...finishingOrder].reverse()) {
    if (visited.has(nodeId)) continue;
    const group = collectComponent(nodeId, reverse, visited).sort((left, right) =>
      left.localeCompare(right),
    );
    if (group.length > 1 || selfLoops.has(nodeId)) groups.push(group);
  }
  return groups.sort((left, right) => left.join("\u0000").localeCompare(right.join("\u0000")));
}

function initializeNeighbors(nodeIds: readonly string[]): Map<string, string[]> {
  return new Map(nodeIds.map((nodeId) => [nodeId, []]));
}

function finishOrder(
  nodeIds: readonly string[],
  graph: ReadonlyMap<string, readonly string[]>,
): string[] {
  const visited = new Set<string>();
  const finished: string[] = [];
  for (const start of nodeIds) {
    if (visited.has(start)) continue;
    visited.add(start);
    const stack: Array<{ readonly nodeId: string; nextIndex: number }> = [
      { nodeId: start, nextIndex: 0 },
    ];
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (frame === undefined) continue;
      const neighbors = graph.get(frame.nodeId) ?? [];
      if (frame.nextIndex < neighbors.length) {
        const next = neighbors[frame.nextIndex];
        frame.nextIndex += 1;
        if (next !== undefined && !visited.has(next)) {
          visited.add(next);
          stack.push({ nodeId: next, nextIndex: 0 });
        }
      } else {
        finished.push(frame.nodeId);
        stack.pop();
      }
    }
  }
  return finished;
}

function collectComponent(
  start: string,
  graph: ReadonlyMap<string, readonly string[]>,
  visited: Set<string>,
): string[] {
  const component: string[] = [];
  const pending = [start];
  visited.add(start);
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) continue;
    component.push(current);
    for (const next of graph.get(current) ?? []) {
      if (!visited.has(next)) {
        visited.add(next);
        pending.push(next);
      }
    }
  }
  return component;
}
