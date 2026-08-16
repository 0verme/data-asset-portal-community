import type { NormalizedLineageGraph } from "../graph/index.js";
import type { LineageFieldLocation, LineageSearchOptions, LineageSearchResult } from "../public-api/search.js";
export declare function normalizeSearchOptions(queryOrOptions: string | LineageSearchOptions, filter?: LineageSearchOptions): LineageSearchOptions | null;
export declare function searchLineageGraph(graph: NormalizedLineageGraph | null, options: LineageSearchOptions | null): readonly LineageSearchResult[];
export declare function searchFields(graph: NormalizedLineageGraph | null, keyword: string): readonly LineageFieldLocation[];
//# sourceMappingURL=field-search.d.ts.map