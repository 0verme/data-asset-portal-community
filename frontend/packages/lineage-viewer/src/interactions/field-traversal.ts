import type { NormalizedLineageEdge, NormalizedLineageGraph } from "../graph/index.js";

export interface FieldReference {
  readonly nodeId: string;
  readonly fieldId: string;
}

export type FieldTraversalMode = "both" | "upstream" | "downstream";

export interface FieldTraversalResult {
  readonly fieldKeys: ReadonlySet<string>;
  readonly edgeKeys: ReadonlySet<string>;
}

interface FieldTraversalIndex {
  readonly fieldKeys: ReadonlySet<string>;
  readonly incoming: ReadonlyMap<string, readonly NormalizedLineageEdge[]>;
  readonly outgoing: ReadonlyMap<string, readonly NormalizedLineageEdge[]>;
  readonly results: Map<string, FieldTraversalResult>;
}

const indexes = new WeakMap<NormalizedLineageGraph, FieldTraversalIndex>();

export function fieldReferenceKey(reference: FieldReference): string {
  return JSON.stringify([reference.nodeId, reference.fieldId]);
}

export function traverseFieldLineage(
  graph: NormalizedLineageGraph,
  start: FieldReference,
  mode: FieldTraversalMode,
): FieldTraversalResult {
  const startKey = fieldReferenceKey(start);
  const traversalIndex = getFieldTraversalIndex(graph);
  if (!traversalIndex.fieldKeys.has(startKey)) return emptyResult();
  const cacheKey = `${mode}\u0000${startKey}`;
  const cached = traversalIndex.results.get(cacheKey);
  if (cached !== undefined) return cached;

  const fieldKeys = new Set([startKey]);
  const edgeKeys = new Set<string>();
  const queue = [startKey];
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index]!;
    const candidates = [
      ...(mode === "downstream" ? [] : (traversalIndex.incoming.get(current) ?? [])),
      ...(mode === "upstream" ? [] : (traversalIndex.outgoing.get(current) ?? [])),
    ];
    for (const edge of candidates) {
      edgeKeys.add(edge.key);
      const sourceKey = fieldReferenceKey({
        nodeId: edge.source,
        fieldId: edge.sourceField!,
      });
      const targetKey = fieldReferenceKey({
        nodeId: edge.target,
        fieldId: edge.targetField!,
      });
      const next = sourceKey === current ? targetKey : sourceKey;
      if (fieldKeys.has(next)) continue;
      fieldKeys.add(next);
      queue.push(next);
    }
  }
  const result = { fieldKeys, edgeKeys };
  traversalIndex.results.set(cacheKey, result);
  return result;
}

function getFieldTraversalIndex(graph: NormalizedLineageGraph): FieldTraversalIndex {
  const cached = indexes.get(graph);
  if (cached !== undefined) return cached;
  const fieldKeys = new Set<string>();
  for (const node of graph.nodes)
    for (const field of node.fields ?? [])
      fieldKeys.add(fieldReferenceKey({ nodeId: node.id, fieldId: field.id }));
  const incoming = new Map<string, NormalizedLineageEdge[]>();
  const outgoing = new Map<string, NormalizedLineageEdge[]>();
  for (const edge of graph.edges) {
    if (edge.sourceField === undefined || edge.targetField === undefined) continue;
    append(outgoing, fieldReferenceKey({ nodeId: edge.source, fieldId: edge.sourceField }), edge);
    append(incoming, fieldReferenceKey({ nodeId: edge.target, fieldId: edge.targetField }), edge);
  }
  const created = { fieldKeys, incoming, outgoing, results: new Map() };
  indexes.set(graph, created);
  return created;
}

function append(
  index: Map<string, NormalizedLineageEdge[]>,
  key: string,
  edge: NormalizedLineageEdge,
): void {
  const edges = index.get(key);
  if (edges) edges.push(edge);
  else index.set(key, [edge]);
}

function emptyResult(): FieldTraversalResult {
  return { fieldKeys: new Set(), edgeKeys: new Set() };
}
