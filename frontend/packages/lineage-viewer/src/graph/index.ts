export { buildAdjacencyIndexes } from "./adjacency.js";
export { detectCycleGroups } from "./cycle-detection.js";
export { normalizeLineageGraphData } from "./normalize.js";
export type { NormalizeLineageGraphResult } from "./normalize.js";
export { getConnectedNodeIds, getDownstreamNodeIds, getUpstreamNodeIds } from "./traversal.js";
export type {
  NormalizeLineageGraphOptions,
  NormalizedLineageEdge,
  NormalizedLineageGraph,
  NormalizedLineageNode,
} from "./types.js";
