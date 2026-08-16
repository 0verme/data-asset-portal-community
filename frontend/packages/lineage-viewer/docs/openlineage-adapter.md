# OpenLineage Adapter

`packages/adapter-openlineage/` is an independent, dependency-free Python package that converts
one OpenLineage `RunEvent` into `lineage-viewer` JSON. OpenLineage processing is not bundled into
the Web Component.

## Install for development

```sh
python -m pip install -e packages/adapter-openlineage
```

## Convert an event

```python
from lineage_viewer_adapter_openlineage import openlineage_to_lineage

graph = openlineage_to_lineage(event)
```

The result follows `LineageGraphData` schema version `1.0`:

- input datasets connect to the job with `reads` dependency edges;
- the job connects to output datasets with `writes` dependency edges;
- output `columnLineage` facets connect input fields directly to output fields;
- dataset `schema` facets provide field data types and descriptions.

OpenLineage transformation metadata is retained under `edge.metadata.openLineage`. Identity,
transformation, and aggregation semantics map to the closest Viewer transformation type.
Descriptions become Viewer expressions when present.

## CLI

```sh
lineage-viewer-openlineage \
  examples/openlineage-adapter/event.json \
  --output examples/openlineage-adapter/graph.json
```

Omit the input path or pass `-` to read JSON from standard input. Omit `--output` to write the
Viewer graph to standard output.

## Supported P3 scope

- one OpenLineage run event;
- job identity and run metadata;
- input and output datasets;
- top-level fields from dataset `schema` facets;
- output dataset `columnLineage` facets and transformation metadata.

The adapter also accepts `columnLineage` under `outputFacets` for compatibility with producers
that place output-specific facets there. It rejects references to datasets absent from the event
instead of inventing nodes. Event stream aggregation, custom facet interpretation, nested
schema-field flattening, and DatasetEvent or JobEvent conversion remain outside P3.

Run the [browser example](../examples/openlineage-adapter/) through `npm run dev`. The example
renders the committed Adapter output with the real Web Component.
