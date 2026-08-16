import type {
  LineageEdge,
  LineageEdgeType,
  LineageField,
  LineageGraphData,
  LineageNode,
  LineageNodeType,
} from "lineage-viewer";

export interface DomainLineageGraph {
  rootId?: string;
  nodes: readonly DomainLineageNode[];
  edges: readonly DomainLineageEdge[];
}

export interface DomainLineageNode {
  id: string;
  kind: string;
  name: string;
  displayName?: string;
  namespace?: string;
  status?: LineageNode["status"];
  attributes?: Record<string, unknown>;
  fields?: readonly LineageField[];
}

export interface DomainLineageEdge {
  id?: string;
  sourceId: string;
  targetId: string;
  kind: string;
  sourceField?: string;
  targetField?: string;
  evidence?: unknown;
  confidence?: unknown;
  attributes?: Record<string, unknown>;
}

export type DomainNodeTypeMapping =
  | Readonly<Record<string, LineageNodeType>>
  | ((node: DomainLineageNode) => LineageNodeType | undefined);

export type DomainEdgeTypeMapping =
  | Readonly<Record<string, LineageEdgeType>>
  | ((edge: DomainLineageEdge) => LineageEdgeType | undefined);

export interface DomainGraphAdapterOptions {
  nodeTypes?: DomainNodeTypeMapping;
  edgeTypes?: DomainEdgeTypeMapping;
  nodeLabel?: (node: DomainLineageNode) => string;
  nodeSubtitle?: (node: DomainLineageNode) => string | undefined;
  edgeLabel?: (edge: DomainLineageEdge) => string | undefined;
  maxLabelLength?: number | null;
  maxSubtitleLength?: number | null;
}

export function toViewerGraph(
  graph: DomainLineageGraph,
  options: DomainGraphAdapterOptions = {},
): LineageGraphData {
  assertDomainGraph(graph);
  const nodeLabel = options.nodeLabel ?? ((node: DomainLineageNode) => node.name);
  const nodeSubtitle = options.nodeSubtitle ?? ((node: DomainLineageNode) => node.displayName);
  const edgeLabel =
    options.edgeLabel ?? ((edge: DomainLineageEdge) => edge.kind.replaceAll("_", " "));
  const maxLabelLength = normalizeMaximum(options.maxLabelLength, 28);
  const maxSubtitleLength = normalizeMaximum(options.maxSubtitleLength, 28);

  return {
    schemaVersion: "1.0",
    nodes: graph.nodes.map((node) => {
      const fullLabel = String(nodeLabel(node));
      const fullSubtitle = nodeSubtitle(node);
      const type = resolveMapping(options.nodeTypes, node);
      return {
        id: node.id,
        label: shorten(fullLabel, maxLabelLength),
        ...(fullSubtitle === undefined
          ? {}
          : { subtitle: shorten(String(fullSubtitle), maxSubtitleLength) }),
        ...(type === undefined ? {} : { type }),
        ...(node.namespace === undefined ? {} : { layer: node.namespace }),
        ...(node.status === undefined ? {} : { status: node.status }),
        ...(node.fields === undefined
          ? {}
          : { fields: node.fields.map((field) => ({ ...field })) }),
        metadata: {
          kind: node.kind,
          fullLabel,
          ...(fullSubtitle === undefined ? {} : { fullSubtitle: String(fullSubtitle) }),
          ...(node.attributes === undefined ? {} : { attributes: node.attributes }),
        },
      };
    }),
    edges: graph.edges.map((edge) => {
      const type = resolveMapping(options.edgeTypes, edge);
      const label = edgeLabel(edge);
      const viewerEdge: LineageEdge = {
        ...(edge.id === undefined ? {} : { id: edge.id }),
        source: edge.sourceId,
        target: edge.targetId,
        ...(edge.sourceField === undefined ? {} : { sourceField: edge.sourceField }),
        ...(edge.targetField === undefined ? {} : { targetField: edge.targetField }),
        ...(label === undefined ? {} : { label }),
        ...(type === undefined ? {} : { type }),
        metadata: {
          kind: edge.kind,
          ...(edge.evidence === undefined ? {} : { evidence: edge.evidence }),
          ...(edge.confidence === undefined ? {} : { confidence: edge.confidence }),
          ...(edge.attributes === undefined ? {} : { attributes: edge.attributes }),
        },
      };
      return viewerEdge;
    }),
  };
}

export function getRootNeighborhoodNodeIds(
  graph: Pick<DomainLineageGraph, "rootId" | "edges"> | null | undefined,
): string[] {
  if (!graph?.rootId) return [];
  const nodeIds = new Set([graph.rootId]);
  for (const edge of graph.edges) {
    if (edge.sourceId === graph.rootId) nodeIds.add(edge.targetId);
    if (edge.targetId === graph.rootId) nodeIds.add(edge.sourceId);
  }
  return [...nodeIds];
}

function assertDomainGraph(graph: DomainLineageGraph): void {
  if (
    graph === null ||
    typeof graph !== "object" ||
    !Array.isArray(graph.nodes) ||
    !Array.isArray(graph.edges)
  ) {
    throw new TypeError("Domain lineage graph must contain nodes and edges arrays.");
  }
}

function normalizeMaximum(value: number | null | undefined, fallback: number): number | null {
  if (value === null) return null;
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 2) {
    throw new TypeError("Label length limits must be null or integers greater than one.");
  }
  return value;
}

function shorten(value: string, maximum: number | null): string {
  if (maximum === null || value.length <= maximum) return value;
  return `${value.slice(0, maximum - 1)}…`;
}

function resolveMapping<TItem, TValue extends string>(
  mapping: Readonly<Record<string, TValue>> | ((item: TItem) => TValue | undefined) | undefined,
  item: TItem & { kind: string },
): TValue | undefined {
  return typeof mapping === "function" ? mapping(item) : mapping?.[item.kind];
}
