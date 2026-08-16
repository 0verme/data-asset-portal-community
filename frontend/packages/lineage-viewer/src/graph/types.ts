import type { LineageEdge, LineageNode, ValidationMode } from "../schema/types.js";

export interface NormalizeLineageGraphOptions {
  validationMode?: ValidationMode;
  showSelfLoops?: boolean;
}

export interface NormalizedLineageNode extends LineageNode {
  readonly id: string;
  readonly label: string;
}

export interface NormalizedLineageEdge extends LineageEdge {
  readonly key: string;
  readonly source: string;
  readonly target: string;
  readonly type: "lineage" | "dependency" | "reference" | "custom";
  readonly label: string;
}

export interface NormalizedLineageGraph {
  readonly schemaVersion: "1.0";
  readonly nodes: readonly NormalizedLineageNode[];
  readonly edges: readonly NormalizedLineageEdge[];
  readonly nodeById: ReadonlyMap<string, NormalizedLineageNode>;
  readonly incomingByNodeId: ReadonlyMap<string, readonly NormalizedLineageEdge[]>;
  readonly outgoingByNodeId: ReadonlyMap<string, readonly NormalizedLineageEdge[]>;
  readonly cycleGroups: readonly (readonly string[])[];
}
