import type { NormalizedLineageGraph } from "./types.js";
export declare function getUpstreamNodeIds(graph: NormalizedLineageGraph, nodeId: string): readonly string[];
export declare function getDownstreamNodeIds(graph: NormalizedLineageGraph, nodeId: string): readonly string[];
export declare function getConnectedNodeIds(graph: NormalizedLineageGraph, nodeId: string): readonly string[];
//# sourceMappingURL=traversal.d.ts.map