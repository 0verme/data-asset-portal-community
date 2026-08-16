import { toViewerGraph as adaptDomainGraph } from "@lineage-viewer/domain-adapter";

export function toViewerGraph(graph) {
  return adaptDomainGraph(graph, {
    nodeTypes: (node) => node.kind === "task"
      ? "job"
      : node.kind === "push_job"
        ? "dataset"
        : "table",
    edgeTypes: (edge) => edge.kind === "push_delivery" ? "dependency" : "lineage",
    maxLabelLength: 24,
    maxSubtitleLength: 24,
  });
}
