import { type HTMLAttributes } from "react";
import { type LineageEdgeClickEventDetail, type LineageFieldClickEventDetail, type LineageGraphData, type LineageNodeClickEventDetail, type LineageViewerElement, type LineageViewerOptions, type ViewportFitOptions } from "lineage-viewer";
export type LineageInitialFit = "view" | "none" | readonly string[];
export interface LineageViewerCanvasProps extends HTMLAttributes<HTMLDivElement> {
    data: LineageGraphData;
    options?: LineageViewerOptions;
    initialFit?: LineageInitialFit;
    initialFitOptions?: ViewportFitOptions;
    onNodeSelect?: (detail: LineageNodeClickEventDetail) => void;
    onFieldSelect?: (detail: LineageFieldClickEventDetail) => void;
    onEdgeSelect?: (detail: LineageEdgeClickEventDetail) => void;
}
export interface LineageViewerCanvasHandle {
    getElement(): LineageViewerElement | null;
    zoomBy(factor: number): void;
    fitView(): void;
    fitNodes(nodeIds: readonly string[], options?: ViewportFitOptions): void;
    focusNode(nodeId: string): void;
    focusField(nodeId: string, fieldId: string): void;
    selectNode(nodeId: string): void;
    selectField(nodeId: string, fieldId: string): void;
    clearSelection(): void;
}
export declare const LineageViewerCanvas: import("react").ForwardRefExoticComponent<LineageViewerCanvasProps & import("react").RefAttributes<LineageViewerCanvasHandle>>;
//# sourceMappingURL=index.d.ts.map