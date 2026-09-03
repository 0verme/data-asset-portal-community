import React from "react";
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
>(function LineageCanvas({ graph, onSelect }, ref) {
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
                aria-label="血缘图视图操作"
            >
                <button
                    type="button"
                    className="lineage-view-tool"
                    onClick={() => viewerRef.current?.zoomBy(1 / 1.2)}
                    aria-label="缩小"
                    title="缩小"
                >
                    −
                </button>
                <button
                    type="button"
                    className="lineage-view-tool"
                    onClick={() => viewerRef.current?.zoomBy(1.2)}
                    aria-label="放大"
                    title="放大"
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
                    aria-label="定位根节点邻域"
                    title="定位根节点邻域"
                >
                    定位
                </button>
                <button
                    type="button"
                    className="lineage-view-tool"
                    onClick={() => viewerRef.current?.fitView()}
                    aria-label="适应全部"
                    title="适应全部"
                >
                    适应画布
                </button>
            </div>
            <LineageViewerCanvas
                ref={viewerRef}
                className="lineage-canvas"
                aria-label="任务血缘图"
                data={viewerGraph}
                options={viewerOptions}
                initialFit={rootNodeIds}
                initialFitOptions={ROOT_NEIGHBORHOOD_FIT_OPTIONS}
                onNodeSelect={({ nodeId }) => onSelect(nodeId)}
            />
        </div>
    );
});
