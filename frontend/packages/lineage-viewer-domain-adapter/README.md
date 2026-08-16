# @lineage-viewer/domain-adapter

Framework-neutral conversion from enterprise domain graphs to the `lineage-viewer` schema.

```ts
import { toViewerGraph } from "@lineage-viewer/domain-adapter";

const data = toViewerGraph(domainGraph, {
  nodeTypes: { task: "job", table: "table" },
  edgeTypes: { schedule_dependency: "dependency" },
});
```
