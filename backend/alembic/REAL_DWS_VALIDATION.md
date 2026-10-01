# Real GaussDB/DWS 8.1.3 validation record

**Status: NOT RUN.** The Agent has not connected to a maintainer DWS instance. Do not treat this checklist as evidence of a successful live migration. Execute it only after the DWS JDBC revision runner and adapters in this Issue are merged and the maintainer confirms the target is a disposable validation schema or has an approved backup/recovery window.

Record only profile names and results here; never add credentials, JDBC URLs, hostnames, user names, or production data.

## Preconditions

- Confirm GaussDB/DWS version is 8.1.3 and the configured profile points to the intended physical schema.
- Confirm maintenance window, application quiescence, backup/snapshot, restore procedure, available disk, and that no Agent is using this database.
- Confirm schema metadata preflight passes:

  ```sh
  python backend/scripts/dws_verify_metadata_preflight.py --profile <profile>
  ```

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

## Scenario 1 — fresh install (isolated empty schema)

1. Confirm the target schema exists and contains no application tables; capture the preflight report.
2. Run `schema_migrate.py status --profile <profile>` and confirm the result is unmanaged (and prints the repository head).
3. Run `schema_migrate.py plan --profile <profile>` and review the baseline + `after-baseline` actions.
4. Run `schema_migrate.py apply --profile <profile>`. The CLI executes the canonical baseline, verifies it, records `0001_baseline`, then adopts every structural revision and applies the `0009` option seed until the ledger reaches head.
5. Run `schema_migrate.py status --profile <profile>` and confirm it reports the repository's current logical head, not `0001_baseline`.
6. Run `schema_migrate.py verify --profile <profile>`; require `verify=ok`.
7. Confirm the migration CLI initialized RBAC and default menus, and that `p_code_category`/`p_code_item` contain the `UPSTREAM_DB_TYPE`/`UPSTREAM_DEPT` options; repeat `apply` and verify it is a no-op for schema revisions and inserts no duplicate seed rows.
8. Record DWS version (not host/user), profile schema name only if approved for internal notes, repository SHA, command exit status, logical revision, and row/table-count evidence.

## Scenario 2 — existing legacy `0001_baseline` upgrade (controlled snapshot)

1. Use a restorable copy or a disposable schema created from a released legacy baseline. Do not use a production schema without an approved backup/recovery window.
2. Capture `status` (likely `0001_baseline`) and the read-only DWS metadata preflight.
3. Run `plan`; review every action. A nearly-head instance must show `adopt` for satisfied revisions, `apply` for `0002_portable_asset_filter`, and `apply` for `0009_upstream_option_contract` when the option rows are absent.
4. Capture representative business-row counts and stable primary keys for field mappings, indicators, assets/fields, manual code values, upstream systems and upstream options. Protect or anonymize data in retained evidence.
5. Run `apply` once. Require each revision to be reflected in the ledger only after its post-condition is confirmed. On any error, stop; capture the failed revision/step and current ledger, and do not blindly rerun or repair the schema. A `CONFLICT` message lists the revision, observed state, why it is unsafe and the possible repairs.
6. Run `status` and `verify`; require repository head and `verify=ok`.
7. Recheck representative row counts, primary keys, backfilled `upstream_system_id`/`source_asset_id`/`result_field_id` values, new fields, indexes/constraints, RBAC and menus. Confirm business rows were preserved, `0009` did not duplicate or overwrite customized option rows, and no duplicate backfill rows appeared.
8. Confirm the physical metadata that the runner relies on:
   * columns: `p_asset_table` identity columns, `p_lineage_snapshot` ingestion columns, `p_indicator_item` semantic columns, `p_push_job.freq_desc` at `VARCHAR(1000)` (revision `0011`);
   * indexes: `idx_p_asset_table_filter`, `idx_p_indicator_semantic_ref`, `idx_p_field_mapping_table_identity`, and the absence of `idx_p_field_mapping_table_uk_01`;
   * constraints: `UNIQUE(source_key, asset_type, external_id)` on `p_asset_table`, no `UNIQUE(table_name)`, and the `status_code IN ('enabled','disabled')` check on `p_manual_code_table`;
   * logical relationships: `p_field_mapping_table.upstream_system_id` references an existing `p_upstream_system.system_pk` (no physical FK on DWS);
   * ledger: exactly one row, equal to the repository head.
9. Run `apply` a second time, then `status` and `verify`; require no revision changes and no duplicate data (Scenario 3).

## Scenario 3 — repeat apply at head

1. Run `schema_migrate.py apply --profile <profile>` again.
2. Require `applied=-`, no revision change, no DDL/DML and no duplicate seed rows; `status` must report head and `verify` must remain `ok`.

## Scenario 4 — metadata and ledger confirmation

1. Re-run the read-only metadata preflight; all queries must pass, including the `0007` check-constraint query above.
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
