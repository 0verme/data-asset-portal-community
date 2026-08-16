# @lineage-viewer/react

Headless React lifecycle wrapper for `lineage-viewer`. The host owns controls, layout, and detail UI.

```tsx
const ref = useRef<LineageViewerCanvasHandle>(null);

<LineageViewerCanvas
  ref={ref}
  data={viewerGraph}
  initialFit={rootNeighborhoodIds}
  initialFitOptions={{ padding: 48, maxScale: 1 }}
  onNodeSelect={({ nodeId }) => setSelectedId(nodeId)}
/>;
```
