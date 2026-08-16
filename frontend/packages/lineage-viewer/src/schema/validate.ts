import type { LineageDiagnostic } from "./diagnostics.js";
import type {
  LineageEdgeType,
  LineageNodeStatus,
  LineageNodeType,
  LineageTransformType,
} from "./types.js";

const nodeTypes: readonly LineageNodeType[] = [
  "table",
  "view",
  "field",
  "job",
  "dataset",
  "custom",
];
const nodeStatuses: readonly LineageNodeStatus[] = [
  "default",
  "success",
  "warning",
  "error",
  "muted",
];
const edgeTypes: readonly LineageEdgeType[] = ["lineage", "dependency", "reference", "custom"];
const transformTypes: readonly LineageTransformType[] = [
  "passthrough",
  "rename",
  "transform",
  "aggregate",
  "unknown",
];

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Reflect.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function isNodeType(value: unknown): value is LineageNodeType {
  return typeof value === "string" && nodeTypes.includes(value as LineageNodeType);
}

export function isNodeStatus(value: unknown): value is LineageNodeStatus {
  return typeof value === "string" && nodeStatuses.includes(value as LineageNodeStatus);
}

export function isEdgeType(value: unknown): value is LineageEdgeType {
  return typeof value === "string" && edgeTypes.includes(value as LineageEdgeType);
}

export function isTransformType(value: unknown): value is LineageTransformType {
  return typeof value === "string" && transformTypes.includes(value as LineageTransformType);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function validateLineageGraphData(input: unknown): readonly LineageDiagnostic[] {
  if (!isPlainRecord(input)) return [invalid("Input must be a plain object.")];
  if (input["schemaVersion"] !== undefined && input["schemaVersion"] !== "1.0") {
    return [invalid('schemaVersion must be "1.0" when provided.')];
  }
  if (!Array.isArray(input["nodes"])) return [invalid("nodes must be an array.")];
  if (!Array.isArray(input["edges"])) return [invalid("edges must be an array.")];
  return [];
}

export function invalid(message: string, nodeId?: string, edgeId?: string): LineageDiagnostic {
  return {
    level: "error",
    code: "INVALID_GRAPH_DATA",
    message,
    ...(nodeId === undefined ? {} : { nodeId }),
    ...(edgeId === undefined ? {} : { edgeId }),
  };
}
