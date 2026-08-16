import type { NormalizedLineageGraph } from "../graph/index.js";
export interface FieldReference {
    readonly nodeId: string;
    readonly fieldId: string;
}
export type FieldTraversalMode = "both" | "upstream" | "downstream";
export interface FieldTraversalResult {
    readonly fieldKeys: ReadonlySet<string>;
    readonly edgeKeys: ReadonlySet<string>;
}
export declare function fieldReferenceKey(reference: FieldReference): string;
export declare function traverseFieldLineage(graph: NormalizedLineageGraph, start: FieldReference, mode: FieldTraversalMode): FieldTraversalResult;
//# sourceMappingURL=field-traversal.d.ts.map