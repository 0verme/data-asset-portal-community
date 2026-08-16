# lineage-viewer

[简体中文](./README.md) | English

> A lightweight, framework-free Web Component for interactive table-level and column-level data lineage visualization.

lineage-viewer is an embeddable data lineage viewer built with native Web Components, Shadow DOM, and SVG. Pass it JSON to render interactive table-level and column-level lineage in any web page or frontend framework.

[![CI](https://github.com/0verme/lineage-viewer/actions/workflows/ci.yml/badge.svg)](https://github.com/0verme/lineage-viewer/actions/workflows/ci.yml) `Stable` · `TypeScript` · `Web Component` · `Zero runtime dependencies` · `Apache-2.0`

[Live demo](https://lineage.overme.cn) · [Transformation demo](https://lineage.overme.cn/demo.html?id=column-transform&lang=en) · [JSON Playground](https://lineage.overme.cn/playground.html?lang=en) · [Quick start](#quick-start) · [中文文档](./README.md)

![Interactive column-level lineage with transformation expressions](docs/assets/column-lineage.png)

## Features

- Table lineage
- Column lineage
- Mixed lineage
- Field dependency tracing
- SVG rendering
- Shadow DOM isolation
- Zero framework dependency
- Embeddable anywhere

Column edges can carry `passthrough`, `rename`, `transform`, or `aggregate` metadata and expressions such as `SUM(amount)` or `concat(first_name, last_name)`. Selecting a field highlights its complete `upstream`, `downstream`, or `both` path.

## Demo

[lineage.overme.cn](https://lineage.overme.cn/?lang=en) provides switchable table, column, and transformation showcases plus a local-only [JSON Playground](https://lineage.overme.cn/playground.html?lang=en).

- [Table lineage](https://lineage.overme.cn/demo.html?id=simple-pipeline&lang=en)
- [Column lineage](https://lineage.overme.cn/demo.html?id=column-basic&lang=en)
- [Transformation](https://lineage.overme.cn/demo.html?id=column-transform&lang=en)

Each demo exposes its input JSON, field selection, path highlighting, diagnostics, and component events.

## Why lineage-viewer

Full data-governance platforms combine ingestion, storage, permissions, and collaboration. Many products only need a focused viewer that can be embedded into an existing interface.

lineage-viewer is:

- **Lightweight** — no runtime framework dependency.
- **Embeddable** — a standard Web Component for vanilla JavaScript, React, Vue, or iframe scenarios.
- **Customizable** — schema-driven and ready for existing table, job, dataset, or field lineage JSON.

It does not parse SQL, discover lineage, or store metadata. Those concerns can be added through independent adapters.

The optional [SQLGlot Adapter](docs/sqlglot-adapter.md) converts `SELECT`, `JOIN`, aliases, and
aggregates into Viewer JSON from Python without adding SQL parsing to the Web Component.
The dependency-free [OpenLineage Adapter](docs/openlineage-adapter.md) converts RunEvent jobs,
datasets, schemas, and column lineage facets into the same Viewer schema.

## Quick start

Install the published package from npm:

```sh
npm install lineage-viewer
```

```html
<lineage-viewer></lineage-viewer>
```

```ts
import "lineage-viewer/define";
```

## Project status

The current stable version is `1.1.0`. Public schemas, exported types, component properties, methods, and events follow Semantic Versioning; breaking changes are reserved for a new major version.

## Live demo

The production demo is [lineage.overme.cn](https://lineage.overme.cn). The site supports Simplified Chinese and English, defaults to Chinese, and accepts `?lang=zh-CN` or `?lang=en`. The language switcher stores the preference and preserves the language parameter on the current page. Stable demo URLs use `/demo.html?id=<demo-id>`; the Playground is `/playground.html`.

## Technical capabilities

- TypeScript, native browser APIs, ESM, Web Components, Shadow DOM, and SVG.
- JSON validation, normalization, stable diagnostics, and strict/lenient modes.
- Table, column, and mixed lineage with field-level transforms and recursive path highlighting.
- Table/field name search, data-type filtering, and strict/lenient validation.
- Deterministic layered layout in `LR`, `RL`, `TB`, and `BT`; zoom, pan, fit, reset, focus, and selection.
- A static Demo Gallery, JSON Playground, minimal vanilla/React/Vue examples, and host-consumable events.

### Implemented foundations

The repository includes Vite, Vitest, Playwright, ESLint, Prettier, packaging, and CI baselines. Its deterministic layout performs SCC condensation, longest-path ranking, stable layer ordering, basic crossing reduction, and disconnected-block packing. The SVG viewer has nodes, edges, arrowheads, empty/invalid states, and `ResizeObserver`-aware sizing. `examples/vanilla/`, `examples/react/`, and `examples/vue/` provide minimal integration examples; the demo site provides multiple scenarios, read-only JSON, diagnostics, and event inspection.

Its technical principles are TypeScript strict mode, native browser APIs and ESM, zero runtime dependencies where practical, separation of schema/graph/layout/rendering/interaction responsibilities, synthetic data in public examples, and explicit custom-element registration instead of import-time global side effects.

## Use cases

Use lineage-viewer to visualize standardized nodes and edges for warehouses, ETL pipelines, jobs, datasets, or fields. It is a viewer, not a lineage-extraction or data-governance platform: it does not parse SQL, discover lineage, scan databases or schedulers, store metadata, manage users, edit graphs, or replace Apache Atlas or DataHub.

## Complete integration example

Install from npm:

```sh
npm install lineage-viewer
```

```html
<lineage-viewer id="viewer"></lineage-viewer>
```

```ts
import "lineage-viewer/define";

const viewer = document.querySelector("#viewer") as import("lineage-viewer").LineageViewerElement;
viewer.data = {
  nodes: [
    { id: "ods_orders", label: "ODS Orders", subtitle: "Raw order data" },
    { id: "dwd_orders", label: "DWD Order Details", subtitle: "Normalized order details" },
  ],
  edges: [{ id: "edge_1", source: "ods_orders", target: "dwd_orders", label: "Transform" }],
};
```

```css
lineage-viewer {
  display: block;
  width: 100%;
  height: 600px;
}
```

## Installation

lineage-viewer runs in modern browsers with Custom Elements, Shadow DOM, SVG, `ResizeObserver`, and ES modules; it is not a Node.js runtime library. Use the npm command above for normal installation. Run `npm pack` and install the resulting tarball only when validating unpublished local changes.

## Basic usage

`lineage-viewer/define` registers `<lineage-viewer>` automatically. The root entry has no side effect and supports explicit registration:

```ts
import { defineLineageViewer } from "lineage-viewer";
defineLineageViewer();
```

Set graph input using `data` or `setData()`. Mutations to an already assigned object are not observed, so assign it again or call `setData()` after changing it.

## JSON data format

`schemaVersion` is optional or `"1.0"`; `nodes` and `edges` must be arrays. Node `id` values are unique, and each edge `source` and `target` must reference an existing node. Labels are always plain text.

```json
{
  "schemaVersion": "1.0",
  "nodes": [{ "id": "orders", "label": "Orders" }],
  "edges": []
}
```

See [data schema and diagnostics](docs/data-schema.md) for all fields, diagnostic codes, and validation rules.

## Column lineage

Fields are rows inside table nodes. Add `fields` to nodes and pair `sourceField` with `targetField` on a column edge:

```ts
viewer.data = {
  nodes: [
    {
      id: "raw_orders",
      label: "RAW_ORDERS",
      fields: [{ id: "amount_cents", dataType: "bigint" }],
    },
    {
      id: "fct_orders",
      label: "FCT_ORDERS",
      fields: [{ id: "amount_usd", dataType: "decimal(18,2)" }],
    },
  ],
  edges: [
    {
      source: "raw_orders",
      target: "fct_orders",
      sourceField: "amount_cents",
      targetField: "amount_usd",
      transformType: "transform",
      expression: "amount_cents / 100.0",
    },
  ],
};
viewer.options = { viewMode: "column", highlightMode: "both" };
```

Use `table`, `column`, or `mixed` view mode; `mixed` is the default. Search by table/field name or filter fields by data type:

```ts
viewer.search("amount");
viewer.search("", { dataType: "bigint" });
viewer.searchFields("decimal"); // matches field, table, or type and focuses the first result
viewer.clearSearch();
```

See the [column lineage guide](docs/column-lineage.md) and runnable examples:

- [`examples/column-basic/`](examples/column-basic/)
- [`examples/column-transform/`](examples/column-transform/)
- [`examples/mixed-lineage/`](examples/mixed-lineage/)
- [`examples/sqlglot-adapter/`](examples/sqlglot-adapter/) — SQL to generated column lineage
- [`examples/openlineage-adapter/`](examples/openlineage-adapter/) — RunEvent to job, dataset, and
  column lineage

## Web Component properties

All inputs are JavaScript properties; no HTML attributes are observed or synchronized. Reading `options` returns a resolved read-only snapshot; setting it accepts a partial options patch. Defaults include `direction: "LR"`, `validationMode: "lenient"`, `highlightMode: "connected"`, and `viewMode: "mixed"`. `selectedNodeId`, `selectedField`, and `searchResults` are read-only.

## JavaScript API

The public API includes data/options, viewport controls, node/field selection, `search()`, `searchFields()`, `focusField()`, `clearSearch()`, and `destroy()`. Unknown node or field IDs are ignored. See the [public API](docs/public-api.md).

## Events

The component dispatches bubbling, composed `CustomEvent`s including `lineage-node-click`, `lineage-field-click`, `lineage-edge-click`, and `lineage-selection-change`. Edge click details include source, target, transform type, and expression. See [public API](docs/public-api.md) for all event shapes.

## Highlighting and interaction

Mouse-wheel zoom is anchored at the pointer; drag blank canvas to pan. Clicking a node or field selects it and emits events; clicking blank canvas clears selection. `highlightMode` accepts `connected`, `both`, `upstream`, `downstream`, or `none`.

## Strict and lenient modes

The default `lenient` mode retains recoverable data where possible and reports diagnostics. `strict` mode produces no graph if any error occurs. Invalid root shapes and unsupported Schema versions are unrecoverable in both modes. The first valid duplicate node wins; duplicate edges are deduplicated. Self-loops are hidden unless `showSelfLoops` is enabled.

## iframe embedding

Embed the hosted demo directly when you do not need cross-window API control:

```html
<iframe
  title="lineage-viewer live demo"
  src="https://lineage.overme.cn/?lang=en"
  width="100%"
  height="720"
></iframe>
```

To render your own data, install the component in the host page and assign `data` instead of relying on the demo iframe.

## Local development

Node.js `>=22.13.0` is required.

```sh
npm ci
npm run check
```

Playwright may require `npx playwright install chromium` in a fresh environment.

## Build commands

```sh
npm run dev
npm run typecheck
npm run lint
npm run format:check
npm test
npm run test:e2e
npm run build
npm run build:site
npm run preview:site
npm run pack:check
npm run test:package
npm run screenshot:gallery
npm run screenshot:playground
```

`build` writes ESM and declarations to `dist`; `build:site` writes the static site to `site-dist`. Deploy with `npx wrangler deploy` after configuring Cloudflare credentials.

`wrangler.jsonc` configures `site-dist/` as Cloudflare Workers Static Assets. The `cloudflare.yml` workflow builds and deploys the site on pushes to `main` or manual dispatch; configure `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in the repository first. Run the screenshot commands only when intentionally updating the documentation screenshots above.

## Browser compatibility

Modern browsers with Custom Elements, Shadow DOM, SVG, `ResizeObserver`, and ES modules are supported. The project does not claim compatibility with legacy browsers or Node.js runtimes.

## Roadmap

Core viewer phases 1–9 and the stable 1.x kernel are complete. Post-1.0 work focuses on ecosystem package polish and production host integration. See the [roadmap](docs/roadmap.md) and the [M1 + M2 issue backlog](docs/milestones-m1-m2.md). Enterprise React hosts can follow the [production integration guide](docs/production-integration.md).

## Known limitations

Layout uses a fixed node width and field-row height and does not measure text, avoid obstacles, add dummy nodes for long edges, provide complete orthogonal routing, or guarantee minimum crossings. Cyclic SCCs use a deterministic same-layer mini-stack. `readonly` is currently stored but has no distinct interaction behavior. Internal Shadow DOM classes, SVG structure, and generated IDs are not compatibility guarantees.

## Contributing

Issues and pull requests are welcome. Read [CONTRIBUTING.md](./CONTRIBUTING.md), run relevant checks before submitting, and avoid generated or unrelated changes. See [release readiness](docs/release-readiness.md) for the release checklist. All public examples and tests use synthetic data. Report security issues privately as described in [SECURITY.md](./SECURITY.md).

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
