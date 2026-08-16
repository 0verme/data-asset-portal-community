import type { ValidationMode } from "../schema/types.js";
export type LineageViewMode = "table" | "column" | "mixed";
export interface LineageViewerOptions {
    direction?: "LR" | "RL" | "TB" | "BT";
    fitOnLoad?: boolean;
    readonly?: boolean;
    showSelfLoops?: boolean;
    showEdgeLabels?: boolean;
    validationMode?: ValidationMode;
    nodeWidth?: number;
    nodeHeight?: number;
    layerGap?: number;
    nodeGap?: number;
    highlightMode?: "connected" | "both" | "upstream" | "downstream" | "none";
    viewMode?: LineageViewMode;
}
export interface ResolvedLineageViewerOptions {
    readonly direction: "LR" | "RL" | "TB" | "BT";
    readonly fitOnLoad: boolean;
    readonly readonly: boolean;
    readonly showSelfLoops: boolean;
    readonly showEdgeLabels: boolean;
    readonly validationMode: ValidationMode;
    readonly nodeWidth: number;
    readonly nodeHeight: number;
    readonly layerGap: number;
    readonly nodeGap: number;
    readonly highlightMode: "connected" | "both" | "upstream" | "downstream" | "none";
    readonly viewMode: LineageViewMode;
}
export declare const defaultLineageViewerOptions: ResolvedLineageViewerOptions;
export declare function resolveOptions(current: ResolvedLineageViewerOptions, patch: unknown): ResolvedLineageViewerOptions;
//# sourceMappingURL=options.d.ts.map