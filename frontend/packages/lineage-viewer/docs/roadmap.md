# Roadmap

No phase has a release-date commitment. Version numbers below are planning labels, not promises.

## Core product (1.0 foundation)

| Status    | Phase                                              |
| --------- | -------------------------------------------------- |
| Completed | Phase 1: Product contract                          |
| Completed | Phase 2: Schema and graph normalization            |
| Completed | Phase 3: Minimal Web Component and SVG renderer    |
| Completed | Phase 4: Deterministic layered layout              |
| Completed | Phase 5: Viewport, selection, highlight and events |
| Completed | Phase 6: Demo Gallery                              |
| Completed | Phase 7: JSON Playground                           |
| Completed | Phase 8: Documentation and direct integration      |
| Completed | Phase 9: React and Vue examples                    |
| Deferred  | Phase 10: iframe integration                       |
| Deferred  | Phase 11: Streamlit component                      |
| Deferred  | Phase 12: PyWebIO recipe                           |

Phases 1–9 shipped the stable `lineage-viewer` kernel (1.0) plus demo surfaces. Phases 10–12 stay deferred until a host needs those embed targets.

## Post-1.0: ecosystem and production hosts

After 1.0, work focuses on **getting data in**, **embedding in real hosts**, and **making production graphs usable**—not on turning the viewer into a governance platform.

| Status   | Milestone | Theme                                                 | Target label         |
| -------- | --------- | ----------------------------------------------------- | -------------------- |
| Current  | M1        | Ecosystem publish polish and consistency              | `1.1.x`              |
| Planned  | M2        | Production host reference shell                       | `1.2.0`              |
| Planned  | M3        | Adapter depth and distribution                        | adapters / `1.2–1.3` |
| Planned  | M4        | Large-graph usability and export                      | `1.3.0`              |
| Planned  | M5        | Accessibility and interaction polish                  | `1.4.0`              |
| Deferred | M6        | Extra embed surfaces (iframe API, Streamlit, PyWebIO) | demand-driven        |

Issue-level tasks and acceptance criteria for the active slice: [M1 + M2 backlog](./milestones-m1-m2.md).

### M1 — Ecosystem publish polish (`1.1.x`)

Make the 1.1.0 workspace packages **installable, version-aligned, and copy-pasteable**.

- Publish / registry policy for `lineage-viewer` and `@lineage-viewer/*`
- Docs and README version consistency
- Minimal end-to-end path: domain graph → adapter → React canvas → detail callback
- Release checklist coverage for workspace packages

### M2 — Production host reference (`1.2.0`)

Prove the product story: **viewer is the kernel; the host is the product**.

- Read-only reference shell (toolbar, search, detail side panel, root-neighborhood fit)
- Subgraph contract (truncation, depth, diagnostics) documented with synthetic fixtures
- Consumer / e2e coverage for the host path
- Site entry for production integration

### M3 — Adapter depth (parallel / follow-on)

Keep extraction out of the core package; deepen independent adapters.

- SQLGlot / OpenLineage packaging and boundary docs
- Optional new adapter only when demand is clear (for example dbt manifest or job DAG JSON)
- `domain-adapter` presets and label policies as needed

### M4 — Large-graph usability (`1.3.0`)

Address documented limits without becoming a general graph editor.

- Host-side size thresholds and truncation guidance
- Field-density strategies (related-fields expand preferred over full virtualization first)
- Optional SVG / PNG export
- Constrained layout improvements only when fixtures justify them

### M5 — Accessibility and interaction polish (`1.4.0`)

- Keyboard navigation and focus model
- Real semantics for reserved options such as `readonly` if still needed
- Touch / contrast refinements driven by host feedback

### M6 — Deferred embed surfaces

Maps to core Phases 10–12. Open only when a real host cannot consume npm in-page:

- iframe data channel (not the public demo iframe alone)
- Streamlit component
- PyWebIO recipe

## Status definitions

- **Completed:** accepted work with its required verification.
- **Current:** the active milestone or phase.
- **Planned:** intended work that has not started or is not yet the focus.
- **Deferred:** deliberately postponed pending a stable core API and demonstrated need.
- **Out of scope:** capabilities outside the viewer boundary, including extraction inside the core package, metadata storage, governance, authentication, and general graph editing.

## Non-goals (unchanged)

- SQL parsing or auto-discovery inside `lineage-viewer`
- Metadata storage, identity, authorization, or collaboration
- Replacing Apache Atlas, DataHub, or similar platforms
- A general-purpose graph editor

## Suggested sequencing

```text
M1 polish ──► M2 production host shell ──► M4 large graph / export
    │                  │
    └──── M3 adapters (parallel) ────┘
                     │
                     ▼
              M5 / M6 on demand
```
