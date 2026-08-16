import type { LineageDiagnostic } from "./diagnostics.js";
import type { LineageEdgeType, LineageNodeStatus, LineageNodeType, LineageTransformType } from "./types.js";
export declare function isPlainRecord(value: unknown): value is Record<string, unknown>;
export declare function isNodeType(value: unknown): value is LineageNodeType;
export declare function isNodeStatus(value: unknown): value is LineageNodeStatus;
export declare function isEdgeType(value: unknown): value is LineageEdgeType;
export declare function isTransformType(value: unknown): value is LineageTransformType;
export declare function isNonEmptyString(value: unknown): value is string;
export declare function validateLineageGraphData(input: unknown): readonly LineageDiagnostic[];
export declare function invalid(message: string, nodeId?: string, edgeId?: string): LineageDiagnostic;
//# sourceMappingURL=validate.d.ts.map