import {
  toViewerGraph as adaptDomainGraph,
  type DomainLineageGraph,
} from "@lineage-viewer/domain-adapter";

import { describeLineageNode } from "./lineageNodePresentation.ts";

export function toViewerGraph(
  graph: DomainLineageGraph,
): ReturnType<typeof adaptDomainGraph> {
  return adaptDomainGraph(graph, {
    nodeTypes: { table: "table", task: "job", push_job: "dataset" },
    nodeLabel: (node) => describeLineageNode(node).title,
    nodeSubtitle: (node) => describeLineageNode(node).subtitle,
    edgeTypes: (edge) =>
      edge.kind === "push_delivery" ? "dependency" : "lineage",
    maxLabelLength: 24,
    maxSubtitleLength: 24,
  });
}
