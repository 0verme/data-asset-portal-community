# Data schema and diagnostics

The schema remains version `1.0` and supports table-level, column-level, and mixed lineage. A field is a row inside a graph node, not an independent graph node.

```ts
export interface LineageGraphData {
  schemaVersion?: "1.0";
  nodes: LineageNode[];
  edges: LineageEdge[];
}

export interface LineageNode {
  id: string;
  label: string;
  type?: "table" | "view" | "field" | "job" | "dataset" | "custom";
  layer?: string;
  subtitle?: string;
  status?: "default" | "success" | "warning" | "error" | "muted";
  fields?: LineageField[];
  metadata?: Record<string, unknown>;
}

export interface LineageField {
  id: string;
  label?: string;
  dataType?: string;
  description?: string;
}

export interface LineageEdge {
  id?: string;
  source: string;
  target: string;
  sourceField?: string;
  targetField?: string;
  label?: string;
  type?: "lineage" | "dependency" | "reference" | "custom";
  transformType?: "passthrough" | "rename" | "transform" | "aggregate" | "unknown";
  expression?: string;
  metadata?: Record<string, unknown>;
}
```

## Column lineage

`sourceField` and `targetField` must either both be present or both be absent. When present, each ID must exist in the corresponding source or target node. Multiple mappings between the same table pair are retained when their field endpoints differ.

```json
{
  "nodes": [
    {
      "id": "raw_orders",
      "label": "RAW_ORDERS",
      "fields": [{ "id": "amount_cents", "dataType": "bigint" }]
    },
    {
      "id": "fct_orders",
      "label": "FCT_ORDERS",
      "fields": [{ "id": "amount_usd", "dataType": "decimal(18,2)" }]
    }
  ],
  "edges": [
    {
      "source": "raw_orders",
      "target": "fct_orders",
      "sourceField": "amount_cents",
      "targetField": "amount_usd",
      "transformType": "transform",
      "expression": "amount_cents / 100.0"
    }
  ]
}
```

Field order is preserved for rendering. Field IDs are trimmed and must be unique within their owning node. Optional field attributes must be strings when provided.

## Validation modes

`validationMode` defaults to `"lenient"`. Strict mode returns no normalized graph when an error exists. Lenient mode skips invalid nodes, fields, or edges where possible and retains valid siblings.

Duplicate nodes retain the first valid occurrence in lenient mode. Duplicate fields retain the first valid field. Duplicate edges use a canonical key that includes field endpoints, so only an identical column mapping is removed. Self-loops are hidden unless `showSelfLoops` is enabled. Cycles are preserved and reported.

Diagnostic codes are:

- `INVALID_GRAPH_DATA`
- `DUPLICATE_NODE_ID`
- `DUPLICATE_FIELD_ID`
- `DUPLICATE_EDGE`
- `MISSING_EDGE_SOURCE`
- `MISSING_EDGE_TARGET`
- `UNPAIRED_FIELD_REFERENCE`
- `MISSING_SOURCE_FIELD`
- `MISSING_TARGET_FIELD`
- `SELF_LOOP_HIDDEN`
- `CYCLE_DETECTED`
- `EMPTY_GRAPH`

Diagnostics use stable ordering by level, code, node ID, edge ID, then message.
