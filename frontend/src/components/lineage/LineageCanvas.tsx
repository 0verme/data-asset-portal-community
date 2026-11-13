import React from "react";
import { useTranslation } from "react-i18next";
import {
    getRootNeighborhoodNodeIds,
    type DomainLineageGraph,
} from "@lineage-viewer/domain-adapter";
import {
    LineageViewerCanvas,
    type LineageViewerCanvasHandle,
} from "@lineage-viewer/react";
import type { LineageViewerOptions } from "lineage-viewer";

import { toViewerGraph } from "./lineageAdapter.ts";

const ROOT_NEIGHBORHOOD_FIT_OPTIONS = { padding: 48, maxScale: 1 };

export interface LineageCanvasProps {
    graph: DomainLineageGraph;
    selectedNodeId: string | null;
    focusRequest: { nodeId: string; sequence: number } | null;
    onFocusRequestHandled: (sequence: number) => void;
    onSelect: (nodeId: string) => void;
}

export interface LineageCanvasHandle {
    zoomIn: () => void;
    zoomOut: () => void;
    fitView: () => void;
    focusRoot: () => void;
}

export const LineageCanvas = React.forwardRef<
    LineageCanvasHandle,
    LineageCanvasProps
>(function LineageCanvas({ graph, selectedNodeId, focusRequest, onFocusRequestHandled, onSelect }, ref) {
    const { t } = useTranslation("lineage");
    const viewerRef = React.useRef<LineageViewerCanvasHandle | null>(null);
    const viewerGraph = React.useMemo(() => toViewerGraph(graph), [graph]);
    const rootNodeIds = React.useMemo(
        () => getRootNeighborhoodNodeIds(graph),
        [graph],
    );
    const viewerOptions = React.useMemo<LineageViewerOptions>(
        () => ({
            direction: "LR",
            fitOnLoad: false,
            nodeWidth: 220,
            nodeHeight: 72,
            highlightMode: "connected",
            validationMode: "strict",
        }),
        [],
    );

    React.useEffect(() => {
        if (!selectedNodeId || !graph.nodes.some((node) => node.id === selectedNodeId)) return;
        viewerRef.current?.selectNode(selectedNodeId);
    }, [graph.nodes, selectedNodeId, viewerGraph]);

    React.useEffect(() => {
        const viewer = viewerRef.current;
        if (!focusRequest || !viewer) return;
        if (graph.nodes.some((node) => node.id === focusRequest.nodeId)) {
            viewer.selectNode(focusRequest.nodeId);
            viewer.focusNode(focusRequest.nodeId);
        }
        onFocusRequestHandled(focusRequest.sequence);
    }, [focusRequest, graph.nodes, viewerGraph, onFocusRequestHandled]);

    React.useImperativeHandle(
        ref,
        () => ({
            zoomIn: () => viewerRef.current?.zoomBy(1.2),
            zoomOut: () => viewerRef.current?.zoomBy(1 / 1.2),
            fitView: () => viewerRef.current?.fitView(),
            focusRoot: () =>
                viewerRef.current?.fitNodes(
                    rootNodeIds,
                    ROOT_NEIGHBORHOOD_FIT_OPTIONS,
                ),
        }),
        [rootNodeIds],
    );

    return (
        <div className="lineage-canvas-shell">
            <div
                className="lineage-view-tools"
                role="group"
                aria-label={t("canvas.tools")}
            >
                <button
                    type="button"
                    className="lineage-view-tool"
                    onClick={() => viewerRef.current?.zoomBy(1 / 1.2)}
                    aria-label={t("canvas.zoomOut")}
                    title={t("canvas.zoomOut")}
                >
                    −
                </button>
                <button
                    type="button"
                    className="lineage-view-tool"
                    onClick={() => viewerRef.current?.zoomBy(1.2)}
                    aria-label={t("canvas.zoomIn")}
                    title={t("canvas.zoomIn")}
                >
                    +
                </button>
                <button
                    type="button"
                    className="lineage-view-tool"
                    onClick={() =>
                        viewerRef.current?.fitNodes(
                            rootNodeIds,
                            ROOT_NEIGHBORHOOD_FIT_OPTIONS,
                        )
                    }
                    aria-label={t("canvas.focusRoot")}
                    title={t("canvas.focusRoot")}
                >
                    {t("canvas.focusRootButton")}
                </button>
                <button
                    type="button"
                    className="lineage-view-tool"
                    onClick={() => viewerRef.current?.fitView()}
                    aria-label={t("canvas.fitView")}
                    title={t("canvas.fitView")}
                >
                    {t("canvas.fitViewButton")}
                </button>
            </div>
            <LineageViewerCanvas
                ref={viewerRef}
                className="lineage-canvas"
                aria-label={t("canvas.diagram")}
                data={viewerGraph}
                options={viewerOptions}
                initialFit={rootNodeIds}
                initialFitOptions={ROOT_NEIGHBORHOOD_FIT_OPTIONS}
                onNodeSelect={({ nodeId }) => onSelect(nodeId)}
            />
        </div>
    );
});
