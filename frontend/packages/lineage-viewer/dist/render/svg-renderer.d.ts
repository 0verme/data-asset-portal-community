import type { ResolvedLineageViewerOptions } from "../public-api/options.js";
import type { InteractionState } from "../interactions/index.js";
import type { SearchState } from "../search/index.js";
import type { ViewportTransform } from "../interactions/viewport-types.js";
import type { RenderScene } from "./types.js";
export declare class SvgRenderer {
    readonly svg: SVGSVGElement;
    private readonly viewportGroup;
    private readonly sceneGroup;
    private viewportWidth;
    private viewportHeight;
    private readonly markerId;
    private readonly nodeRenderer;
    private readonly edgesGroup;
    private readonly nodesGroup;
    private readonly edgeElements;
    private readonly nodeElements;
    private fieldElements;
    private interactionState;
    private searchState;
    private interactionDirty;
    private searchDirty;
    private destroyed;
    constructor(host: ShadowRoot);
    render(scene: RenderScene, options: ResolvedLineageViewerOptions): void;
    clear(): void;
    setEdgeLabels(show: boolean): void;
    setViewportSize(width: number, height: number): void;
    setViewportTransform(transform: ViewportTransform): void;
    setInteractionState(state: InteractionState): void;
    setSearchState(state: SearchState): void;
    destroy(): void;
}
//# sourceMappingURL=svg-renderer.d.ts.map