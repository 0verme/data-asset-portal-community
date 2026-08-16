export type LineageDiagnosticCode =
  | "INVALID_GRAPH_DATA"
  | "DUPLICATE_NODE_ID"
  | "DUPLICATE_FIELD_ID"
  | "DUPLICATE_EDGE"
  | "MISSING_EDGE_SOURCE"
  | "MISSING_EDGE_TARGET"
  | "UNPAIRED_FIELD_REFERENCE"
  | "MISSING_SOURCE_FIELD"
  | "MISSING_TARGET_FIELD"
  | "SELF_LOOP_HIDDEN"
  | "CYCLE_DETECTED"
  | "EMPTY_GRAPH";

export interface LineageDiagnostic {
  level: "error" | "warning" | "info";
  code: LineageDiagnosticCode;
  message: string;
  nodeId?: string;
  edgeId?: string;
}

const levelOrder: Record<LineageDiagnostic["level"], number> = {
  error: 0,
  warning: 1,
  info: 2,
};

export function sortDiagnostics(
  diagnostics: readonly LineageDiagnostic[],
): readonly LineageDiagnostic[] {
  return [...diagnostics].sort((left, right) => {
    const levelComparison = levelOrder[left.level] - levelOrder[right.level];
    if (levelComparison !== 0) return levelComparison;
    const codeComparison = left.code.localeCompare(right.code);
    if (codeComparison !== 0) return codeComparison;
    const nodeComparison = (left.nodeId ?? "").localeCompare(right.nodeId ?? "");
    if (nodeComparison !== 0) return nodeComparison;
    const edgeComparison = (left.edgeId ?? "").localeCompare(right.edgeId ?? "");
    if (edgeComparison !== 0) return edgeComparison;
    return left.message.localeCompare(right.message);
  });
}
