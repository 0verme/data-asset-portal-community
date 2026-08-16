import type { NormalizeLineageGraphOptions, NormalizedLineageGraph } from "./types.js";
import { type LineageDiagnostic } from "../schema/diagnostics.js";
export interface NormalizeLineageGraphResult {
    readonly graph: NormalizedLineageGraph | null;
    readonly diagnostics: readonly LineageDiagnostic[];
    readonly hasErrors: boolean;
}
export declare function normalizeLineageGraphData(input: unknown, options?: NormalizeLineageGraphOptions): NormalizeLineageGraphResult;
//# sourceMappingURL=normalize.d.ts.map