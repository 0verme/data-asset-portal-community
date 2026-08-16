export type LineageDiagnosticCode = "INVALID_GRAPH_DATA" | "DUPLICATE_NODE_ID" | "DUPLICATE_FIELD_ID" | "DUPLICATE_EDGE" | "MISSING_EDGE_SOURCE" | "MISSING_EDGE_TARGET" | "UNPAIRED_FIELD_REFERENCE" | "MISSING_SOURCE_FIELD" | "MISSING_TARGET_FIELD" | "SELF_LOOP_HIDDEN" | "CYCLE_DETECTED" | "EMPTY_GRAPH";
export interface LineageDiagnostic {
    level: "error" | "warning" | "info";
    code: LineageDiagnosticCode;
    message: string;
    nodeId?: string;
    edgeId?: string;
}
export declare function sortDiagnostics(diagnostics: readonly LineageDiagnostic[]): readonly LineageDiagnostic[];
//# sourceMappingURL=diagnostics.d.ts.map