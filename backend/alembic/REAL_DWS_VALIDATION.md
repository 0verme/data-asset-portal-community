# Real GaussDB/DWS 8.1.3 validation record

**Status: NOT RUN.** The Agent has not connected to a maintainer DWS instance. Do not treat this checklist as evidence of a successful live migration. Execute it only after the DWS JDBC revision runner and adapters in this Issue are merged and the maintainer confirms the target is a disposable validation schema or has an approved backup/recovery window.

Record only profile names and results here; never add credentials, JDBC URLs, hostnames, user names, or production data.

## Preconditions

- Confirm GaussDB/DWS version is 8.1.3 and the configured profile points to the intended physical schema.
- Confirm maintenance window, application quiescence, backup/snapshot, restore procedure, available disk, and that no Agent is using this database.
- Confirm schema metadata preflight passes both stages: all five metadata SQL queries execute/fetch, and semantic reflection normalizes catalog values and builds a non-empty `SchemaModel`:

  ```sh
  python backend/scripts/dws_verify_metadata_preflight.py --profile <profile>
  ```

  A SQL-only PASS is insufficient. Before any write-capable migration command, capture the read-only `status` and `plan` output and stop for maintainer review of each revision action.

- For an empty schema only, also run the DWS baseline preflight. It refuses non-empty schemas and rolls back its probes:

  ```sh
  python backend/scripts/dws_schema_preflight.py --profile <profile>
  ```

- Do not run fresh-install preflight against an existing deployment. Do not create/drop schemas as part of this checklist unless the maintainer has explicitly designated an isolated disposable target.
- The runner uses the same read-only metadata queries as the preflight plus a check-constraint query used by revisions `0007` and `0012`:

  ```sql
  SELECT c.conname, pg_get_constraintdef(c.oid)
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = ? AND t.relname = ? AND c.contype = 'c'
  ORDER BY c.conname
  ```

  Confirm this query executes on 8.1.3 for both `p_manual_code_table` (`0007`) and `p_search_hot_keyword` (`0012`). If it does not, the corresponding revision must fail closed and its adapter needs a DWS-specific check-constraint reflection before the runner is accepted.

## Legacy `0001_baseline` note

`revision = 0001_baseline` does not mean the schema is old. Released `dws.sql` baselines form a prefix of the revision chain, so the runner inspects the physical schema and adopts every satisfied revision before executing anything. When preparing a controlled legacy snapshot, construct it from a known released baseline (for example, the 0001-era schema) and record which structures it contains; do not assume the ledger value alone describes it. See `DWS_MIGRATION_COMPATIBILITY.md` for the per-revision post-conditions.

## Scenario 1 — fresh install (isolated empty schema)

1. Confirm the target schema exists and contains no application tables; capture the preflight report.
2. Run `schema_migrate.py status --profile <profile>` and confirm the result is unmanaged (and prints the repository head).
3. Run `schema_migrate.py plan --profile <profile>` and review the baseline + `after-baseline` actions.
4. Run `schema_migrate.py apply --profile <profile>`. The CLI executes the canonical baseline, verifies it, records `0001_baseline`, then adopts satisfied structural revisions and applies the additive `UPSTREAM_DB_TYPE` (`0009`) and search recommendation (`0012`) seeds until the ledger reaches the dynamically discovered repository head. Retail `UPSTREAM_DEPT` values are excluded from ordinary migration and require the separate explicit Community Demo seed.
5. Run `schema_migrate.py status --profile <profile>` and confirm it reports the repository's current logical head, not `0001_baseline`.
6. Run `schema_migrate.py verify --profile <profile>`; require `verify=ok`. This checks the physical baseline, exact ledger head, and every registered revision post-condition (including data-only seeds and check constraints).
7. Confirm ordinary migration initialized RBAC/default menus and the platform `UPSTREAM_DB_TYPE` options; a fresh schema migration must not create retail `UPSTREAM_DEPT` Demo rows. If validating Community Demo, apply its separate explicit seed as an opt-in and verify the complete fictional retail department set. Repeat ordinary `apply` and verify it is a no-op for the ledger and adds no duplicate technical seed rows.
8. Record DWS version (not host/user), profile schema name only if approved for internal notes, repository SHA, command exit status, logical revision, and row/table-count evidence.

## Scenario 2 — existing legacy `0001_baseline` upgrade (controlled snapshot)

1. Use a restorable copy or a disposable schema created from a released legacy baseline. Do not use a production schema without an approved backup/recovery window.
2. Capture `status` (likely `0001_baseline`) and the read-only DWS metadata preflight.
3. Run `plan`; review every action. A nearly-head instance must show `adopt` for satisfied revisions, `apply` for `0002_portable_asset_filter`, and `apply` for `0009_upstream_option_contract` / `0012_search_hot_keywords` / `0013_field_filter_index` when their additive seed rows are absent.
4. Capture representative business-row counts and stable primary keys for field mappings, indicators, assets/fields, manual code values, upstream systems and upstream options. Protect or anonymize data in retained evidence.
5. Run `apply` once. Require each revision to be reflected in the ledger only after its post-condition is confirmed. On any error, stop; capture the failed revision/step and current ledger, and do not blindly rerun or repair the schema. A `CONFLICT` message lists the revision, observed state, why it is unsafe and the possible repairs.
6. Run `status` and `verify`; require repository head and `verify=ok`.
7. Recheck representative row counts, primary keys, backfilled `upstream_system_id`/`source_asset_id`/`result_field_id` values, new fields, indexes/constraints, RBAC and menus. Confirm business rows and existing historical `UPSTREAM_DEPT` values were preserved; `0009` adds only missing platform `UPSTREAM_DB_TYPE` values, and `0012` does not duplicate or overwrite customized recommendation rows. No historical department rows may be deleted as part of this audit fix.
8. Confirm the physical metadata that the runner relies on:
   * columns: `p_asset_table` identity columns, `p_lineage_snapshot` ingestion columns, `p_indicator_item` semantic columns, `p_push_job.freq_desc` at `VARCHAR(1000)` (revision `0011`), and `p_search_hot_keyword` with its category-scoped uniqueness (revision `0012`);
   * indexes: `idx_p_asset_table_filter`, `idx_p_indicator_semantic_ref`, `idx_p_field_mapping_table_identity`, and the absence of `idx_p_field_mapping_table_uk_01`;
   * constraints: `UNIQUE(source_key, asset_type, external_id)` on `p_asset_table`, no `UNIQUE(table_name)`, the `status_code IN ('enabled','disabled')` check on `p_manual_code_table`, and `UNIQUE(keyword, category)` on `p_search_hot_keyword`;
   * logical relationships: `p_field_mapping_table.upstream_system_id` references an existing `p_upstream_system.system_pk` (no physical FK on DWS);
   * ledger: exactly one row, equal to the repository head.
9. Run `apply` a second time, then `status` and `verify`; require no revision changes and no duplicate data (Scenario 5).

## Scenario 3 — existing revision `0005_rbac_persistence` upgrade

1. Restore a disposable copy captured at a known logical `0005_rbac_persistence` state; do not manufacture it by deleting tables from a real instance. Confirm `status` reports `0005_rbac_persistence` and review the read-only plan from `0006` onward.
2. Capture counts and stable primary keys for field mappings, assets, indicators, manual code rows, upstream systems/options, and RBAC rows. Include at least one unambiguous field mapping suitable for the `0006` backfill.
3. Apply once. Require strict order `0006` → ... → the dynamically discovered current repository head (currently `0012`); record each result. Stop on any conflict/error.
4. Verify head and schema. Confirm old PKs/business values remain, `upstream_system_id` backfill matches its upstream system, indicator references match unique assets/fields, old status values are normalized without row loss, and the additive `0009` / `0012` seeds appear once.
5. Repeat `apply`; require no duplicate codes/recommendations and unchanged business rows.

## Scenario 4 — existing revision `0009_upstream_option_contract` upgrade

1. Restore a disposable copy captured at `0009`; confirm `status` reports that exact revision and plan contains only `0010`, `0011`, and `0012`.
2. Record field-mapping IDs/rows, the `freq_desc` declared type and representative multibyte values, existing search recommendations including custom/disabled rows, and code option rows.
3. Apply; require order `0010` → `0011` → `0012`, head in the ledger, removal of the obsolete unique index, creation of the five-column identity index, `freq_desc` capacity ≥1000, and only missing search defaults added.
4. Compare old values, IDs, and counts. Repeat apply and require no new rows or other mutations.

## Scenario 5 — repeat apply at head

1. Run `schema_migrate.py apply --profile <profile>` again.
2. Require `applied=-`, no revision change, no revision DDL/DML and no duplicate seed rows; `status` must report head and `verify` must remain `ok`.

## Scenario 6 — metadata and ledger confirmation

1. Re-run the read-only metadata preflight; all five metadata SQL queries and semantic `SchemaModel` normalization must pass. Also run the `pg_constraint` check query above for both `0007` and `0012`.
2. Compare reflected columns/indexes/constraints and revision-specific post-conditions against `schema_migrate.py verify`; require `verify=ok`. The command checks every adapter, including data-only seeds and the `0007`/`0012` check constraints.
3. Confirm the `alembic_version` table contains exactly one row equal to the repository head.
4. Record the DWS DDL/transaction observations: whether a failed `ALTER TABLE`/`CREATE INDEX` auto-committed, and whether the ledger stayed at the previous revision (the runner design assumes DDL may auto-commit).

## Scenario 7 — unknown revision and failure/recovery (disposable copy only)

Never inject a failure into production or an instance with unbacked business data. Use a restorable copy and a JDBC test harness that injects failures at the client boundary; do not change production grants, create speculative triggers, or manually drop application objects.

### Unknown revision

- On a disposable copy, preserve a backup, replace its ledger value with a sentinel such as `9999_unknown`, then run `status`, `plan`, `apply`, and `verify`.
- Require every command to fail closed before schema/data mutation; preserve the unknown ledger value and compare schema/data snapshots.
- Discard/restore only the explicitly disposable copy after capturing evidence.

### Partial revision execution

- Inject failure during an explicitly selected adapter step on a disposable copy (for example, `0008` after its additive columns/index but during the NULL-only backfill).
- Record the prior ledger, durable DDL/DML observed after reconnect, failed statement, transaction/autocommit behavior, row counts and PKs.
- Require ledger to remain at the last fully completed revision. Retry only if the adapter classifies the observed state as safely completable; otherwise require its conflict message and documented manual repair. Never expect generic rollback to undo DWS DDL.

### Ledger write failure after verified DDL

- Intercept and fail one revision-ledger `UPDATE` after an adapter's DDL has succeeded and its postcondition has been reflected; do not break the separate disposable schema's DDL or alter its grants.
- Require the command to stop before the next revision and retain the previous ledger value. Reconnect and inspect the ledger and physical object. Retry `apply`; it must adopt the already-completed revision rather than replay its DDL, then continue in order.
- Separately test fresh-baseline ledger `INSERT` failure. If the canonical baseline is complete, retry may recover only after full physical verification; if a column/table is missing, retry must fail closed and not stamp `0001`.

### Transaction observations and completion

- Record whether DDL was transactionally rolled back, auto-committed, or left partial; whether DML rollback/savepoints work for the tested statements; and whether a failed commit acknowledgement leaves the old or target ledger on a fresh connection. Do not infer PostgreSQL behavior.
- Restore the disposable copy and run the normal upgrade from its known starting revision. Verify head, repeat-apply no-op, old data/PK preservation, and no duplicate seeds.

## Evidence

| Scenario | Repository SHA | DWS 8.1.3 confirmed | `status` before → after | `plan` | `apply` | `verify` | Repeat | Data preservation | Result / notes |
|---|---|---|---|---|---|---|---|---|---|
| Scenario 1 fresh install | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | Pending maintainer validation |
| Scenario 2 legacy `0001_baseline` upgrade | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | Pending maintainer validation |
| Scenario 3 legacy `0005` upgrade | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | Pending maintainer validation |
| Scenario 4 legacy `0009` upgrade | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | Pending maintainer validation |
| Scenario 5 repeat apply at head | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | Pending maintainer validation |
| Scenario 6 metadata + `0007`/`0012` check queries | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | Pending maintainer validation |
| Scenario 7 unknown revision / partial revision / ledger write failure | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | Pending isolated fault-injection validation |
