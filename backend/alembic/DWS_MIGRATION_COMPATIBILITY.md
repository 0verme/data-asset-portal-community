# GaussDB/DWS revision compatibility contract

> Scope: repository revisions `0002`–`0012` and the JDBC-backed DWS upgrade runner. This matrix is a source audit, not a claim of live GaussDB/DWS 8.1.3 validation. DWS transaction/DDL behavior remains **NOT RUN** until the maintainer executes `REAL_DWS_VALIDATION.md` on the target release.

| Revision | DDL change | DML / backfill | Reflection / Inspector | DWS syntax / adapter finding | Transaction / recovery risk | Reuse and test strategy |
|---|---|---|---|---|---|---|
| `0002_portable_asset_filter` | Add non-unique `(layer_code, domain_code)` index on `p_asset_table` | None | Inspector `get_indexes` validates an existing index and rejects a mismatched definition | Schema-qualified `CREATE INDEX`; use configured physical schema. Audit found all baselines omitted the revision index; this Issue adds it to each canonical baseline and makes the revision idempotent so fresh baseline installs can safely stamp 0001 then upgrade. | One DDL statement; a failed create must leave the ledger unchanged. Existing same-name/wrong-definition index is a hard failure. | Alembic operation can be reused with DWS `get_indexes` reflection and DWS index syntax. Test baseline parity, schema-qualified SQL, idempotent baseline upgrade, and mismatched index rejection. |
| `0003_open_repository_modules` | Create 12 module tables and their indexes when all are absent | None | `Inspector.has_table` for each table; aborts on partial table set | Current fresh DWS baseline contains these tables already. Existing installs missing them need the DWS baseline's distribution/constraint conventions; generic FK DDL is not acceptable because DWS physical FKs are intentionally omitted. DWS table-creation adapter required. | Many DDL statements; partial creation is possible if DDL is not transactional. Existing migration explicitly rejects a partial table set; adapter must preserve that fail-closed behavior and safe retry semantics. | DWS adapter sourced from the canonical DWS table definitions; recording/fault-injection tests for no-op, all-absent, partial and mid-sequence failure. |
| `0004_metadata_ingestion_identity` | Add six `p_asset_table` columns and three lineage columns; remove `UNIQUE(table_name)`; add unique `(source_key, asset_type, external_id)` | No explicit row-value backfill | `get_columns`, `get_unique_constraints`, `get_indexes`; SQLite-only table rebuild/copy | SQLite batch rebuild is not applicable. DWS current baseline already has latest columns/identity; DWS index/unique catalog reflection and constraint DDL need validation. DWS adapter/reflection required. | DDL may be multi-step; retry must recognize each completed column/index and not overwrite data. | Share existing migration logic where supported; DWS adapter/reflection tests for pre-existing and partially present shape, plus data-preservation checks. |
| `0005_rbac_persistence` | Create 3 RBAC tables and permission lookup index if absent | None | `has_table`, `get_columns`, `get_indexes` | Current baseline has these tables. Generic foreign-key clauses must not create physical DWS FKs; table distribution follows the DWS baseline. DWS create-table adapter required for old installations. | Multiple DDL statements and partial table shapes. Existing code refuses incomplete existing RBAC tables. | Reuse shape validation; test absent, complete, partial, FK omission and failure before ledger advance. |
| `0006_field_mapping_upstream_id` | Set nullability, add logical FK and unique index on `(upstream_system_id, source_table_name)` | Backfill upstream-system identity; reject missing/ambiguous/conflicting mappings and duplicates | SQLAlchemy table reflection; Inspector columns, FKs and indexes | Backfill semantics must be preserved. DWS does not use physical FKs; the adapter must treat that as an explicit logical-relationship policy, not as a reflection failure. Unique index and nullability DDL require DWS verification. | Backfill must not commit before its validation succeeds; if DDL cannot roll back, retry must detect index/nullability state while leaving the revision ledger at 0005. | Reuse data-selection/validation semantics; DWS adapter for FK/nullability/index operations. Test successful and ambiguous backfill, unchanged primary keys/business rows, partial-DDL retry. |
| `0007_binary_status_contract` | Change default and check constraint; SQLite alone rebuilds the table | Normalize `active` → `enabled`, `draft` → `disabled` | Inspector check constraints; table existence | DWS path uses generic ALTER DEFAULT / CHECK operations; check-constraint catalog support and DWS syntax require adapter verification. Do not run SQLite table rebuild on DWS. | Backfill and multiple constraint DDL may be non-atomic; repeated updates are value-idempotent, but check/default state must be inspected before retry. | Preserve logical status transformation; DWS-specific DDL/reflection tests with legacy and canonical constraints and retained row IDs. |
| `0008_indicator_semantic_contract` | Add four nullable/defaulted columns and a non-unique reference index | Backfill semantic state; resolve exact unique asset/field matches only | `has_table`, `get_columns`, `get_indexes`, SQLAlchemy table reflection | Current DWS baseline already includes these columns/index. Backfill uses SQLAlchemy Core and must execute via JDBC; DWS schema-aware reflection/index syntax needs validation. | Null-only updates are repeatable; a partially added set of columns must be individually detected. Index creation must not advance ledger on error. | Reuse semantic matching algorithm; DWS JDBC adapter tests plus old-data preservation, ambiguous-match and repeat-apply tests. |
| `0009_upstream_option_contract` | None | Idempotently add missing option categories/items; retain existing values | `has_table`, SQLAlchemy table reflection | Core SELECT/INSERT and `?` bind parameters must work through JDBC; no DWS-only SQL intended. | Existing max+1 ID allocation and inserts must share a transaction where supported; rerun must not duplicate item codes. | Direct logical reuse through JDBC adapter; tests for existing custom items, repeat apply and injected failure. |
| `0010_field_mapping_identity` | Drop obsolete source-only unique index; add non-unique five-column identity index | None; deliberately preserves rows | `has_table`, `get_indexes`, `get_unique_constraints` | Current DWS baseline already has the final identity index. DWS catalog reflection and `DROP INDEX` schema behavior need an adapter; reject unexpected remaining unique source-only constraints. | A drop followed by failed create leaves a detectable partial state; ledger remains at 0009 and retry rechecks both indexes. | Reuse validation rules; DWS reflection/DDL tests for old, final, conflicting and partially applied index states. |
| `0011_push_job_freq_desc_capacity` | `p_push_job.freq_desc` has text capacity >= 1000 | yes: column type reflection | yes | only a recognized text type below 1000 is pending; an unrecognized type is a conflict | widen the column explicitly with `ALTER COLUMN ... TYPE VARCHAR(1000)` |
| `0012_search_hot_keywords` | Create `p_search_hot_keyword` from the canonical DWS baseline if absent; validate its columns, primary/unique keys, and types | Add only missing neutral recommendations; preserve existing rows and customizations | yes: table/column/PK/unique reflection plus row query | absence or missing seed rows is pending; a partial or mismatched table is a conflict. Uses canonical schema-qualified DWS DDL, including `DISTRIBUTE BY REPLICATION`. | DDL may survive failure; re-inspect before retry. Seed insertion is additive and checked before each write. | DWS adapter tests cover table creation, missing defaults, preserved disabled/custom rows, retry and fail-closed shape mismatch. Real DWS execution remains NOT RUN. |

## Ledger and authoring rules

1. The ledger value must be a known Alembic revision on the repository's single head. Unknown values fail closed; they are never treated as an unmanaged/fresh database.
2. Fresh DWS executes the complete canonical `dws.sql`, verifies its schema, and then advances through the revision runner to the *dynamically discovered repository head*. Structural revisions are adopted from the verified baseline; additive seed revisions (`0009` and `0012`) still execute because the schema baseline does not represent their rows. It does not replay changes already represented by that baseline.
3. Existing DWS executes every missing revision in order. A revision value is persisted only after that revision's post-condition is confirmed. A failed or partially applied revision is never stamped complete.
4. DWS may use a JDBC-specific dialect/runner and per-revision adapter. Each adapter must declare the physical schema, DWS syntax/constraint/distribution policy, retry/partial-state checks, and tests; do not silently skip a revision or maintain the fresh baseline alone. A test asserts that every Alembic revision except `0001_baseline` has a registered DWS adapter.
5. DDL rollback guarantees for DWS 8.1.3 are unverified. Until live validation establishes otherwise, design as if DDL may leave partial physical state: make steps idempotent when safe, detect unsafe partial state, retain the old ledger, report the failed revision/step, and require explicit recovery rather than silently advancing.
6. Downgrades remain unsupported. Tests use isolated disposable SQLite databases, recording JDBC connections or clearly identified disposable integration schemas. The Agent must not connect to or alter a maintainer production database.

## Legacy `0001_baseline` ambiguity audit

### Why `revision = 0001_baseline` is ambiguous

GaussDB/DWS fresh installs always executed the *current* canonical `dws.sql` and stamped only `0001_baseline`. Because `dws.sql` kept absorbing new feature structures, two instances with the same ledger value can have different physical schemas:

```text
instance A: revision=0001_baseline, physical schema ~ early baseline
instance B: revision=0001_baseline, physical schema ~ complete current baseline
```

Git history confirms the released baselines form a *prefix* of the revision chain: each structural revision's `dws.sql` change landed in the same commit that introduced the revision.

| Baseline commit | Release | Baseline change |
|---|---|---|
| `43d6548` | baseline | 24 tables; no RBAC/open-module tables; `p_asset_table.table_name` unique; no indicator semantic columns |
| `7a438a4` | #118 | + `0003` open repository module tables |
| `47f4bf6` | #119 | + `0004` metadata ingestion identity columns/unique |
| `9ac81d4` | #123 | + `0005` RBAC tables |
| `f090887` | #196 | + `0006` field mapping upstream identity |
| `a76521f` | #200 | + `0007` binary status contract |
| `71a8921` | #210 | + `0008` indicator semantic columns/index |
| `2ee912f` | #235 | `0009` is data-only; **no** baseline change |
| `d37c8b4` | #301 | + `0010` field mapping identity index |
| this Issue | #313 | + `0002` portable filter index in every canonical baseline |
| `973c709` | #317 | + `0011` `p_push_job.freq_desc` widened to `VARCHAR(1000)` in every canonical baseline |
| this Issue | #321 | + `0012` search recommendation table and minimal neutral defaults in every canonical baseline |

Consequences:

* `revision == 0001_baseline` never means "replay `0002`..`0010`"; it means "inspect the physical schema and adopt every revision whose post-condition already holds".
* `0002` is missing from every released baseline, so even a nearly-head legacy instance still needs that one index.
* `0009` is a data-only revision that no schema baseline can represent, so fresh installs and existing upgrades must still execute its additive seed.
* `0012` represents both a new table and its defaults: canonical current baselines already contain the table, but the adapter still inserts only missing defaults; older instances create the table from canonical DWS DDL before seeding.

### Resolution contract

The runner combines the ledger with physical post-condition inspection:

```text
ledger revision
  + schema post-condition inspection
  -> per-revision action
```

Every adapter returns exactly one of three states:

| State | Meaning | Runner action |
|---|---|---|
| `APPLIED` | the complete post-condition already exists | adopt; normalize the ledger only |
| `NOT_APPLIED` | the revision did not run, or only its documented, provably idempotent and non-destructive completion is missing | execute the adapter |
| `CONFLICT` | the observed state is neither the pre-condition nor the post-condition | fail closed; never guess, delete or rebuild |

After `NOT_APPLIED` execution the adapter is inspected again; the ledger advances only after the post-condition is confirmed. If a revision fails, the ledger stays at the last fully confirmed revision and the next run re-inspects the physical state.

### Revision state matrix

| Revision | Expected post-condition | Detectable? | Safe to skip when satisfied? | Partial state possible? | Repair strategy |
|---|---|---|---|---|---|
| `0002_portable_asset_filter` | non-unique `(layer_code, domain_code)` index on `p_asset_table` | yes: index reflection | yes | only a same-name/wrong-definition index, which is a conflict | create/drop the index explicitly so it matches the definition |
| `0003_open_repository_modules` | all 12 open-module tables exist | yes: table reflection | yes | yes (interrupted create) | complete or drop the partial table set explicitly; never auto-rebuild |
| `0004_metadata_ingestion_identity` | 6 asset identity columns + `UNIQUE(source_key, asset_type, external_id)` + 3 lineage columns; `UNIQUE(table_name)` gone | yes: column/unique reflection | yes | yes, but only two documented safely-completable shapes: (a) legacy asset side with new lineage columns from the canonical `0003` adapter; (b) new asset side with additive lineage columns pending | any other mix is a conflict; complete/revert the asset identity contract explicitly |
| `0005_rbac_persistence` | 3 RBAC tables with expected columns + `idx_p_role_permission_permission` | yes: table/column/index reflection | yes | yes (partial table set or missing index) | complete or drop the partial RBAC table set explicitly |
| `0006_field_mapping_upstream_id` | `upstream_system_id` NOT NULL, backfilled rows, unique `(upstream_system_id, source_table_name)` (or its `0010` successor index) | yes: column/nullability/index reflection + pure backfill plan | yes | backfill is planned before any write; ambiguous/duplicate data is a conflict, never a guess | fix `p_upstream_system`/`upstream_system_id` explicitly, or resolve duplicate mapping keys |
| `0007_binary_status_contract` | default `enabled`, canonical `status_code IN ('enabled','disabled')` check, no `active`/`draft` rows | yes: column default + check catalog + row scan | yes | convergent: rows are normalized and non-canonical status checks replaced; unknown status values are a conflict | normalize unsupported status values explicitly |
| `0008_indicator_semantic_contract` | 4 semantic columns + `idx_p_indicator_semantic_ref` + exact-unique reference backfill | yes: column/index reflection + pure match plan | yes | columns present without the index is a conflict; columns+index with an incomplete backfill is safely re-entrant (NULL-only fills) | complete the columns together with the index, or revert them explicitly |
| `0009_upstream_option_contract` | all required option categories/items exist | yes: data query by stable code | yes | additive by construction: any missing subset is safe to complete | none required; existing/customized rows are never overwritten |
| `0010_field_mapping_identity` | obsolete `idx_p_field_mapping_table_uk_01` gone, five-column non-unique `idx_p_field_mapping_table_identity` present, no other source-only unique key | yes: index/unique reflection | yes | obsolete + identity together, or neither, is a conflict | remove the obsolete source-only unique index explicitly before retrying |
| `0011_push_job_freq_desc_capacity` | `p_push_job.freq_desc` is text with capacity >= 1000 (or unlimited) | yes: column type reflection | yes | only a recognized text type < 1000 is pending; an unrecognized type is a conflict | widen `freq_desc` to `VARCHAR(1000)`; never truncate or rewrite data |
| `0012_search_hot_keywords` | canonical `p_search_hot_keyword` shape and all neutral default rows are present | yes: table/column/PK/unique reflection + seed query | yes | absent table or missing default subset is additive; mismatched shape is a conflict | create the table from canonical DWS baseline DDL if absent, then insert only missing `(keyword, category)` defaults |

### DWS-specific constraints encoded by the adapters

* **No physical foreign keys.** DWS does not support them; `0006` records the upstream relation as a logical `upstream_system_id` column + unique index only, matching the canonical `dws.sql` policy from #303.
* **No `CREATE INDEX IF NOT EXISTS`.** The adapters inspect the index first and then emit plain `CREATE INDEX` (GaussDB 8.1.3 rejects `IF NOT EXISTS`, see #304).
* **Distribution clauses are preserved** by creating missing `0003`/`0005` tables from the canonical baseline statements instead of duplicating historical DDL.
* **`0009` seeds only missing codes**; an existing customized row with the same `item_code` is never overwritten or duplicated.
* **`0012` creates from canonical DWS DDL and seeds only missing `(keyword, category)` rows**; existing keywords, enabled state, sort order, IDs, and custom rows are never overwritten.
* **Check-constraint detection for `0007`** uses `pg_constraint` + `pg_get_constraintdef`; this query is part of the maintainer's real-DWS validation checklist.
* **DDL transactionality is assumed unsafe.** The runner commits each revision only after its post-condition is confirmed; if DWS auto-commits DDL, an interrupted revision is re-inspected and either safely resumed or reported as a conflict.
