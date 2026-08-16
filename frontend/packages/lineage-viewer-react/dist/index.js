import { jsx as _jsx } from "react/jsx-runtime";
import { forwardRef, useEffect, useImperativeHandle, useRef, } from "react";
import { defineLineageViewer, } from "lineage-viewer";
export const LineageViewerCanvas = forwardRef(function LineageViewerCanvas({ data, options, initialFit = "view", initialFitOptions, onNodeSelect, onFieldSelect, onEdgeSelect, ...containerProps }, forwardedRef) {
    const hostRef = useRef(null);
    const viewerRef = useRef(null);
    const readyRef = useRef(false);
    const callbacksRef = useRef({ onNodeSelect, onFieldSelect, onEdgeSelect });
    const fitRef = useRef({ initialFit, initialFitOptions });
    callbacksRef.current = { onNodeSelect, onFieldSelect, onEdgeSelect };
    fitRef.current = { initialFit, initialFitOptions };
    useImperativeHandle(forwardedRef, () => createHandle(viewerRef), []);
    useEffect(() => {
        const host = hostRef.current;
        if (!host)
            return undefined;
        defineLineageViewer();
        const viewer = document.createElement("lineage-viewer");
        const handleNode = (event) => callbacksRef.current.onNodeSelect?.(event.detail);
        const handleField = (event) => callbacksRef.current.onFieldSelect?.(event.detail);
        const handleEdge = (event) => callbacksRef.current.onEdgeSelect?.(event.detail);
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
        if (!viewer)
            return;
        viewer.data = data;
        if (readyRef.current)
            applyInitialFit(viewer, initialFit, initialFitOptions);
    }, [data, initialFit, initialFitOptions]);
    return _jsx("div", { ...containerProps, ref: hostRef });
});
function applyInitialFit(viewer, initialFit, options) {
    if (initialFit === "view")
        viewer.fitView();
    else if (Array.isArray(initialFit) && initialFit.length > 0)
        viewer.fitNodes(initialFit, options);
}
function createHandle(viewerRef) {
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
//# sourceMappingURL=index.js.map