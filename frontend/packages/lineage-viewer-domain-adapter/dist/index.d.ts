import type { LineageEdgeType, LineageField, LineageGraphData, LineageNode, LineageNodeType } from "lineage-viewer";
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
export type DomainNodeTypeMapping = Readonly<Record<string, LineageNodeType>> | ((node: DomainLineageNode) => LineageNodeType | undefined);
export type DomainEdgeTypeMapping = Readonly<Record<string, LineageEdgeType>> | ((edge: DomainLineageEdge) => LineageEdgeType | undefined);
export interface DomainGraphAdapterOptions {
    nodeTypes?: DomainNodeTypeMapping;
    edgeTypes?: DomainEdgeTypeMapping;
    nodeLabel?: (node: DomainLineageNode) => string;
    nodeSubtitle?: (node: DomainLineageNode) => string | undefined;
    edgeLabel?: (edge: DomainLineageEdge) => string | undefined;
    maxLabelLength?: number | null;
    maxSubtitleLength?: number | null;
}
export declare function toViewerGraph(graph: DomainLineageGraph, options?: DomainGraphAdapterOptions): LineageGraphData;
export declare function getRootNeighborhoodNodeIds(graph: Pick<DomainLineageGraph, "rootId" | "edges"> | null | undefined): string[];
//# sourceMappingURL=index.d.ts.map