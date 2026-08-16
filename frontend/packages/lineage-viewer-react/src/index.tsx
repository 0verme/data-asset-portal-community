import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type HTMLAttributes,
  type MutableRefObject,
} from "react";

import {
  defineLineageViewer,
  type LineageEdgeClickEventDetail,
  type LineageFieldClickEventDetail,
  type LineageGraphData,
  type LineageNodeClickEventDetail,
  type LineageViewerElement,
  type LineageViewerOptions,
  type ViewportFitOptions,
} from "lineage-viewer";

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

export const LineageViewerCanvas = forwardRef<LineageViewerCanvasHandle, LineageViewerCanvasProps>(
  function LineageViewerCanvas(
    {
      data,
      options,
      initialFit = "view",
      initialFitOptions,
      onNodeSelect,
      onFieldSelect,
      onEdgeSelect,
      ...containerProps
    },
    forwardedRef,
  ) {
    const hostRef = useRef<HTMLDivElement>(null);
    const viewerRef = useRef<LineageViewerElement | null>(null);
    const readyRef = useRef(false);
    const callbacksRef = useRef({ onNodeSelect, onFieldSelect, onEdgeSelect });
    const fitRef = useRef({ initialFit, initialFitOptions });
    callbacksRef.current = { onNodeSelect, onFieldSelect, onEdgeSelect };
    fitRef.current = { initialFit, initialFitOptions };

    useImperativeHandle(forwardedRef, () => createHandle(viewerRef), []);

    useEffect(() => {
      const host = hostRef.current;
      if (!host) return undefined;
      defineLineageViewer();
      const viewer = document.createElement("lineage-viewer") as LineageViewerElement;
      const handleNode = (event: Event) =>
        callbacksRef.current.onNodeSelect?.(
          (event as CustomEvent<LineageNodeClickEventDetail>).detail,
        );
      const handleField = (event: Event) =>
        callbacksRef.current.onFieldSelect?.(
          (event as CustomEvent<LineageFieldClickEventDetail>).detail,
        );
      const handleEdge = (event: Event) =>
        callbacksRef.current.onEdgeSelect?.(
          (event as CustomEvent<LineageEdgeClickEventDetail>).detail,
        );
      const handleReady = () => {
        readyRef.current = true;
        applyInitialFit(viewer, fitRef.current.initialFit, fitRef.current.initialFitOptions);
      };
      viewer.addEventListener("lineage-node-click", handleNode);
      viewer.addEventListener("lineage-field-click", handleField);
      viewer.addEventListener("lineage-edge-click", handleEdge);
      viewer.addEventListener("lineage-ready", handleReady);
      host.replaceChildren(viewer);
      viewerRef.current = viewer;

      return () => {
        readyRef.current = false;
        viewerRef.current = null;
        viewer.removeEventListener("lineage-node-click", handleNode);
        viewer.removeEventListener("lineage-field-click", handleField);
        viewer.removeEventListener("lineage-edge-click", handleEdge);
        viewer.removeEventListener("lineage-ready", handleReady);
        viewer.destroy();
        viewer.remove();
      };
    }, []);

    useEffect(() => {
      viewerRef.current?.setOptions(options ?? {});
    }, [options]);

    useEffect(() => {
      const viewer = viewerRef.current;
      if (!viewer) return;
      viewer.data = data;
      if (readyRef.current) applyInitialFit(viewer, initialFit, initialFitOptions);
    }, [data, initialFit, initialFitOptions]);

    return <div {...containerProps} ref={hostRef} />;
  },
);

function applyInitialFit(
  viewer: LineageViewerElement,
  initialFit: LineageInitialFit,
  options: ViewportFitOptions | undefined,
): void {
  if (initialFit === "view") viewer.fitView();
  else if (Array.isArray(initialFit) && initialFit.length > 0) viewer.fitNodes(initialFit, options);
}

function createHandle(
  viewerRef: MutableRefObject<LineageViewerElement | null>,
): LineageViewerCanvasHandle {
  return {
    getElement: () => viewerRef.current,
    zoomBy: (factor) => viewerRef.current?.zoomBy(factor),
    fitView: () => viewerRef.current?.fitView(),
    fitNodes: (nodeIds, options) => viewerRef.current?.fitNodes(nodeIds, options),
    focusNode: (nodeId) => viewerRef.current?.focusNode(nodeId),
    focusField: (nodeId, fieldId) => viewerRef.current?.focusField(nodeId, fieldId),
    selectNode: (nodeId) => viewerRef.current?.selectNode(nodeId),
    selectField: (nodeId, fieldId) => viewerRef.current?.selectField(nodeId, fieldId),
    clearSelection: () => viewerRef.current?.clearSelection(),
  };
}
