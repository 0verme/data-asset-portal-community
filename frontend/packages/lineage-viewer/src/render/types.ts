import type { NormalizedLineageEdge, NormalizedLineageNode } from "../graph/types.js";

export interface RenderNode {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly node: NormalizedLineageNode;
  readonly rank?: number;
  readonly componentKey?: string;
}
export interface RenderEdge {
  readonly key: string;
  readonly path: string;
  readonly labelX: number;
  readonly labelY: number;
  readonly edge: NormalizedLineageEdge;
}
export interface RenderScene {
  readonly width: number;
  readonly height: number;
  readonly nodes: readonly RenderNode[];
  readonly edges: readonly RenderEdge[];
}
