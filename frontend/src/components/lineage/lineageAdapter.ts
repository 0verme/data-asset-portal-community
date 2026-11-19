import {
  toViewerGraph as adaptDomainGraph,
  type DomainLineageGraph,
} from "@lineage-viewer/domain-adapter";

import { describeLineageNode } from "./lineageNodePresentation.ts";

export function toViewerGraph(
  graph: DomainLineageGraph,
): ReturnType<typeof adaptDomainGraph> {
  return adaptDomainGraph(graph, {
    nodeTypes: ({ kind }) => {
      switch (kind) {
        case "table": return "table";
        case "task": return "job";
        case "push_job": return "dataset";
        default: return undefined;
      }
    },
    nodeLabel: (node) => describeLineageNode(node).title,
    nodeSubtitle: (node) => describeLineageNode(node).subtitle,
    edgeTypes: (edge) =>
      edge.kind === "push_delivery" ? "dependency" : "lineage",
    maxLabelLength: 24,
    maxSubtitleLength: 24,
  });
}
