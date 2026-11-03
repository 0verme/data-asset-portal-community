# Real GaussDB/DWS 8.1.3 validation record

**Status: NOT RUN.** The Agent has not connected to a maintainer DWS instance. Do not treat this checklist as evidence of a successful live migration. Execute it only after the DWS JDBC revision runner and adapters are merged and the maintainer confirms the target is a disposable validation schema or has an approved backup/recovery window.

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
- The runner uses the same read-only metadata queries as the preflight plus one extra check-constraint query for revision `0007`:

  ```sql
  SELECT c.conname, pg_get_constraintdef(c.oid)
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = ? AND t.relname = ? AND c.contype = 'c'
  ORDER BY c.conname
  ```

  Confirm this query executes on 8.1.3. If it does not, `0007` must fail closed and the adapter needs a DWS-specific check-constraint reflection before the runner is accepted.

## Legacy `0001_baseline` note

`revision = 0001_baseline` does not mean the schema is old. Released `dws.sql` baselines form a prefix of the revision chain, so the runner inspects the physical schema and adopts every satisfied revision before executing anything. When preparing a controlled legacy snapshot, construct it from a known released baseline (for example, the 0001-era schema) and record which structures it contains; do not assume the ledger value alone describes it. See `DWS_MIGRATION_COMPATIBILITY.md` for the per-revision post-conditions.

## `0013` large-table index preflight

When `0013_field_filter_index` must build its non-unique index on a populated `p_field_mapping_field`, treat it as a potentially high-impact operation: index construction reads the table and can consume significant I/O, storage/temporary space and elapsed time. GaussDB 8.1.3 lock duration and write availability have **NOT RUN** in this validation; do not assume online or concurrent index-build semantics.

Before approving the `0013` action, record the table row count/size, available storage, write workload, backup/snapshot and recovery plan, and the approved maintenance window. The maintainer must confirm the unverified lock/write impact is acceptable. If not, stop; do not run the revision or try to drop/replace an existing index. In an authorized isolated validation copy, record build duration, observed lock/write impact, resource use, resulting index definition and ledger before/after.

## GaussDB timestamp default normalization check

1. Use a restorable non-production validation copy with a valid DWS baseline and ledger. Confirm the profile's physical schema is the intended `dap` schema; do not probe other business schemas.
2. Run `dws_verify_metadata_preflight.py --profile <profile>` and require all five catalog queries plus `SchemaModel normalization` to pass.
3. Run `schema_migrate.py verify --profile <profile>` and require `verify=ok`. Confirm catalog defaults reported as `pg_systimestamp()` for timestamp columns compare equal to canonical `CURRENT_TIMESTAMP`; the check must not suppress unrelated missing or different defaults.
4. On a separate disposable copy only, remove the default from `p_system.system_abbr` using the DBA-approved GaussDB procedure. Run `verify` and require a non-zero result identifying `default.system_abbr` as drift. Restore that copy and confirm `verify=ok` again. Never alter the real validation schema for this negative control.
5. Record the repository SHA, profile name (not connection details), DWS version, schema name only if approved for internal notes, command exit status and redacted mismatch summary.

## Scenario 1 — fresh install (isolated empty schema)

1. Confirm the target schema exists and contains no application tables; capture the preflight report.
2. Run `schema_migrate.py status --profile <profile>` and confirm the result is unmanaged (and prints the repository head).
3. Run `schema_migrate.py plan --profile <profile>` and review the baseline + `after-baseline` actions.
4. Run `schema_migrate.py apply --profile <profile>`. The CLI executes the canonical baseline, verifies it, records `0001_baseline`, then adopts every structural revision and applies the additive seeds in `0009`, `0012` and `0014` until the ledger reaches head. `0014` stores only a reserved, inactive RAG settings row in existing parameter tables. Retail `UPSTREAM_DEPT` values are excluded from ordinary migration and require the separate explicit Community Demo seed.
5. Run `schema_migrate.py status --profile <profile>` and confirm it reports the repository's current logical head, not `0001_baseline`.
6. Run `schema_migrate.py verify --profile <profile>`; require `verify=ok`.
7. Confirm ordinary migration initialized RBAC/default menus and the platform `UPSTREAM_DB_TYPE` options; a fresh schema migration must not create retail `UPSTREAM_DEPT` Demo rows. If validating Community Demo, apply its separate explicit seed as an opt-in and verify the complete fictional retail department set. Repeat ordinary `apply` and verify it is a no-op for the ledger and adds no duplicate technical seed rows.
8. Record DWS version (not host/user), profile schema name only if approved for internal notes, repository SHA, command exit status, logical revision, and row/table-count evidence.

## Scenario 2 — existing legacy `0001_baseline` upgrade (controlled snapshot)

1. Use a restorable copy or a disposable schema created from a released legacy baseline. Do not use a production schema without an approved backup/recovery window.
2. Capture `status` (likely `0001_baseline`) and the read-only DWS metadata preflight.
3. Run `plan`; review every action. A nearly-head instance must show `adopt` for satisfied revisions, `apply` for `0002_portable_asset_filter`, `0013_field_filter_index` when the non-unique field lookup index is absent, and `apply` for `0009`, `0012` or `0014` only when their additive seed rows are absent.
4. Capture representative business-row counts and stable primary keys for field mappings, indicators, assets/fields, manual code values, upstream systems and upstream options. Protect or anonymize data in retained evidence.
5. Run `apply` once. Require each revision to be reflected in the ledger only after its post-condition is confirmed. On any error, stop; capture the failed revision/step and current ledger, and do not blindly rerun or repair the schema. A `CONFLICT` message lists the revision, observed state, why it is unsafe and the possible repairs.
6. Run `status` and `verify`; require repository head and `verify=ok`.
7. Recheck representative row counts, primary keys, backfilled `upstream_system_id`/`source_asset_id`/`result_field_id` values, new fields, indexes/constraints, RBAC and menus. Confirm business rows and existing historical `UPSTREAM_DEPT` values were preserved; `0009` adds only missing platform `UPSTREAM_DB_TYPE` values, `0012` does not duplicate or overwrite customized search-hot-keyword rows, and `0014` leaves exactly one inactive reserved RAG config category/item without overwriting its value. No historical department rows may be deleted as part of this audit fix.
8. Confirm the physical metadata that the runner relies on:
   * columns: `p_asset_table` identity columns, `p_lineage_snapshot` ingestion columns, `p_indicator_item` semantic columns, `p_push_job.freq_desc` at `VARCHAR(1000)` (revision `0011`), and `p_search_hot_keyword` with its category-scoped uniqueness (revision `0012`);
   * indexes: `idx_p_asset_table_filter`, `idx_p_indicator_semantic_ref`, `idx_p_field_mapping_table_identity`, and the absence of `idx_p_field_mapping_table_uk_01`;
   * constraints: `UNIQUE(source_key, asset_type, external_id)` on `p_asset_table`, no `UNIQUE(table_name)`, the `status_code IN ('enabled','disabled')` check on `p_manual_code_table`, and `UNIQUE(keyword, category)` on `p_search_hot_keyword`;
   * logical relationships: `p_field_mapping_table.upstream_system_id` references an existing `p_upstream_system.system_pk` (no physical FK on DWS);
   * parameter settings: one `RAG_SEARCH_CONFIG/DEFAULT` row with category and item both inactive (`N`); the row must be absent from generic parameter-list and public common-code responses;
   * ledger: exactly one row, equal to the repository head.
9. Run `apply` a second time, then `status` and `verify`; require no revision changes and no duplicate data (Scenario 3).

## Scenario 3 — repeat apply at head

1. Run `schema_migrate.py apply --profile <profile>` again.
2. Require `applied=-`, no revision change, no DDL/DML and no duplicate seed rows; `status` must report head and `verify` must remain `ok`.

## Scenario 4 — metadata and ledger confirmation

1. Re-run the read-only metadata preflight; all five metadata SQL queries and semantic `SchemaModel` normalization must pass, including the `0007` check-constraint query above.
2. Compare reflected columns/indexes/constraints against `schema_migrate.py verify`; require `verify=ok`.
3. Confirm the `alembic_version` table contains exactly one row equal to the repository head.
4. Record the DWS DDL/transaction observations: whether a failed `ALTER TABLE`/`CREATE INDEX` auto-committed, and whether the ledger stayed at the previous revision (the runner design assumes DDL may auto-commit).

## Failure / recovery test (disposable copy only)

- Never inject a failure into production or an instance with unbacked business data.
- On a restorable copy, inject a controlled failure in a later revision after at least one preceding revision succeeded.
- Record the old/current revision, completed revision(s), failed revision and step, transaction/autocommit observations, and actual schema/data state.
- Require the ledger to remain at the last fully completed revision. Verify the failed revision is either safely repeatable or explicitly reported as partial and blocked pending documented recovery; no automatic stamp/skip is allowed.
- Restore the copy and repeat the normal upgrade, then verify head, repeat-apply no-op and data preservation.

## Evidence

| Scenario | Repository SHA | DWS 8.1.3 confirmed | `status` before → after | `plan` | `apply` | `verify` | Repeat | Data preservation | Result / notes |
|---|---|---|---|---|---|---|---|---|---|
| Scenario 1 fresh install | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | Pending maintainer validation |
| Scenario 2 legacy `0001_baseline` upgrade | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | Pending maintainer validation |
| Scenario 3 repeat apply at head | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | Pending maintainer validation |
| Scenario 4 metadata + `0007` check query | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | Pending maintainer validation |
| Failure / recovery copy | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | Pending isolated fault-injection validation |
