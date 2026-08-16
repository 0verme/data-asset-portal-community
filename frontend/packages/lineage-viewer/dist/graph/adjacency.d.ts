import type { NormalizedLineageEdge, NormalizedLineageNode } from "./types.js";
export interface AdjacencyIndexes {
    readonly nodeById: ReadonlyMap<string, NormalizedLineageNode>;
    readonly incomingByNodeId: ReadonlyMap<string, readonly NormalizedLineageEdge[]>;
    readonly outgoingByNodeId: ReadonlyMap<string, readonly NormalizedLineageEdge[]>;
}
export declare function buildAdjacencyIndexes(nodes: readonly NormalizedLineageNode[], edges: readonly NormalizedLineageEdge[]): AdjacencyIndexes;
//# sourceMappingURL=adjacency.d.ts.map