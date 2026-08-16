import type { NormalizedLineageGraph } from "../graph/types.js";
import type { ResolvedLineageViewerOptions } from "../public-api/options.js";

export interface PositionedLayoutNode {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rank: number;
  readonly componentKey: string;
}

export interface LayeredLayout {
  readonly nodes: readonly PositionedLayoutNode[];
  readonly width: number;
  readonly height: number;
}

export type LayoutInput = Pick<NormalizedLineageGraph, "nodes" | "edges" | "cycleGroups">;
export type LayoutOptions = Pick<
  ResolvedLineageViewerOptions,
  "direction" | "nodeWidth" | "nodeHeight" | "layerGap" | "nodeGap"
> & {
  readonly nodeHeightById?: ReadonlyMap<string, number>;
};
