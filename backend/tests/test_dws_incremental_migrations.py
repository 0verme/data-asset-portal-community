"""Incremental GaussDB/DWS migration contract tests.

These tests drive the real DWS runner and revision adapters against an
in-memory simulation of the DWS catalog surface.  They cover the legacy
``0001_baseline`` ambiguity (released baselines represent a *prefix* of the
revision chain), adoption of an already-satisfied schema, fail-closed partial
states, ledger advancement ordering and data preservation.

Real GaussDB/DWS 8.1.3 execution is intentionally NOT RUN here; see
``backend/alembic/REAL_DWS_VALIDATION.md``.
"""

from __future__ import annotations

import contextlib
import io
import unittest
from types import SimpleNamespace
from unittest import mock

from backend.app.migrations import dws_revisions, dws_runner
from backend.app.migrations.dws_revisions import (
    DwsMigrationError,
    RevisionState,
    get_adapter,
)
from backend.app.migrations.dws_runner import (
    apply_revisions,
    inspect_revision,
    plan_revisions,
    repository_head,
    revision_chain,
)
from backend.app.migrations.schema import (
    baseline_table_statements,
    initialize,
    verify_database,
)
from backend.tests.dws_fake_database import (
    FakeDwsDatabase,
    OPEN_MODULE_TABLES,
    REVISION_ORDER,
    downgrade_to_prefix,
)

CONFIG = {"type": "gaussdb", "schema": "dap"}


def _seed_legacy_business_rows(
    database: FakeDwsDatabase, *, include_upstream: bool = True
) -> None:
    if include_upstream:
        database.table("p_data_source").add_row(
            {
                "source_id": 1,
                "source_code": "MEM",
                "source_name": "Member",
                "source_type": "relational",
                "status_code": "enabled",
                "is_deleted": "N",
            }
        )
        database.table("p_upstream_system").add_row(
            {
                "system_pk": 101,
                "data_source_id": 1,
                "system_id": "up_member",
                "system_abbr": "MEM",
                "system_name": "Member",
                "db_type": "PostgreSQL",
                "host_name": "member.demo.invalid",
                "status_code": "enabled",
                "is_deleted": "N",
            }
        )
        database.table("p_field_mapping_table").add_row(
            {
                "table_pk": 201,
                "data_source_id": 1,
                "upstream_system_id": None,
                "source_table_name": "MEMBER_A",
                "target_layer_code": "DWD",
                "target_table_name": "DWD_MEMBER_A",
                "load_mode": "incr",
                "is_deleted": "N",
            }
        )
    database.table("p_asset_table").add_row(
        {
            "asset_id": 1,
            "table_name": "orders",
            "schema_name": "sales",
            "qualified_name": None,
            "layer_code": "DWD",
            "domain_code": "TRADE",
            "is_deleted": "N",
        }
    )
    database.table("p_asset_field").add_row(
        {"field_id": 11, "asset_id": 1, "field_name": "amount", "is_deleted": "N"}
    )
    database.table("p_indicator_item").add_row(
        {
            "indicator_pk": 1,
            "indicator_id": "SALES_AMT",
            "result_table_name": "orders",
            "result_field_name": "amount",
            "dimension_code": "ord",
            "status_code": "enabled",
            "registrar_name": "migration-test",
            "registered_date": "2026-01-01",
            "is_deleted": "N",
        }
    )
    database.table("p_code_category").add_row(
        {"category_id": 1, "category_code": "UPSTREAM_DB_TYPE", "category_name": "自定义"}
    )
    database.table("p_code_item").add_row(
        {
            "item_id": 1,
            "category_code": "UPSTREAM_DB_TYPE",
            "item_code": "CUSTOM",
            "item_name": "自定义项",
            "item_value": "自定义项",
        }
    )


class DwsAdapterRegistryTests(unittest.TestCase):
    def test_every_alembic_revision_has_a_dws_adapter(self):
        script = dws_runner._script_directory()
        revisions = [
            item.revision
            for item in script.walk_revisions()
            if item.revision != "0001_baseline"
        ]
        missing = [revision for revision in revisions if get_adapter(revision) is None]
        self.assertEqual([], missing)
        self.assertEqual(set(REVISION_ORDER), set(dws_revisions.registered_revisions()))

    def test_unknown_revision_fails_closed(self):
        database = FakeDwsDatabase().seed_from_baseline()
        with self.assertRaises(DwsMigrationError) as error:
            inspect_revision(database, CONFIG, "9999_not_a_revision")
        self.assertIn("no DWS adapter is registered", str(error.exception))

    def test_revision_chain_is_ordered_and_rejects_unknown_start(self):
        head = repository_head()
        chain = revision_chain("0001_baseline", head)
        self.assertEqual(list(REVISION_ORDER), chain)
        self.assertEqual([], revision_chain(head, head))
        with self.assertRaises(DwsMigrationError) as error:
            revision_chain("legacy_unknown", head)
        self.assertIn("not known to this repository", str(error.exception))


class DwsBaselineStatementTests(unittest.TestCase):
    def test_baseline_table_statements_extract_only_requested_tables(self):
        statements = baseline_table_statements(
            "dws", ["p_role", "p_permission", "p_role_permission"]
        )
        joined = "\n".join(statements)
        for table in ("p_role", "p_permission", "p_role_permission"):
            self.assertIn(f"CREATE TABLE IF NOT EXISTS dwp.{table} ", joined)
        self.assertIn("idx_p_role_permission_permission", joined)
        self.assertNotIn("p_asset_table", joined)
        self.assertNotIn("p_indicator_item", joined)
        self.assertFalse(any(sql.lstrip().upper().startswith("ALTER TABLE") for sql in statements))

    def test_open_module_statements_cover_all_twelve_tables(self):
        statements = baseline_table_statements("dws", list(OPEN_MODULE_TABLES))
        joined = "\n".join(statements)
        for table in OPEN_MODULE_TABLES:
            self.assertIn(f"CREATE TABLE IF NOT EXISTS dwp.{table} ", joined)
        self.assertIn("DISTRIBUTE BY REPLICATION", joined)
        self.assertNotIn("p_field_mapping_table", joined)


class DwsFreshAndAdoptionTests(unittest.TestCase):
    def test_fresh_canonical_baseline_adopts_structure_and_seeds_options(self):
        database = FakeDwsDatabase().seed_from_baseline()
        results = apply_revisions(database, CONFIG, "0001_baseline", repository_head())
        actions = {result.revision: result.action for result in results}
        self.assertEqual(
            {
                revision: ("apply" if revision == "0009_upstream_option_contract" else "adopt")
                for revision in REVISION_ORDER
            },
            actions,
        )
        self.assertEqual(repository_head(), database.ledger)
        categories = {row["category_code"] for row in database.table("p_code_category").rows}
        self.assertEqual({"UPSTREAM_DB_TYPE", "UPSTREAM_DEPT"}, categories)
        self.assertEqual(16, len(database.table("p_code_item").rows))

    def test_nearly_head_legacy_only_applies_missing_revision_and_seed(self):
        database = FakeDwsDatabase().seed_from_baseline()
        satisfied = set(REVISION_ORDER) - {"0002_portable_asset_filter"}
        downgrade_to_prefix(database, satisfied)
        before_rows = {
            name: [dict(row) for row in table.rows]
            for name, table in database.tables.items()
        }

        results = apply_revisions(database, CONFIG, "0001_baseline", repository_head())

        actions = {result.revision: result.action for result in results}
        self.assertEqual("apply", actions["0002_portable_asset_filter"])
        self.assertEqual(
            "apply", actions["0009_upstream_option_contract"]
        )
        for revision in satisfied - {"0009_upstream_option_contract"}:
            self.assertEqual("adopt", actions[revision], revision)
        self.assertEqual(repository_head(), database.ledger)

        # No structural replay: only the missing index and the missing option
        # seed were written.  The option seed is additive by contract.
        structural_ddl = [
            sql
            for sql, _ in database.executed
            if sql.lower().startswith(
                ("create table", "alter table", "create unique index", "drop index")
            )
            and "alembic_version" not in sql
        ]
        self.assertEqual([], structural_ddl)
        index_ddl = [
            sql
            for sql, _ in database.executed
            if sql.startswith("CREATE INDEX idx_p_asset_table_filter")
        ]
        self.assertEqual(1, len(index_ddl))

        for name in ("p_asset_table", "p_field_mapping_table", "p_indicator_item"):
            self.assertEqual(before_rows[name], [dict(row) for row in database.table(name).rows])

    def test_initialize_executes_verified_baseline_then_runner_reaches_head(self):
        database = FakeDwsDatabase()
        self.assertTrue(initialize(database, CONFIG, "dws"))
        self.assertEqual("0001_baseline", database.ledger)
        results = apply_revisions(database, CONFIG, "0001_baseline", repository_head())
        self.assertEqual(repository_head(), database.ledger)
        self.assertEqual(
            [r for r in REVISION_ORDER], [result.revision for result in results]
        )
        self.assertEqual(repository_head(), verify_database(database, CONFIG, "dws"))

    def test_head_apply_is_a_no_op(self):
        database = FakeDwsDatabase().seed_from_baseline()
        apply_revisions(database, CONFIG, "0001_baseline", repository_head())
        executed_before = len(database.executed)
        ledger_before = database.ledger

        results = apply_revisions(database, CONFIG, repository_head(), repository_head())

        self.assertEqual([], results)
        self.assertEqual(ledger_before, database.ledger)
        mutations = [
            sql
            for sql, _ in database.executed[executed_before:]
            if sql.upper().startswith(
                ("CREATE", "ALTER", "DROP", "UPDATE", "INSERT", "DELETE")
            )
        ]
        self.assertEqual([], mutations)


class DwsLegacyUpgradeTests(unittest.TestCase):
    def test_truly_old_0001_upgrades_to_head_and_preserves_data(self):
        database = FakeDwsDatabase().seed_from_baseline()
        downgrade_to_prefix(database, set())
        # p_upstream_system is created by 0003, so the 0001-era data source
        # cannot have a matching upstream system yet.  This test covers the
        # structural upgrade and the asset/indicator/code data preservation.
        _seed_legacy_business_rows(database, include_upstream=False)

        results = apply_revisions(database, CONFIG, "0001_baseline", repository_head())

        self.assertEqual([r for r in REVISION_ORDER], [r.revision for r in results])
        actions = {result.revision: result.action for result in results}
        # Every revision is applied on a truly old instance except 0011: the
        # canonical 0003 adapter creates p_push_job with the current (already
        # widened) column, so 0011 adopts it.
        self.assertEqual(
            {"adopt"},
            {actions["0011_push_job_freq_desc_capacity"]},
        )
        self.assertTrue(
            all(
                action == "apply"
                for revision, action in actions.items()
                if revision != "0011_push_job_freq_desc_capacity"
            )
        )
        self.assertEqual(repository_head(), database.ledger)

        asset_columns = set(database.table("p_asset_table").columns)
        self.assertTrue(
            {
                "catalog_name",
                "database_name",
                "source_key",
                "asset_type",
                "external_id",
                "qualified_name",
            }
            <= asset_columns
        )
        self.assertNotIn(
            ("table_name",), database.table("p_asset_table").unique_constraints
        )
        self.assertIn(
            ("source_key", "asset_type", "external_id"),
            database.table("p_asset_table").unique_constraints,
        )
        self.assertTrue(
            {"source_key", "content_hash", "ingestion_id"}
            <= set(database.table("p_lineage_snapshot").columns)
        )
        self.assertTrue(
            {
                "source_asset_id",
                "result_field_id",
                "aggregation_code",
                "semantic_state",
            }
            <= set(database.table("p_indicator_item").columns)
        )
        self.assertIn(
            "idx_p_indicator_semantic_ref",
            database.table("p_indicator_item").indexes,
        )
        self.assertIn(
            "idx_p_field_mapping_table_identity",
            database.table("p_field_mapping_table").indexes,
        )
        self.assertNotIn(
            "idx_p_field_mapping_table_uk_01",
            database.table("p_field_mapping_table").indexes,
        )

        indicator = database.table("p_indicator_item").rows[0]
        self.assertEqual(1, indicator["source_asset_id"])
        self.assertEqual(11, indicator["result_field_id"])
        self.assertEqual("orders", indicator["result_table_name"])
        self.assertEqual("amount", indicator["result_field_name"])
        self.assertEqual(1, database.table("p_asset_table").rows[0]["asset_id"])
        # The upgraded physical schema must satisfy the repository head
        # contract used by `schema_migrate.py verify`.
        self.assertEqual(repository_head(), verify_database(database, CONFIG, "dws"))

    def test_mixed_legacy_resumes_from_first_gap(self):
        database = FakeDwsDatabase().seed_from_baseline()
        satisfied = set(REVISION_ORDER[:4])
        downgrade_to_prefix(database, satisfied)
        _seed_legacy_business_rows(database)
        # 0002-0005 are satisfied, so the upstream system table exists.
        database.table("p_field_mapping_table").rows[0]["upstream_system_id"] = None

        plan = plan_revisions(database, CONFIG, "0001_baseline", repository_head())
        actions = {item.revision: item.action for item in plan}
        for revision in satisfied:
            self.assertEqual("adopt", actions[revision], revision)
        self.assertEqual("apply", actions["0006_field_mapping_upstream_id"])
        self.assertEqual("apply", actions["0007_binary_status_contract"])
        self.assertEqual("apply", actions["0008_indicator_semantic_contract"])
        self.assertEqual("apply", actions["0009_upstream_option_contract"])
        self.assertEqual("pending", actions["0010_field_mapping_identity"])

        results = apply_revisions(database, CONFIG, "0001_baseline", repository_head())
        result_actions = {result.revision: result.action for result in results}
        self.assertEqual("apply", result_actions["0006_field_mapping_upstream_id"])
        self.assertEqual("apply", result_actions["0010_field_mapping_identity"])
        self.assertEqual(repository_head(), database.ledger)

        mapping = database.table("p_field_mapping_table").rows[0]
        self.assertEqual(201, mapping["table_pk"])
        self.assertEqual(101, mapping["upstream_system_id"])
        self.assertEqual("DWD_MEMBER_A", mapping["target_table_name"])
        self.assertEqual("incr", mapping["load_mode"])
        self.assertTrue(
            database.table("p_field_mapping_table").columns["data_source_id"].nullable
        )
        self.assertFalse(
            database.table("p_field_mapping_table").columns["upstream_system_id"].nullable
        )
        self.assertEqual(repository_head(), verify_database(database, CONFIG, "dws"))

    def test_0009_adds_only_missing_items_and_preserves_customized_rows(self):
        database = FakeDwsDatabase().seed_from_baseline()
        satisfied = set(REVISION_ORDER[:7])
        downgrade_to_prefix(database, satisfied)
        database.table("p_code_category").add_row(
            {"category_id": 7, "category_code": "UPSTREAM_DB_TYPE", "category_name": "自定义"}
        )
        database.table("p_code_item").add_row(
            {
                "item_id": 9,
                "category_code": "UPSTREAM_DB_TYPE",
                "item_code": "POSTGRESQL",
                "item_name": "自定义 PostgreSQL",
                "item_value": "自定义 PostgreSQL",
            }
        )

        apply_revisions(database, CONFIG, "0001_baseline", repository_head())

        customized = next(
            row
            for row in database.table("p_code_item").rows
            if row["item_code"] == "POSTGRESQL"
        )
        self.assertEqual("自定义 PostgreSQL", customized["item_value"])
        self.assertEqual(
            1,
            sum(
                1
                for row in database.table("p_code_item").rows
                if row["item_code"] == "POSTGRESQL"
            ),
        )
        category = next(
            row
            for row in database.table("p_code_category").rows
            if row["category_code"] == "UPSTREAM_DB_TYPE"
        )
        self.assertEqual("自定义", category["category_name"])
        self.assertIn(
            "UPSTREAM_DEPT",
            {row["category_code"] for row in database.table("p_code_category").rows},
        )


class DwsPushJobCapacityTests(unittest.TestCase):
    def test_0011_widens_legacy_freq_desc_and_verifies(self):
        database = FakeDwsDatabase().seed_from_baseline()
        downgrade_to_prefix(database, set(REVISION_ORDER[:9]))
        self.assertEqual(
            "VARCHAR(200)",
            database.table("p_push_job").columns["freq_desc"].type_name,
        )
        database.ledger = "0010_field_mapping_identity"

        results = apply_revisions(
            database, CONFIG, "0010_field_mapping_identity", repository_head()
        )

        actions = {result.revision: result.action for result in results}
        self.assertEqual("apply", actions["0011_push_job_freq_desc_capacity"])
        self.assertEqual(
            "VARCHAR(1000)",
            database.table("p_push_job").columns["freq_desc"].type_name,
        )
        self.assertEqual(repository_head(), database.ledger)
        self.assertEqual(repository_head(), verify_database(database, CONFIG, "dws"))

    def test_0011_unknown_column_type_fails_closed(self):
        database = FakeDwsDatabase().seed_from_baseline()
        downgrade_to_prefix(database, set(REVISION_ORDER[:9]))
        database.table("p_push_job").columns["freq_desc"].type_name = "BYTEA"
        database.ledger = "0010_field_mapping_identity"

        inspection = inspect_revision(
            database, CONFIG, "0011_push_job_freq_desc_capacity"
        )
        self.assertIs(RevisionState.CONFLICT, inspection.state)
        self.assertIn("unsupported type", inspection.summary)


class DwsFailClosedTests(unittest.TestCase):
    def _assert_conflict(self, database, revision, start_revision):
        with self.assertRaises(DwsMigrationError) as error:
            apply_revisions(database, CONFIG, start_revision, repository_head())
        self.assertEqual(revision, error.exception.revision)
        self.assertIn("why unsafe", str(error.exception))
        # The ledger must never advance past the conflicting revision; earlier
        # revisions may legitimately have completed first.
        self.assertIn(database.ledger, (start_revision, *REVISION_ORDER))
        if database.ledger in REVISION_ORDER and revision in REVISION_ORDER:
            self.assertLess(
                REVISION_ORDER.index(database.ledger),
                REVISION_ORDER.index(revision),
            )

    def test_partial_indicator_columns_fail_closed(self):
        database = FakeDwsDatabase().seed_from_baseline()
        downgrade_to_prefix(database, set(REVISION_ORDER[:6]))
        database.add_column("p_indicator_item", "source_asset_id", "BIGINT")
        database.add_column("p_indicator_item", "result_field_id", "BIGINT")
        database.ledger = "0007_binary_status_contract"

        inspection = inspect_revision(
            database, CONFIG, "0008_indicator_semantic_contract"
        )
        self.assertIs(RevisionState.CONFLICT, inspection.state)
        self.assertIn("partially present", inspection.summary)
        self._assert_conflict(
            database, "0008_indicator_semantic_contract", "0007_binary_status_contract"
        )

    def test_indicator_columns_without_index_fail_closed(self):
        database = FakeDwsDatabase().seed_from_baseline()
        downgrade_to_prefix(database, set(REVISION_ORDER[:6]))
        for column, type_name in (
            ("source_asset_id", "BIGINT"),
            ("result_field_id", "BIGINT"),
            ("aggregation_code", "VARCHAR(32)"),
            ("semantic_state", "VARCHAR(32)"),
        ):
            database.add_column("p_indicator_item", column, type_name)

        inspection = inspect_revision(
            database, CONFIG, "0008_indicator_semantic_contract"
        )
        self.assertIs(RevisionState.CONFLICT, inspection.state)
        self.assertIn("reference index is missing", inspection.summary)

    def test_0010_with_both_indexes_fail_closed(self):
        database = FakeDwsDatabase().seed_from_baseline()
        downgrade_to_prefix(database, set(REVISION_ORDER[:8]))
        database.add_index(
            "p_field_mapping_table",
            "idx_p_field_mapping_table_uk_01",
            ("upstream_system_id", "source_table_name"),
            unique=True,
        )
        database.add_index(
            "p_field_mapping_table",
            "idx_p_field_mapping_table_identity",
            (
                "upstream_system_id",
                "source_table_name",
                "target_layer_code",
                "target_table_name",
                "load_mode",
            ),
        )
        database.ledger = "0009_upstream_option_contract"

        inspection = inspect_revision(database, CONFIG, "0010_field_mapping_identity")
        self.assertIs(RevisionState.CONFLICT, inspection.state)
        self.assertIn("both the obsolete", inspection.summary)
        self._assert_conflict(
            database, "0010_field_mapping_identity", "0009_upstream_option_contract"
        )

    def test_0007_unknown_status_value_fails_closed(self):
        database = FakeDwsDatabase().seed_from_baseline()
        downgrade_to_prefix(database, set(REVISION_ORDER[:5]))
        database.table("p_manual_code_table").add_row(
            {
                "table_id": 1,
                "table_code": "T1",
                "table_name": "T1",
                "table_style": "enum",
                "status_code": "archived",
            }
        )
        database.ledger = "0005_rbac_persistence"

        inspection = inspect_revision(database, CONFIG, "0007_binary_status_contract")
        self.assertIs(RevisionState.CONFLICT, inspection.state)
        self.assertIn("outside the binary contract", inspection.summary)
        self._assert_conflict(
            database, "0007_binary_status_contract", "0005_rbac_persistence"
        )

    def test_0006_ambiguous_backfill_fails_closed_without_writes(self):
        database = FakeDwsDatabase().seed_from_baseline()
        downgrade_to_prefix(database, set(REVISION_ORDER[:4]))
        database.table("p_data_source").add_row(
            {"source_id": 1, "source_code": "MEM", "source_name": "Member", "source_type": "relational"}
        )
        for system_pk in (101, 102):
            database.table("p_upstream_system").add_row(
                {
                    "system_pk": system_pk,
                    "data_source_id": 1,
                    "system_id": f"up_member_{system_pk}",
                    "system_abbr": "MEM",
                    "system_name": "Member",
                    "db_type": "PostgreSQL",
                    "host_name": "member.demo.invalid",
                    "status_code": "enabled",
                }
            )
        database.table("p_field_mapping_table").add_row(
            {
                "table_pk": 201,
                "data_source_id": 1,
                "upstream_system_id": None,
                "source_table_name": "MEMBER_A",
                "target_layer_code": "DWD",
            }
        )
        database.ledger = "0005_rbac_persistence"

        inspection = inspect_revision(database, CONFIG, "0006_field_mapping_upstream_id")
        self.assertIs(RevisionState.CONFLICT, inspection.state)
        self.assertIn("cannot be backfilled deterministically", inspection.summary)
        self._assert_conflict(
            database, "0006_field_mapping_upstream_id", "0005_rbac_persistence"
        )
        self.assertIsNone(
            database.table("p_field_mapping_table").rows[0]["upstream_system_id"]
        )

    def test_partial_open_module_tables_fail_closed(self):
        database = FakeDwsDatabase().seed_from_baseline()
        downgrade_to_prefix(
            database,
            {"0002_portable_asset_filter", "0003_open_repository_modules"},
        )
        database.add_column("p_asset_table", "catalog_name", "VARCHAR(128)")
        database.ledger = "0003_open_repository_modules"

        inspection = inspect_revision(database, CONFIG, "0004_metadata_ingestion_identity")
        self.assertIs(RevisionState.CONFLICT, inspection.state)
        self.assertIn("partially applied", inspection.summary)

        database = FakeDwsDatabase().seed_from_baseline()
        downgrade_to_prefix(database, set())
        from backend.app.migrations.schema import baseline_schema

        spec = baseline_schema("dws").tables["p_upstream_system"]
        database.tables["p_upstream_system"] = database._table_from_spec(
            "p_upstream_system", spec
        )
        database.ledger = "0002_portable_asset_filter"
        inspection = inspect_revision(database, CONFIG, "0003_open_repository_modules")
        self.assertIs(RevisionState.CONFLICT, inspection.state)
        self.assertIn("partial open repository module", inspection.summary)


class DwsFailureRecoveryTests(unittest.TestCase):
    def test_failure_before_0008_index_leaves_ledger_at_0007_and_fails_closed(self):
        database = FakeDwsDatabase().seed_from_baseline()
        downgrade_to_prefix(database, set(REVISION_ORDER[:6]))
        database.ledger = "0007_binary_status_contract"
        database.fail_on = "CREATE INDEX idx_p_indicator_semantic_ref"

        with self.assertRaises(DwsMigrationError) as error:
            apply_revisions(
                database, CONFIG, "0007_binary_status_contract", repository_head()
            )
        self.assertEqual("0008_indicator_semantic_contract", error.exception.revision)
        self.assertEqual("0007_binary_status_contract", database.ledger)
        self.assertIn(
            "source_asset_id", set(database.table("p_indicator_item").columns)
        )
        self.assertNotIn(
            "idx_p_indicator_semantic_ref",
            database.table("p_indicator_item").indexes,
        )

        # The interrupted state is the explicitly unsafe partial shape: retry
        # must fail closed instead of rebuilding the index silently.
        database.fail_on = None
        with self.assertRaises(DwsMigrationError) as retry:
            apply_revisions(
                database, CONFIG, "0007_binary_status_contract", repository_head()
            )
        self.assertEqual("0008_indicator_semantic_contract", retry.exception.revision)
        self.assertIn("reference index is missing", str(retry.exception))
        self.assertEqual("0007_binary_status_contract", database.ledger)

    def test_failure_during_0008_backfill_resumes_safely(self):
        database = FakeDwsDatabase().seed_from_baseline()
        downgrade_to_prefix(database, set(REVISION_ORDER[:6]))
        _seed_legacy_business_rows(database)
        database.ledger = "0007_binary_status_contract"
        database.fail_on = "SET source_asset_id = ?"

        with self.assertRaises(DwsMigrationError):
            apply_revisions(
                database, CONFIG, "0007_binary_status_contract", repository_head()
            )
        self.assertEqual("0007_binary_status_contract", database.ledger)
        self.assertIn(
            "idx_p_indicator_semantic_ref",
            database.table("p_indicator_item").indexes,
        )
        self.assertIsNone(
            database.table("p_indicator_item").rows[0].get("source_asset_id")
        )
        database.fail_on = None
        results = apply_revisions(
            database, CONFIG, "0007_binary_status_contract", repository_head()
        )
        actions = {result.revision: result.action for result in results}
        self.assertEqual("apply", actions["0008_indicator_semantic_contract"])
        self.assertEqual(repository_head(), database.ledger)
        self.assertEqual(
            1, database.table("p_indicator_item").rows[0]["source_asset_id"]
        )
        self.assertEqual(
            11, database.table("p_indicator_item").rows[0]["result_field_id"]
        )

    def test_post_condition_failure_never_advances_ledger(self):
        database = FakeDwsDatabase().seed_from_baseline()
        downgrade_to_prefix(database, set(REVISION_ORDER[:8]))
        database.ledger = "0009_upstream_option_contract"

        original = dws_revisions.FieldMappingIdentity.inspect

        def broken_inspect(self, ctx):
            inspection = original(self, ctx)
            if inspection.state is RevisionState.APPLIED:
                return dws_revisions.RevisionInspection(
                    self.revision,
                    RevisionState.NOT_APPLIED,
                    "forced post-condition failure",
                )
            return inspection

        with mock.patch.object(
            dws_revisions.FieldMappingIdentity, "inspect", broken_inspect
        ):
            with self.assertRaises(DwsMigrationError) as error:
                apply_revisions(
                    database, CONFIG, "0009_upstream_option_contract", repository_head()
                )
        self.assertEqual("0010_field_mapping_identity", error.exception.revision)
        self.assertIn("ledger was not advanced", str(error.exception))
        self.assertEqual("0009_upstream_option_contract", database.ledger)


class DwsSchemaMigrateCliTests(unittest.TestCase):
    """Exercise the CLI wiring in-process against the DWS simulation."""

    def _run_cli(self, database, argv):
        from backend.scripts import schema_migrate

        output = io.StringIO()
        with mock.patch(
            "app.db.facade.get_db_profile",
            return_value={"type": "gaussdb", "schema": "dap"},
        ), mock.patch(
            "app.db.facade.connect_with_profile", return_value=database
        ), mock.patch(
            "app.authorization.persistence.seed_rbac_for_profile",
            return_value=SimpleNamespace(
                inserted=0,
                roles_inserted=0,
                permissions_inserted=0,
                mappings_inserted=0,
            ),
        ), mock.patch(
            "app.navigation.persistence.seed_menus_for_profile",
            return_value=SimpleNamespace(inserted=0, total=11),
        ), contextlib.redirect_stdout(output):
            exit_code = schema_migrate.main(argv)
        return exit_code, output.getvalue()

    def test_cli_apply_reaches_head_and_prints_last_applied_revision(self):
        database = FakeDwsDatabase()
        exit_code, output = self._run_cli(
            database, ["apply", "--profile", "dws_test"]
        )
        self.assertEqual(0, exit_code)
        self.assertEqual(repository_head(), database.ledger)
        self.assertIn(f"applied={repository_head()}", output)
        self.assertIn("rbac_seed=inserted:0", output)

    def test_cli_plan_lists_adopt_and_apply_actions(self):
        database = FakeDwsDatabase().seed_from_baseline()
        downgrade_to_prefix(database, set(REVISION_ORDER[:4]))
        database.ledger_table = True
        database.ledger = "0005_rbac_persistence"

        exit_code, output = self._run_cli(
            database, ["plan", "--profile", "dws_test"]
        )
        self.assertEqual(0, exit_code)
        lines = [line for line in output.splitlines() if line]
        # The ledger revision itself is already recorded; the plan starts after it.
        self.assertIn("0006_field_mapping_upstream_id apply", lines)
        self.assertIn("0009_upstream_option_contract apply", lines)
        self.assertIn("0010_field_mapping_identity pending", lines)

    def test_cli_plan_for_nearly_head_reports_adoption(self):
        database = FakeDwsDatabase().seed_from_baseline()
        satisfied = set(REVISION_ORDER) - {"0002_portable_asset_filter"}
        downgrade_to_prefix(database, satisfied)
        database.ledger_table = True
        database.ledger = "0001_baseline"

        exit_code, output = self._run_cli(
            database, ["plan", "--profile", "dws_test"]
        )
        self.assertEqual(0, exit_code)
        lines = [line for line in output.splitlines() if line]
        self.assertIn("0002_portable_asset_filter apply", lines)
        self.assertIn("0003_open_repository_modules adopt", lines)
        self.assertIn("0008_indicator_semantic_contract adopt", lines)
        self.assertIn("0009_upstream_option_contract apply", lines)
        self.assertIn("0010_field_mapping_identity adopt", lines)

    def test_cli_status_reports_head_for_dws(self):
        database = FakeDwsDatabase().seed_from_baseline()
        database.ledger_table = True
        database.ledger = "0005_rbac_persistence"

        exit_code, output = self._run_cli(
            database, ["status", "--profile", "dws_test"]
        )
        self.assertEqual(0, exit_code)
        self.assertIn("dialect=dws", output)
        self.assertIn("revision=0005_rbac_persistence", output)
        self.assertIn(f"head={repository_head()}", output)


class DwsUnknownLedgerTests(unittest.TestCase):
    def test_unknown_ledger_revision_fails_closed(self):
        database = FakeDwsDatabase().seed_from_baseline()
        database.ledger_table = True
        database.ledger = "legacy_unknown"
        with self.assertRaises(DwsMigrationError) as error:
            apply_revisions(database, CONFIG, "legacy_unknown", repository_head())
        self.assertIn("not known to this repository", str(error.exception))
        self.assertEqual("legacy_unknown", database.ledger)


if __name__ == "__main__":
    unittest.main()
