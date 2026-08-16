export interface LineageGraphData {
  schemaVersion?: "1.0";
  nodes: LineageNode[];
  edges: LineageEdge[];
}

export interface LineageNode {
  id: string;
  label: string;
  type?: "table" | "view" | "field" | "job" | "dataset" | "custom";
  layer?: string;
  subtitle?: string;
  status?: "default" | "success" | "warning" | "error" | "muted";
  fields?: LineageField[];
  metadata?: Record<string, unknown>;
}

export interface LineageField {
  id: string;
  label?: string;
  dataType?: string;
  description?: string;
}

export interface LineageEdge {
  id?: string;
  source: string;
  target: string;
  sourceField?: string;
  targetField?: string;
  label?: string;
  type?: "lineage" | "dependency" | "reference" | "custom";
  transformType?: LineageTransformType;
  expression?: string;
  metadata?: Record<string, unknown>;
}

export type ValidationMode = "strict" | "lenient";

export type LineageTransformType = "passthrough" | "rename" | "transform" | "aggregate" | "unknown";
export type LineageNodeType = NonNullable<LineageNode["type"]>;
export type LineageNodeStatus = NonNullable<LineageNode["status"]>;
export type LineageEdgeType = NonNullable<LineageEdge["type"]>;
