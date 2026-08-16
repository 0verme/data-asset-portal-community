# Public API

The package exposes a native `<lineage-viewer>` Web Component. Only the root and `./define` package exports are supported.

## Registration and data

```ts
import "lineage-viewer/define";
import type { LineageViewerElement } from "lineage-viewer";

const viewer = document.querySelector("lineage-viewer") as LineageViewerElement;
viewer.data = {
  nodes: [{ id: "orders", label: "Orders", fields: [{ id: "order_id" }] }],
  edges: [],
};
```

`data` accepts `LineageGraphData | null`. Object mutation after assignment is not observed; assign again or call `setData()` after changing the input.

## Properties and options

Reading `options` returns a resolved snapshot. Setting it accepts a partial `LineageViewerOptions` patch.

| Property                   | Type and default                                                               | Effect                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `direction`                | `"LR" \| "RL" \| "TB" \| "BT"`, `"LR"`                                         | Recalculates layout.                                                                                   |
| `fitOnLoad`                | `boolean`, `true`                                                              | Fits new scenes.                                                                                       |
| `readonly`                 | `boolean`, `true`                                                              | Reserved; no separate behavior yet.                                                                    |
| `showSelfLoops`            | `boolean`, `false`                                                             | Renormalizes data.                                                                                     |
| `showEdgeLabels`           | `boolean`, `false`                                                             | Renders edge labels.                                                                                   |
| `validationMode`           | `"strict" \| "lenient"`, `"lenient"`                                           | Controls validation recovery.                                                                          |
| `nodeWidth` / `nodeHeight` | positive `number`, `180` / `72`                                                | Sets minimum node dimensions. Field rows can increase height.                                          |
| `layerGap` / `nodeGap`     | positive `number`, `72` / `32`                                                 | Recalculates layout.                                                                                   |
| `highlightMode`            | `"connected" \| "both" \| "upstream" \| "downstream" \| "none"`, `"connected"` | Controls recursive selection highlighting. `connected` is a compatibility alias for `both` for fields. |
| `viewMode`                 | `"table" \| "column" \| "mixed"`, `"mixed"`                                    | Chooses visible relation types.                                                                        |

Read-only properties:

- `selectedNodeId: string | null`
- `selectedField: { nodeId: string; fieldId: string } | null`
- `searchResults: readonly LineageSearchResult[]`

## View modes

- `table` hides fields and renders table edges. If data only has column mappings, mappings with the same table endpoints collapse into a derived table relation.
- `column` renders fields and column edges only.
- `mixed` renders table and column edges together and is the default.

Changing the mode rebuilds visible adjacency, cycle groups, layout, and interaction state without changing `data`. Switching to `table` clears a field selection because its row is hidden.

## Methods

| Method                         | Behavior                                                              |
| ------------------------------ | --------------------------------------------------------------------- |
| `setData(data)`                | Sets and normalizes graph data.                                       |
| `setOptions(options)`          | Applies an options patch.                                             |
| `getDiagnostics()`             | Returns the latest diagnostic snapshot.                               |
| `fitView()` / `resetView()`    | Fits the scene or restores its baseline.                              |
| `fitBounds(bounds, options?)`  | Fits an arbitrary scene rectangle.                                    |
| `fitNodes(nodeIds, options?)`  | Fits existing nodes.                                                  |
| `focusNode(nodeId)`            | Centers an existing node.                                             |
| `focusField(nodeId, fieldId)`  | Centers the table containing an existing field.                       |
| `zoomBy(factor)`               | Zooms around the viewport center.                                     |
| `selectNode(nodeId)`           | Selects an existing table node.                                       |
| `selectField(nodeId, fieldId)` | Selects an existing visible field. No-op in `table` mode.             |
| `clearSelection()`             | Clears node or field selection.                                       |
| `search(query, filter?)`       | Searches table/field IDs and labels, optionally filtering `dataType`. |
| `search(options)`              | Searches with `{ query?, dataType? }`.                                |
| `searchFields(keyword)`        | Finds fields by field/table/type and focuses the first result.        |
| `clearSearch()`                | Clears search highlighting and results.                               |
| `destroy()`                    | Idempotently disables the instance and releases resources.            |

Search is case-insensitive. Name matching is substring-based; `dataType` filtering is an exact case-insensitive match. Empty criteria clear search.

```ts
viewer.search("customer");
viewer.search("", { dataType: "bigint" });
viewer.search({ query: "amount", dataType: "decimal(18,2)" });
const fields = viewer.searchFields("decimal");
viewer.clearSearch();
```

`searchFields()` returns stable `{ nodeId, fieldId, label }` snapshots. A table-name match
returns its fields, and the first result is positioned in the viewport. Use `focusField()` to
position any other result.

## Events

All events are bubbling, composed, non-cancelable `CustomEvent`s.

| Event                               | Detail                                                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `lineage-ready`                     | `{ nodeCount, edgeCount, state }`                                                                       |
| `lineage-error` / `lineage-warning` | `{ diagnostics, hasErrors }`                                                                            |
| `lineage-node-click`                | `{ nodeId, node }`                                                                                      |
| `lineage-field-click`               | `{ nodeId, fieldId, node, field }`                                                                      |
| `lineage-edge-click`                | `{ edgeKey, edge, source, target, transformType, expression }`                                          |
| `lineage-selection-change`          | `{ selectedNodeId, previousSelectedNodeId, selectedField, previousSelectedField, node, field, source }` |

## Styling boundary

The element owns an open Shadow DOM. Give the host an explicit height. Supported CSS variables include background, node status, node selection/search, field, edge, dimming, and font variables declared on `:host`. Internal classes, SVG structure, generated IDs, and unlisted attributes are not compatibility guarantees.
