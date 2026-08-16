# Column lineage guide

Column lineage uses table nodes with internal field rows. Do not model fields as separate graph nodes.

## Minimal mapping

```ts
viewer.data = {
  nodes: [
    {
      id: "source",
      label: "SOURCE",
      fields: [{ id: "customer_id", dataType: "bigint" }],
    },
    {
      id: "target",
      label: "TARGET",
      fields: [{ id: "customer_key", dataType: "bigint" }],
    },
  ],
  edges: [
    {
      source: "source",
      target: "target",
      sourceField: "customer_id",
      targetField: "customer_key",
      transformType: "rename",
      expression: "customer_id",
    },
  ],
};
```

Both field endpoints are required for a column edge. Keep table edges without either endpoint.

## Interaction

```ts
viewer.options = { viewMode: "column", highlightMode: "both" };
viewer.selectField("target", "customer_key");

viewer.addEventListener("lineage-field-click", (event) => {
  const { nodeId, fieldId } = (event as CustomEvent).detail;
  console.log(nodeId, fieldId);
});

viewer.addEventListener("lineage-edge-click", (event) => {
  const { source, target, transformType, expression } = (event as CustomEvent).detail;
  console.log(source.label, target.label, transformType, expression);
});
```

## Search and filtering

```ts
const matches = viewer.search("customer");
const bigintFields = viewer.search("", { dataType: "bigint" });
const positionedFields = viewer.searchFields("decimal");
viewer.clearSearch();
```

Search results are stable snapshots with `{ kind: "table", nodeId }` or `{ kind: "field", nodeId, fieldId }`.
`searchFields()` matches field names, table names, and data types, returns
`{ nodeId, fieldId, label }`, and positions the first result. Call `focusField()` to position
another result.

## Runnable examples

- [`examples/column-basic/`](../examples/column-basic/) — direct mappings and recursive field highlighting
- [`examples/column-transform/`](../examples/column-transform/) — transformation types and expressions
- [`examples/mixed-lineage/`](../examples/mixed-lineage/) — view switching and search

Run `npm run dev`, then open the corresponding `/examples/.../` URL.
