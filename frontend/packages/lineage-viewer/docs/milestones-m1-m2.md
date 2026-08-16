# M1 + M2 issue backlog

Planning backlog for the Post-1.0 slice described in [roadmap.md](./roadmap.md).
These are **issue-level** work items, not a release promise. Labels:

| Label        | Meaning                               |
| ------------ | ------------------------------------- |
| `m1`         | Ecosystem publish polish (`1.1.x`)    |
| `m2`         | Production host reference (`1.2.0`)   |
| `docs`       | Documentation only                    |
| `release`    | Publish / checklist / CI              |
| `example`    | Runnable example or site surface      |
| `test`       | Unit, package-consumer, or Playwright |
| `blocked-by` | Soft dependency on another issue      |

Suggested GitHub title prefix: `[M1]` / `[M2]`.

---

## M1 — Ecosystem publish polish

**Milestone goal:** A new host can install aligned packages, follow one happy path, and render a domain graph with selection callbacks in under 30 minutes.

**Out of scope for M1:** new adapters, layout algorithms, export, accessibility overhaul, Streamlit/iframe products.

### Issue M1-01 — Decide and document scoped-package publish policy

| Field  | Value                                                               |
| ------ | ------------------------------------------------------------------- |
| Labels | `m1`, `docs`, `release`                                             |
| Area   | `packages/*`, `docs/production-integration.md`, `docs/releasing.md` |

**Problem**
`@lineage-viewer/domain-adapter` and `@lineage-viewer/react` use `publishConfig.access: restricted`. Hosts need a single documented story: public npm, private registry only, or both.

**Work**

- [ ] Choose the default distribution story for `@lineage-viewer/*`.
- [ ] Document install paths for public vs private registry.
- [ ] If private-only, state how version alignment with `lineage-viewer` is verified.
- [ ] If public, list required `publishConfig` / workflow changes (implementation may be M1-02).

**Acceptance**

- [ ] `docs/production-integration.md` states exactly where each package is expected to be installed from.
- [ ] A first-time integrator can tell whether `npm install @lineage-viewer/react` works on public npm without reading source.
- [ ] No contradictory “published / not published” wording remains in README or production docs.

---

### Issue M1-02 — Align release workflow with workspace packages

| Field      | Value                                                                     |
| ---------- | ------------------------------------------------------------------------- |
| Labels     | `m1`, `release`                                                           |
| Area       | `.github/workflows/release.yml`, `scripts/*`, `docs/release-readiness.md` |
| Depends on | M1-01 (policy)                                                            |

**Problem**
Release docs and checks are oriented to the root package; workspace packages may not share the same version gate, pack check, or publish path.

**Work**

- [ ] Extend release readiness so the three packages share one planned version (today `1.1.0`).
- [ ] Ensure `npm run pack:check` / consumer checks cover workspace packages (already partial—verify gaps).
- [ ] Document or implement publish steps for `@lineage-viewer/*` consistent with M1-01.
- [ ] Fail CI or checklist clearly if versions drift across the three packages.

**Acceptance**

- [ ] `docs/release-readiness.md` includes a workspace version-alignment step.
- [ ] `npm run pack:check` fails or reports if a workspace package is unpackable.
- [ ] Written publish steps match the chosen policy (public or private).
- [ ] No secret credentials are committed.

---

### Issue M1-03 — Version and status consistency across public docs

| Field  | Value                                                                     |
| ------ | ------------------------------------------------------------------------- |
| Labels | `m1`, `docs`                                                              |
| Area   | `README.md`, `README.en.md`, `docs/product-scope.md`, site i18n if needed |

**Problem**
Public docs still mix 1.0 / 1.1 messaging; some product docs still read as pre-implementation.

**Work**

- [ ] Align “current stable / current packages” language with `package.json` (`1.1.0` or next patch).
- [ ] Update English README roadmap blurb (still mentions planned direct integration examples).
- [ ] Clean historical “not yet present / future Demo Gallery” wording in product docs or mark as archive notes.
- [ ] Point both READMEs at Post-1.0 roadmap + this backlog.

**Acceptance**

- [ ] Searching docs for the previous major/minor as “current stable” does not contradict `package.json`.
- [ ] README EN/ZH roadmap sections describe ecosystem / production-host direction, not obsolete Phase 8/9 “planned next”.
- [ ] `docs/roadmap.md` is linked as the source of truth for phase status.

---

### Issue M1-04 — Minimal production path example (domain-adapter + React)

| Field  | Value                                             |
| ------ | ------------------------------------------------- |
| Labels | `m1`, `example`                                   |
| Area   | `examples/` (new or extended), optional site link |

**Problem**
`production-integration.md` describes the flow, but there is no single runnable minimal example that wires:

`domain graph → toViewerGraph → LineageViewerCanvas → detail callback`.

**Work**

- [ ] Add a small example (for example `examples/production-host-min/` or extend `examples/react/`) using **synthetic** domain data only.
- [ ] Show `toViewerGraph` mapping options and at least one node/field/edge callback updating a simple detail region.
- [ ] Demonstrate `initialFit` / root-neighborhood fit if `getRootNeighborhoodNodeIds` (or equivalent) is part of the public adapter API; otherwise document the host-side ID list.
- [ ] Add a short README in the example folder with install and run commands.

**Acceptance**

- [ ] Example runs with the repo’s documented Node version and no private credentials.
- [ ] Clicking a node or field updates visible detail text without console errors.
- [ ] Example does not import internal `src/` paths; it consumes package entry points (workspace or built dist as existing examples do).
- [ ] README states the example is synthetic and not a metadata backend.

---

### Issue M1-05 — Package consumer coverage for the M1 happy path

| Field      | Value                                                        |
| ---------- | ------------------------------------------------------------ |
| Labels     | `m1`, `test`                                                 |
| Area       | `test-consumers/`, `scripts/test-package.mjs`, package tests |
| Depends on | M1-04                                                        |

**Problem**
Root package consumers exist; the domain-adapter + React composition path needs an automated smoke signal.

**Work**

- [ ] Add or extend a package-consumer (or workspace test) that imports `@lineage-viewer/domain-adapter` and `@lineage-viewer/react`.
- [ ] Assert `toViewerGraph` output is accepted by the viewer / canvas types.
- [ ] Keep the test offline and synthetic.

**Acceptance**

- [ ] `npm run test:package` (or documented equivalent) covers the composition path.
- [ ] Failure messages name the missing package or type error clearly.
- [ ] CI job that already runs package tests picks this up without a new flaky browser dependency unless necessary.

---

### Issue M1-06 — M1 exit review

| Field      | Value                   |
| ---------- | ----------------------- |
| Labels     | `m1`, `docs`, `release` |
| Depends on | M1-01 … M1-05           |

**Acceptance (milestone)**

- [ ] Policy + release path documented (M1-01, M1-02).
- [ ] Public docs consistent (M1-03).
- [ ] Runnable minimal path (M1-04) + automated smoke (M1-05).
- [ ] [roadmap.md](./roadmap.md) can move M1 from **Current** to **Completed** and M2 to **Current**.
- [ ] CHANGELOG has a patch/minor note only if user-facing docs or packages changed in a released way.

---

## M2 — Production host reference shell

**Milestone goal:** An integrating team can fork a reference host, replace `fetchSubgraph()`, and keep toolbar, detail panel, and fit behavior without forking the viewer.

**Out of scope for M2:** real backends, auth, large-graph virtualization, PNG/SVG export productization (track under M4), new embed runtimes (M6).

### Issue M2-01 — Subgraph contract documentation

| Field  | Value                                                           |
| ------ | --------------------------------------------------------------- |
| Labels | `m2`, `docs`                                                    |
| Area   | `docs/production-integration.md` or `docs/subgraph-contract.md` |

**Problem**
Hosts own pagination, truncation, and neighborhood expansion, but the expected payload shape and failure modes are underspecified.

**Work**

- [ ] Document a recommended host subgraph DTO (synthetic): e.g. `rootId`, `nodes`, `edges`, `truncated`, `depth`, `reason`, optional `evidence` on edges.
- [ ] Document mapping into `toViewerGraph` and what stays in edge/node metadata.
- [ ] Document size guidance (soft limits) and how to surface diagnostics / warnings in the host UI.
- [ ] Document expansion pattern: “load depth 1 → user expands node → host fetches and merges”.

**Acceptance**

- [ ] A backend engineer can implement `GET /subgraph?root=&depth=` from the doc alone.
- [ ] Contract states viewer non-goals (no server calls inside the component).
- [ ] At least one full synthetic JSON fixture is linked from the doc.

---

### Issue M2-02 — Synthetic subgraph fixtures

| Field      | Value                            |
| ---------- | -------------------------------- |
| Labels     | `m2`, `example`, `test`          |
| Area       | `examples/` or `tests/fixtures/` |
| Depends on | M2-01                            |

**Work**

- [ ] Add fixtures: small neighborhood, truncated graph (`truncated: true`), column lineage with transform evidence, empty/error diagnostics case.
- [ ] Keep all data synthetic; no customer schemas.

**Acceptance**

- [ ] Fixtures validate against the documented contract.
- [ ] At least two fixtures are reused by the reference shell and tests.

---

### Issue M2-03 — Reference host shell UI

| Field      | Value                                                         |
| ---------- | ------------------------------------------------------------- |
| Labels     | `m2`, `example`                                               |
| Area       | `examples/production-host/` (recommended) or site app section |
| Depends on | M1-04, M2-02                                                  |

**Work**

- [ ] Read-only shell with:
  - Toolbar: direction, `viewMode`, `highlightMode`, search
  - Canvas: `LineageViewerCanvas` (or equivalent) with root-neighborhood initial fit
  - Side panel: selected node / field / edge detail including transform + evidence when present
- [ ] Swap fixtures via a simple selector (no network required).
- [ ] Optional stub `fetchSubgraph(rootId, depth)` that reads local fixtures to show the extension point.
- [ ] README: architecture diagram in text, what to replace, and non-goals.

**Acceptance**

- [ ] Cold start shows a readable root neighborhood (not a tiny full-graph fit unless fixture is tiny).
- [ ] Changing view mode and highlight mode updates the graph without reload.
- [ ] Search focuses or lists matches as supported by the public API.
- [ ] Selecting node/field/edge fills the side panel from event payloads / metadata.
- [ ] Truncated fixture shows an explicit host-level banner or panel note.
- [ ] No edits to graph topology in the UI.

---

### Issue M2-04 — Site entry for production integration

| Field      | Value                     |
| ---------- | ------------------------- |
| Labels     | `m2`, `docs`, `example`   |
| Area       | `site/`, `docs/README.md` |
| Depends on | M2-03                     |

**Work**

- [ ] Add a discoverable entry (demo card, docs nav, or site page) linking to production integration docs and/or the reference shell.
- [ ] Keep i18n parity if the site already dual-languages that surface.

**Acceptance**

- [ ] From the live site nav or docs index, a user can reach production integration without GitHub code search.
- [ ] Link targets resolve in both local `build:site` and production URL conventions used today.

---

### Issue M2-05 — Playwright (or equivalent) host-path regression

| Field      | Value                        |
| ---------- | ---------------------------- |
| Labels     | `m2`, `test`                 |
| Area       | `tests/`, Playwright configs |
| Depends on | M2-03                        |

**Work**

- [ ] E2E: load reference shell → select node → detail text appears.
- [ ] E2E: select field edge with transform → expression/evidence visible.
- [ ] E2E: truncated fixture shows host warning affordance.
- [ ] Stable selectors; no dependency on internal Shadow DOM class names beyond public behavior.

**Acceptance**

- [ ] Tests pass in CI with the same browser install story as existing e2e.
- [ ] Failures indicate shell regressions, not demo-gallery unrelated noise.

---

### Issue M2-06 — 1.2.0 release packaging for host story

| Field      | Value                   |
| ---------- | ----------------------- |
| Labels     | `m2`, `release`, `docs` |
| Depends on | M2-01 … M2-05, M1 exit  |

**Work**

- [ ] CHANGELOG section for 1.2.0 (or next minor): reference shell, subgraph contract, docs/site entry.
- [ ] Confirm three packages remain version-aligned if APIs changed; otherwise document “docs/examples-only” release.
- [ ] Run full release readiness checklist.
- [ ] Update roadmap statuses (M2 completed; set next Current, likely M3 or M4).

**Acceptance**

- [ ] Release readiness checklist completed on a clean tree.
- [ ] README “why lineage-viewer” / integration sections link the reference host.
- [ ] Roadmap table matches reality after the release tag.

---

### Issue M2-07 — M2 exit review

| Field      | Value |
| ---------- | ----- |
| Labels     | `m2`  |
| Depends on | M2-06 |

**Acceptance (milestone)**

- [ ] Subgraph contract + fixtures published in-repo.
- [ ] Reference shell is forkable: replace one data function, keep UI shell.
- [ ] Automated regression covers select → detail and truncation messaging.
- [ ] Site/docs discovery path exists.
- [ ] Integrating team time-to-first-subgraph (local fixtures) is documented as the M2 success metric.

---

## Suggested implementation order

```text
M1-01 policy
  └─► M1-02 release alignment
M1-03 docs consistency          (parallel)
M1-04 min example ─► M1-05 consumer test ─► M1-06 exit
                         │
                         ▼
              M2-01 contract ─► M2-02 fixtures
                         │
                         ▼
              M2-03 reference shell ─► M2-05 e2e
                         │
                         ▼
              M2-04 site entry ─► M2-06 release ─► M2-07 exit
```

## Tracking tips

- One PR can close multiple small issues if verification stays clear.
- Prefer issues that leave the tree releasable after each merge (docs-only and example-only slices first).
- Do not open M4 export/virtualization work inside M2 PRs; link them as follow-ups.
- Keep all fixtures and demos synthetic (project policy).
