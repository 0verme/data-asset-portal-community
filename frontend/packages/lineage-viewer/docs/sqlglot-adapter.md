# SQLGlot Adapter

`packages/adapter-sqlglot/` is an independent Python package that converts SQL into
`lineage-viewer` JSON. SQLGlot is not bundled into the Web Component or its browser runtime.

## Install for development

```sh
python -m pip install -e packages/adapter-sqlglot
```

## Convert SQL

```python
from lineage_viewer_adapter_sqlglot import sql_to_lineage

graph = sql_to_lineage(
    """
    SELECT
      user_id,
      SUM(amount) AS total_amount
    FROM orders
    GROUP BY user_id
    """,
    target_table="order_summary",
)
```

The returned plain dictionary follows `LineageGraphData` schema version `1.0`. Source and target
fields become field rows, while each projected source column becomes a column edge. Aliases,
scalar expressions, and aggregates map to `rename`, `transform`, and `aggregate`; unchanged
columns use `passthrough`.

## CLI

```sh
lineage-viewer-sqlglot \
  examples/sqlglot-adapter/query.sql \
  --target order_summary \
  --output examples/sqlglot-adapter/graph.json
```

Use `--dialect` for a SQLGlot source dialect. Omit the input path or pass `-` to read SQL from
standard input. Omit `--output` to write JSON to standard output.

## Supported P2 scope

- `SELECT` projections
- multiple joined tables with qualified projected columns
- table and column aliases
- scalar transformations
- aggregate functions

The Adapter rejects wildcard projections and ambiguous unqualified columns across joined tables
because resolving either safely requires schema metadata. CTE output resolution, correlated
subqueries, and write-statement target inference remain outside P2.

Run the [browser example](../examples/sqlglot-adapter/) through `npm run dev`. The example renders
the committed Adapter output with the real Web Component.
