/** The current package version. */
export const packageVersion = "1.1.0" as const;

export { LineageViewerElement } from "./element/index.js";
export { defineLineageViewer } from "./registration.js";
export type {
  SceneBounds,
  ViewportFitOptions,
  ViewportSize,
  ViewportTransform,
} from "./interactions/index.js";
export type {
  LineageDiagnosticEventDetail,
  LineageEdgeClickEventDetail,
  LineageEdgeEndpoint,
  LineageFieldClickEventDetail,
  LineageFieldLocation,
  LineageFieldSelection,
  LineageFieldSearchResult,
  LineageNodeClickEventDetail,
  LineageReadyEventDetail,
  LineageSelectionChangeEventDetail,
  LineageSearchFilter,
  LineageSearchOptions,
  LineageSearchResult,
  LineageTableSearchResult,
  LineageViewerEventName,
  LineageViewerEventDetailMap,
  LineageViewerOptions,
  LineageViewMode,
} from "./public-api/index.js";

export type {
  LineageDiagnostic,
  LineageEdge,
  LineageEdgeType,
  LineageField,
  LineageGraphData,
  LineageNode,
  LineageNodeStatus,
  LineageNodeType,
  LineageTransformType,
} from "./schema/index.js";
