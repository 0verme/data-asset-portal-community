# Production host integration

`lineage-viewer` is the rendering kernel. The host remains responsible for lineage collection,
subgraph APIs, pagination or truncation, routing, toolbars, and detail panels.

## Public npm packages

The three packages are published publicly to npm with the same version:

```text
lineage-viewer@1.1.0
@lineage-viewer/domain-adapter@1.1.0
@lineage-viewer/react@1.1.0
```

Install fixed compatible versions in each host:

```sh
npm install --save-exact lineage-viewer@1.1.0 \
  @lineage-viewer/domain-adapter@1.1.0 \
  @lineage-viewer/react@1.1.0
```

All three packages follow Semantic Versioning and always share the same release version. Hosts
should upgrade and validate one minor release at a time; breaking schema or element API changes
are reserved for a new major version.

## Enterprise registry mirror (optional)

An enterprise can proxy the public packages through an internal registry. Configure credentials in
the deployment environment, never in this repository:

```ini
@lineage-viewer:registry=https://registry.example.internal/
//registry.example.internal/:_authToken=${NPM_TOKEN}
```

The mirror must retain the same public package names and versions so the install command above
continues to resolve an aligned release.

## Data flow

```text
host subgraph API
  -> host domain graph (nodes, edges, rootId, evidence)
  -> toViewerGraph(domainGraph, host mappings)
  -> LineageViewerCanvas
  -> node / field / edge callbacks
  -> host detail panel
```

The adapter preserves full node labels in `metadata.fullLabel` and
`metadata.fullSubtitle`. Edge evidence, confidence, and host attributes remain available under
edge metadata and are returned by `lineage-edge-click`.

## Root neighborhood fit

For bounded subgraphs, start with the root and its direct neighbors at a readable scale:

```tsx
const rootNeighborhood = getRootNeighborhoodNodeIds(domainGraph);

<LineageViewerCanvas
  data={toViewerGraph(domainGraph, adapterOptions)}
  options={{ direction: "LR", fitOnLoad: false }}
  initialFit={rootNeighborhood}
  initialFitOptions={{ padding: 48, maxScale: 1 }}
/>;
```

The host can keep its own controls and call `fitView`, `fitNodes`, `zoomBy`, and focus methods
through the component ref.
