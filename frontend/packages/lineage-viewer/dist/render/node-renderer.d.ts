import type { RenderNode } from "./types.js";
export declare class NodeRenderer {
    private readonly idPrefix;
    private readonly fieldRenderer;
    constructor(idPrefix: string);
    render(item: RenderNode, index: number): SVGGElement;
}
//# sourceMappingURL=node-renderer.d.ts.map