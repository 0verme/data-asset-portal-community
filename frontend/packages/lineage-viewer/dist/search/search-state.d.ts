import type { NormalizedLineageGraph } from "../graph/index.js";
import type { LineageSearchResult } from "../public-api/search.js";
export interface SearchState {
    readonly matchedNodeIds: ReadonlySet<string>;
    readonly dimmedNodeIds: ReadonlySet<string>;
    readonly matchedFieldKeys: ReadonlySet<string>;
    readonly dimmedFieldKeys: ReadonlySet<string>;
    readonly dimmedEdgeKeys: ReadonlySet<string>;
}
export declare function calculateSearchState(sourceGraph: NormalizedLineageGraph | null, viewGraph: NormalizedLineageGraph | null, results: readonly LineageSearchResult[], active: boolean): SearchState;
export declare function emptySearchState(): SearchState;
//# sourceMappingURL=search-state.d.ts.map