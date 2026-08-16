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

export const defaultLineageViewerOptions: ResolvedLineageViewerOptions = {
  direction: "LR",
  fitOnLoad: true,
  readonly: true,
  showSelfLoops: false,
  showEdgeLabels: false,
  validationMode: "lenient",
  nodeWidth: 180,
  nodeHeight: 72,
  layerGap: 72,
  nodeGap: 32,
  highlightMode: "connected",
  viewMode: "mixed",
};

export function resolveOptions(
  current: ResolvedLineageViewerOptions,
  patch: unknown,
): ResolvedLineageViewerOptions {
  if (patch === null || typeof patch !== "object" || Array.isArray(patch)) return current;
  const values = patch as Record<string, unknown>;
  return {
    direction: isDirection(values["direction"]) ? values["direction"] : current.direction,
    fitOnLoad: typeof values["fitOnLoad"] === "boolean" ? values["fitOnLoad"] : current.fitOnLoad,
    readonly: typeof values["readonly"] === "boolean" ? values["readonly"] : current.readonly,
    showSelfLoops:
      typeof values["showSelfLoops"] === "boolean"
        ? values["showSelfLoops"]
        : current.showSelfLoops,
    showEdgeLabels:
      typeof values["showEdgeLabels"] === "boolean"
        ? values["showEdgeLabels"]
        : current.showEdgeLabels,
    validationMode:
      values["validationMode"] === "strict" || values["validationMode"] === "lenient"
        ? values["validationMode"]
        : current.validationMode,
    nodeWidth: positive(values["nodeWidth"], current.nodeWidth),
    nodeHeight: positive(values["nodeHeight"], current.nodeHeight),
    layerGap: positive(values["layerGap"], current.layerGap),
    nodeGap: positive(values["nodeGap"], current.nodeGap),
    highlightMode: isHighlightMode(values["highlightMode"])
      ? values["highlightMode"]
      : current.highlightMode,
    viewMode: isViewMode(values["viewMode"]) ? values["viewMode"] : current.viewMode,
  };
}

function positive(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}
function isDirection(value: unknown): value is ResolvedLineageViewerOptions["direction"] {
  return value === "LR" || value === "RL" || value === "TB" || value === "BT";
}
function isHighlightMode(value: unknown): value is ResolvedLineageViewerOptions["highlightMode"] {
  return (
    value === "connected" ||
    value === "both" ||
    value === "upstream" ||
    value === "downstream" ||
    value === "none"
  );
}
function isViewMode(value: unknown): value is LineageViewMode {
  return value === "table" || value === "column" || value === "mixed";
}
