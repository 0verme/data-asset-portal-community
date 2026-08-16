import { type NormalizedLineageGraph } from "../graph/index.js";
import { type FieldReference } from "./field-traversal.js";
export interface InteractionState {
    readonly selectedNodeId: string | null;
    readonly selectedFieldKey: string | null;
    readonly highlightedNodeIds: ReadonlySet<string>;
    readonly dimmedNodeIds: ReadonlySet<string>;
    readonly highlightedFieldKeys: ReadonlySet<string>;
    readonly dimmedFieldKeys: ReadonlySet<string>;
    readonly highlightedEdgeKeys: ReadonlySet<string>;
    readonly dimmedEdgeKeys: ReadonlySet<string>;
}
export declare function calculateInteractionState(graph: NormalizedLineageGraph | null, selectedNodeId: string | null, mode: "connected" | "both" | "upstream" | "downstream" | "none", selectedField?: FieldReference | null): InteractionState;
//# sourceMappingURL=highlight-state.d.ts.map