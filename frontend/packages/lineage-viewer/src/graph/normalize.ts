import { buildAdjacencyIndexes } from "./adjacency.js";
import { detectCycleGroups } from "./cycle-detection.js";
import type {
  NormalizeLineageGraphOptions,
  NormalizedLineageEdge,
  NormalizedLineageGraph,
  NormalizedLineageNode,
} from "./types.js";
import { sortDiagnostics, type LineageDiagnostic } from "../schema/diagnostics.js";
import type { LineageEdgeType, LineageField, LineageTransformType } from "../schema/types.js";
import {
  invalid,
  isEdgeType,
  isNodeStatus,
  isNodeType,
  isNonEmptyString,
  isPlainRecord,
  isTransformType,
  validateLineageGraphData,
} from "../schema/validate.js";

export interface NormalizeLineageGraphResult {
  readonly graph: NormalizedLineageGraph | null;
  readonly diagnostics: readonly LineageDiagnostic[];
  readonly hasErrors: boolean;
}

export function normalizeLineageGraphData(
  input: unknown,
  options: NormalizeLineageGraphOptions = {},
): NormalizeLineageGraphResult {
  const rootDiagnostics = validateLineageGraphData(input);
  if (
    rootDiagnostics.length > 0 ||
    !isPlainRecord(input) ||
    !Array.isArray(input["nodes"]) ||
    !Array.isArray(input["edges"])
  ) {
    return result(null, rootDiagnostics);
  }
  const diagnostics: LineageDiagnostic[] = [];
  const nodeById = new Map<string, NormalizedLineageNode>();
  for (const candidate of input["nodes"]) {
    const node = normalizeNode(candidate, diagnostics);
    if (node === null) continue;
    if (nodeById.has(node.id)) {
      diagnostics.push({
        level: "error",
        code: "DUPLICATE_NODE_ID",
        nodeId: node.id,
        message: `Duplicate node id "${node.id}"; first valid occurrence wins.`,
      });
      continue;
    }
    nodeById.set(node.id, node);
  }

  const edgesByKey = new Map<string, NormalizedLineageEdge>();
  for (const candidate of input["edges"]) {
    const edge = normalizeEdge(candidate, nodeById, diagnostics);
    if (edge === null) continue;
    if (edge.source === edge.target && options.showSelfLoops !== true) {
      diagnostics.push({
        level: "warning",
        code: "SELF_LOOP_HIDDEN",
        message: `Self-loop at "${edge.source}" was hidden.`,
        ...(edge.id === undefined ? {} : { edgeId: edge.id }),
      });
      continue;
    }
    if (edgesByKey.has(edge.key)) {
      diagnostics.push({
        level: "warning",
        code: "DUPLICATE_EDGE",
        message: `Duplicate edge "${edge.key}" was removed; first valid occurrence wins.`,
        ...(edge.id === undefined ? {} : { edgeId: edge.id }),
      });
      continue;
    }
    edgesByKey.set(edge.key, edge);
  }

  const nodes = [...nodeById.values()].sort(compareNodes);
  const edges = [...edgesByKey.values()].sort(compareEdges);
  if (nodes.length === 0)
    diagnostics.push({
      level: "info",
      code: "EMPTY_GRAPH",
      message: "The graph contains no valid nodes.",
    });
  const indexes = buildAdjacencyIndexes(nodes, edges);
  const cycleGroups = detectCycleGroups(
    nodes.map((node) => node.id),
    edges,
  );
  for (const group of cycleGroups) {
    diagnostics.push({
      level: "warning",
      code: "CYCLE_DETECTED",
      nodeId: group[0] ?? "",
      message: `Cycle detected: ${group.join(", ")}.`,
    });
  }
  const graph: NormalizedLineageGraph = {
    schemaVersion: "1.0",
    nodes,
    edges,
    ...indexes,
    cycleGroups,
  };
  const orderedDiagnostics = sortDiagnostics(diagnostics);
  return orderedDiagnostics.some((diagnostic) => diagnostic.level === "error") &&
    options.validationMode === "strict"
    ? result(null, orderedDiagnostics)
    : result(graph, orderedDiagnostics);
}

function result(
  graph: NormalizedLineageGraph | null,
  diagnostics: readonly LineageDiagnostic[],
): NormalizeLineageGraphResult {
  const orderedDiagnostics = sortDiagnostics(diagnostics);
  return {
    graph,
    diagnostics: orderedDiagnostics,
    hasErrors: orderedDiagnostics.some((diagnostic) => diagnostic.level === "error"),
  };
}

function normalizeNode(
  candidate: unknown,
  diagnostics: LineageDiagnostic[],
): NormalizedLineageNode | null {
  if (!isPlainRecord(candidate)) {
    diagnostics.push(invalid("A node must be a plain object."));
    return null;
  }
  const id = normalizeString(candidate["id"]);
  const label = normalizeString(candidate["label"]);
  if (
    id === null ||
    label === null ||
    (candidate["type"] !== undefined && !isNodeType(candidate["type"])) ||
    (candidate["status"] !== undefined && !isNodeStatus(candidate["status"])) ||
    (candidate["metadata"] !== undefined && !isPlainRecord(candidate["metadata"]))
  ) {
    diagnostics.push(invalid("A node has invalid required or typed fields.", id ?? undefined));
    return null;
  }
  const node: NormalizedLineageNode = { id, label };
  copyOptionalString(candidate, node, "layer");
  copyOptionalString(candidate, node, "subtitle");
  if (candidate["type"] !== undefined) node.type = candidate["type"];
  if (candidate["status"] !== undefined) node.status = candidate["status"];
  const fields = normalizeFields(candidate["fields"], id, diagnostics);
  if (fields !== undefined) node.fields = fields;
  if (candidate["metadata"] !== undefined) node.metadata = candidate["metadata"];
  return node;
}

function normalizeFields(
  candidate: unknown,
  nodeId: string,
  diagnostics: LineageDiagnostic[],
): LineageField[] | undefined {
  if (candidate === undefined) return undefined;
  if (!Array.isArray(candidate)) {
    diagnostics.push(invalid("Node fields must be an array when provided.", nodeId));
    return undefined;
  }
  const fields: LineageField[] = [];
  const fieldIds = new Set<string>();
  for (const value of candidate) {
    const field = normalizeField(value, nodeId, diagnostics);
    if (field === null) continue;
    if (fieldIds.has(field.id)) {
      diagnostics.push({
        level: "error",
        code: "DUPLICATE_FIELD_ID",
        nodeId,
        message: `Duplicate field id "${field.id}" on node "${nodeId}"; first valid occurrence wins.`,
      });
      continue;
    }
    fieldIds.add(field.id);
    fields.push(field);
  }
  return fields;
}

function normalizeField(
  candidate: unknown,
  nodeId: string,
  diagnostics: LineageDiagnostic[],
): LineageField | null {
  if (!isPlainRecord(candidate)) {
    diagnostics.push(invalid("A field must be a plain object.", nodeId));
    return null;
  }
  const id = normalizeString(candidate["id"]);
  if (
    id === null ||
    !isOptionalString(candidate["label"]) ||
    !isOptionalString(candidate["dataType"]) ||
    !isOptionalString(candidate["description"])
  ) {
    diagnostics.push(invalid("A field has invalid required or typed fields.", nodeId));
    return null;
  }
  return {
    id,
    ...(candidate["label"] === undefined ? {} : { label: candidate["label"] }),
    ...(candidate["dataType"] === undefined ? {} : { dataType: candidate["dataType"] }),
    ...(candidate["description"] === undefined ? {} : { description: candidate["description"] }),
  };
}

function normalizeEdge(
  candidate: unknown,
  nodeById: ReadonlyMap<string, NormalizedLineageNode>,
  diagnostics: LineageDiagnostic[],
): NormalizedLineageEdge | null {
  if (!isPlainRecord(candidate)) {
    diagnostics.push(invalid("An edge must be a plain object."));
    diagnostics.push({
      level: "error",
      code: "MISSING_EDGE_SOURCE",
      message: "Edge source is missing or invalid.",
    });
    diagnostics.push({
      level: "error",
      code: "MISSING_EDGE_TARGET",
      message: "Edge target is missing or invalid.",
    });
    return null;
  }
  const source = normalizeString(candidate["source"]);
  const target = normalizeString(candidate["target"]);
  const edgeId = normalizeOptionalId(candidate["id"]);
  const sourceFieldProvided = candidate["sourceField"] !== undefined;
  const targetFieldProvided = candidate["targetField"] !== undefined;
  const sourceField = normalizeOptionalId(candidate["sourceField"]);
  const targetField = normalizeOptionalId(candidate["targetField"]);
  const fieldReferencesPaired = sourceFieldProvided === targetFieldProvided;
  const hasInvalidField =
    edgeId === null ||
    (candidate["label"] !== undefined && typeof candidate["label"] !== "string") ||
    (candidate["type"] !== undefined && !isEdgeType(candidate["type"])) ||
    (candidate["transformType"] !== undefined && !isTransformType(candidate["transformType"])) ||
    (candidate["expression"] !== undefined && typeof candidate["expression"] !== "string") ||
    (candidate["metadata"] !== undefined && !isPlainRecord(candidate["metadata"]));
  if (edgeId === null)
    diagnostics.push(invalid("An edge id must be a non-empty string when provided."));
  if (hasInvalidField && edgeId !== null)
    diagnostics.push(invalid("An edge has invalid typed fields.", undefined, edgeId));
  if (!fieldReferencesPaired)
    diagnostics.push({
      level: "error",
      code: "UNPAIRED_FIELD_REFERENCE",
      message: "sourceField and targetField must either both be provided or both be omitted.",
      ...(typeof edgeId === "string" ? { edgeId } : {}),
    });
  const validSource = source !== null && nodeById.has(source);
  const validTarget = target !== null && nodeById.has(target);
  if (!validSource)
    diagnostics.push({
      level: "error",
      code: "MISSING_EDGE_SOURCE",
      message: "Edge source is missing, invalid, or does not reference a valid node.",
      ...(typeof edgeId === "string" ? { edgeId } : {}),
    });
  if (!validTarget)
    diagnostics.push({
      level: "error",
      code: "MISSING_EDGE_TARGET",
      message: "Edge target is missing, invalid, or does not reference a valid node.",
      ...(typeof edgeId === "string" ? { edgeId } : {}),
    });
  const validSourceField =
    !sourceFieldProvided ||
    (typeof sourceField === "string" &&
      validSource &&
      hasField(nodeById.get(source ?? ""), sourceField));
  const validTargetField =
    !targetFieldProvided ||
    (typeof targetField === "string" &&
      validTarget &&
      hasField(nodeById.get(target ?? ""), targetField));
  if (fieldReferencesPaired && sourceFieldProvided && !validSourceField)
    diagnostics.push({
      level: "error",
      code: "MISSING_SOURCE_FIELD",
      message: "Edge sourceField is missing, invalid, or does not reference its source node.",
      ...(typeof edgeId === "string" ? { edgeId } : {}),
    });
  if (fieldReferencesPaired && targetFieldProvided && !validTargetField)
    diagnostics.push({
      level: "error",
      code: "MISSING_TARGET_FIELD",
      message: "Edge targetField is missing, invalid, or does not reference its target node.",
      ...(typeof edgeId === "string" ? { edgeId } : {}),
    });
  if (
    source === null ||
    target === null ||
    hasInvalidField ||
    !validSource ||
    !validTarget ||
    !fieldReferencesPaired ||
    !validSourceField ||
    !validTargetField
  )
    return null;
  const type = (candidate["type"] ?? "lineage") as LineageEdgeType;
  const label = (candidate["label"] ?? "") as string;
  const normalizedSourceField = typeof sourceField === "string" ? sourceField : undefined;
  const normalizedTargetField = typeof targetField === "string" ? targetField : undefined;
  const edge: NormalizedLineageEdge = {
    source,
    target,
    type,
    label,
    key: edgeKey(source, target, type, label, normalizedSourceField, normalizedTargetField),
  };
  if (edgeId !== undefined) edge.id = edgeId;
  if (normalizedSourceField !== undefined && normalizedTargetField !== undefined) {
    edge.sourceField = normalizedSourceField;
    edge.targetField = normalizedTargetField;
  }
  if (candidate["transformType"] !== undefined)
    edge.transformType = candidate["transformType"] as LineageTransformType;
  if (candidate["expression"] !== undefined) edge.expression = candidate["expression"] as string;
  if (candidate["metadata"] !== undefined)
    edge.metadata = candidate["metadata"] as Record<string, unknown>;
  return edge;
}

function normalizeString(value: unknown): string | null {
  return isNonEmptyString(value) ? value.trim() : null;
}

function normalizeOptionalId(value: unknown): string | null | undefined {
  return value === undefined ? undefined : normalizeString(value);
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function hasField(node: NormalizedLineageNode | undefined, fieldId: string): boolean {
  return node?.fields?.some((field) => field.id === fieldId) ?? false;
}

function copyOptionalString(
  source: Record<string, unknown>,
  target: NormalizedLineageNode,
  key: "layer" | "subtitle",
): void {
  if (source[key] !== undefined && typeof source[key] === "string") target[key] = source[key];
}

function edgeKey(
  source: string,
  target: string,
  type: LineageEdgeType,
  label: string,
  sourceField: string | undefined,
  targetField: string | undefined,
): string {
  return sourceField === undefined || targetField === undefined
    ? JSON.stringify([source, target, type, label])
    : JSON.stringify([source, target, sourceField, targetField, type, label]);
}

function compareNodes(left: NormalizedLineageNode, right: NormalizedLineageNode): number {
  return left.id.localeCompare(right.id);
}

function compareEdges(left: NormalizedLineageEdge, right: NormalizedLineageEdge): number {
  return (
    left.source.localeCompare(right.source) ||
    left.target.localeCompare(right.target) ||
    (left.sourceField ?? "").localeCompare(right.sourceField ?? "") ||
    (left.targetField ?? "").localeCompare(right.targetField ?? "") ||
    left.type.localeCompare(right.type) ||
    left.label.localeCompare(right.label) ||
    (left.id ?? "").localeCompare(right.id ?? "")
  );
}
