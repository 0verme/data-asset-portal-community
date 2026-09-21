"""Tests for the DWA/DM asset-layer dev/test seed script.

``SeedInsertCanonicalSchemaGuardTests`` is the offline regression barrier added
for #265: it proves that every column the seed script targets still exists in the
canonical baseline schema, so a stale script fails CI even when no PostgreSQL
test instance is available.

``AssetLayerSeedPostgresIntegrationTests`` exercises the real
``--apply`` -> replay -> ``--cleanup`` path against an isolated PostgreSQL test
database (``TEST_DATABASE_PROFILE`` + ``TEST_DATABASE_CONFIG_PATH``) and is
skipped when no such instance is configured.
"""
from __future__ import annotations

import ast
import os
import re
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.app.db.facade import clear_engine_cache, execute_sql
from backend.app.db.sqlite_adapter import connect
from backend.app.db.tables import asset_change_log, asset_field, asset_table
from backend.app.migrations.schema import SUPPORTED_DIALECTS, baseline_columns, initialize
from backend.scripts import seed_asset_layer_test_data as seed
from backend.tests.db_test_support import (
    TEST_CONFIG_ENV,
    TEST_PROFILE_ENV,
    skip_without_postgres_integration,
)


SEED_MODULE = Path(seed.__file__)
PORTABLE_CORE_TABLES = {
    "p_asset_table": asset_table,
    "p_asset_field": asset_field,
    "p_asset_change_log": asset_change_log,
}
INSERT_RE = re.compile(
    r"INSERT\s+INTO\s+(?:(?P<schema>\w+)\.)?(?P<table>\w+)\s*\((?P<columns>.*?)\)\s*VALUES",
    re.IGNORECASE | re.DOTALL,
)
DELETE_RE = re.compile(r"DELETE\s+FROM\s+(?:(?P<schema>\w+)\.)?(?P<table>\w+)", re.IGNORECASE)
WHERE_COLUMN_RE = re.compile(r"([a-z_][a-z0-9_]*)\s*(?:=|<>|!=|\bIN\b|\bIS\b)", re.IGNORECASE)

DECOY_ASSET_NAME = "zzz_dap_265_cleanup_decoy"
DECOY_OPERATOR = "dap_265_cleanup_decoy"


def insert_target(sql: str) -> tuple[str, frozenset[str]]:
    """Return ``(table, targeted columns)`` for one seed INSERT statement."""
    match = INSERT_RE.search(sql)
    if match is None:
        raise AssertionError(f"not a parseable INSERT statement: {sql.strip()!r}")
    columns = {
        column.strip().lower()
        for column in match.group("columns").replace("\n", " ").split(",")
        if column.strip()
    }
    return match.group("table").lower(), frozenset(columns)


def sql_literals(source: str) -> list[str]:
    """Return every literal SQL string embedded in a module source."""
    literals: list[str] = []
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            literals.append(node.value)
        elif isinstance(node, ast.JoinedStr):
            literals.append(
                "".join(
                    value.value
                    for value in node.values
                    if isinstance(value, ast.Constant) and isinstance(value.value, str)
                )
            )
    return [
        text
        for text in literals
        if re.search(r"\b(SELECT|INSERT|DELETE|UPDATE|LOCK)\b", text, re.IGNORECASE)
    ]


class AssetLayerSeedSafetyTests(unittest.TestCase):
    def test_safe_target_rejects_sqlite(self):
        with self.assertRaisesRegex(RuntimeError, "only postgres or gaussdb"):
            seed._safe_target("asset_test", {"type": "sqlite", "database": "x.db"})

    def test_safe_target_rejects_non_test_postgres(self):
        with self.assertRaisesRegex(RuntimeError, "dev, test, or local"):
            seed._safe_target(
                "primary",
                {
                    "type": "postgres",
                    "host": "db.demo.invalid",
                    "port": 5432,
                    "database": "asset_portal",
                },
            )

    def test_safe_target_rejects_production_marker(self):
        with self.assertRaisesRegex(RuntimeError, "production marker"):
            seed._safe_target(
                "prod_primary",
                {
                    "type": "postgres",
                    "host": "127.0.0.1",
                    "port": 5432,
                    "database": "asset_portal_test",
                },
            )

    def test_safe_target_accepts_explicit_test_postgres(self):
        label = seed._safe_target(
            "local_test",
            {
                "type": "postgres",
                "host": "127.0.0.1",
                "port": 5432,
                "database": "asset_portal_test",
                "schema": "dwp",
            },
        )
        self.assertIn("postgres:", label)
        self.assertIn("asset_portal_test", label)

    def test_seed_assets_definition_is_non_empty_and_layered(self):
        self.assertGreaterEqual(len(seed.ASSETS), 12)
        layers = {asset["layer"] for asset in seed.ASSETS}
        self.assertIn("DWA", layers)
        self.assertIn("DM", layers)
        for asset in seed.ASSETS:
            self.assertTrue(asset["fields"])


class SeedInsertCanonicalSchemaGuardTests(unittest.TestCase):
    """#265 offline guard: the seed script must follow the canonical schema."""

    def test_guard_covers_every_insert_statement_in_the_seed_module(self):
        source_targets = {
            insert_target(match.group(0))
            for match in INSERT_RE.finditer(SEED_MODULE.read_text(encoding="utf-8"))
        }
        registered_targets = {insert_target(sql) for sql in seed.INSERT_STATEMENTS.values()}
        self.assertEqual(registered_targets, source_targets)

    def test_portable_core_declarations_agree_with_the_canonical_baseline(self):
        for dialect in SUPPORTED_DIALECTS:
            canonical = baseline_columns(dialect)
            for table, core in PORTABLE_CORE_TABLES.items():
                self.assertEqual(canonical[table], {column.name for column in core.c}, dialect)

    def test_seed_insert_columns_exist_in_every_canonical_dialect(self):
        for dialect in SUPPORTED_DIALECTS:
            canonical = baseline_columns(dialect)
            for table, sql in seed.INSERT_STATEMENTS.items():
                statement_table, targeted = insert_target(sql)
                self.assertEqual(table, statement_table)
                stale = sorted(targeted - canonical[table])
                self.assertEqual(
                    [],
                    stale,
                    f"{dialect}: the {table} seed INSERT targets columns that the canonical "
                    f"schema does not declare: {stale}",
                )

    def test_seed_cleanup_delete_columns_exist_in_the_canonical_schema(self):
        for dialect in SUPPORTED_DIALECTS:
            canonical = baseline_columns(dialect)
            checked = 0
            for statement in sql_literals(SEED_MODULE.read_text(encoding="utf-8")):
                match = DELETE_RE.search(statement)
                if match is None:
                    continue
                table = match.group("table").lower()
                targeted = {
                    column.lower()
                    for column in WHERE_COLUMN_RE.findall(statement.split("WHERE", 1)[-1])
                }
                self.assertTrue(targeted, f"no WHERE columns parsed for {statement.strip()!r}")
                stale = sorted(targeted - canonical[table])
                self.assertEqual(
                    [],
                    stale,
                    f"{dialect}: the {table} cleanup DELETE targets columns that the "
                    f"canonical schema does not declare: {stale}",
                )
                checked += 1
            self.assertGreaterEqual(checked, 3)

    def test_seed_insert_statements_execute_against_the_canonical_sqlite_baseline(self):
        with tempfile.TemporaryDirectory(prefix="dap-265-seed-") as temp_dir:
            config = {"type": "sqlite", "database": str(Path(temp_dir) / "canonical.sqlite")}
            connection = connect(config)
            self.addCleanup(connection.close)
            self.assertTrue(initialize(connection, config, "sqlite"))
            for table, sql in seed.INSERT_STATEMENTS.items():
                placeholders = sql.count("?")
                with self.subTest(table=table):
                    self.assertGreater(placeholders, 0)
                    connection.execute(sql, tuple(range(1, placeholders + 1)))


@skip_without_postgres_integration()
class AssetLayerSeedPostgresIntegrationTests(unittest.TestCase):
    """Real ``--apply`` / replay / ``--cleanup`` against an isolated test database."""

    def setUp(self):
        self.profile = os.environ[TEST_PROFILE_ENV]
        self.config_path = os.environ[TEST_CONFIG_ENV]
        self.environment = patch.dict(
            os.environ,
            {"ASSET_DB_CONFIG_PATH": self.config_path, "ASSET_DB_PROFILE": self.profile},
            clear=False,
        )
        self.environment.start()
        self.addCleanup(self.environment.stop)
        clear_engine_cache()
        self.addCleanup(clear_engine_cache)
        self.created_reference_rows: list[tuple[str, str]] = []
        self.addCleanup(self._delete_reference_rows)
        self.addCleanup(self._delete_probe_rows)
        self._delete_probe_rows()
        self._create_missing_reference_rows()

    def _run(self, command):
        return seed.main([command, "--profile", self.profile, "--config", self.config_path])

    def _rows(self, sql, params=None):
        return seed._rows(self.profile, sql, params)

    def _scalar(self, sql, params=None):
        return self._rows(sql, params)[0]["value"]

    def _seeded_counts(self):
        row = self._rows(
            """
SELECT
  (SELECT COUNT(*) FROM dwp.p_asset_table WHERE created_by = ?) AS assets,
  (SELECT COUNT(*) FROM dwp.p_asset_field WHERE created_by = ?) AS fields,
  (SELECT COUNT(*) FROM dwp.p_asset_change_log WHERE operator_name = ?) AS change_logs
""",
            [seed.SEED_OPERATOR, seed.SEED_OPERATOR, seed.SEED_OPERATOR],
        )[0]
        return {key: int(row[key]) for key in ("assets", "fields", "change_logs")}

    def _create_missing_reference_rows(self):
        """Provision the domains/layers the seed requires, tracking what we added."""
        domains = {row["domain_code"] for row in self._rows("SELECT domain_code FROM dwp.p_asset_domain")}
        for domain in sorted({asset["domain"] for asset in seed.ASSETS} - domains):
            execute_sql(
                self.profile,
                "INSERT INTO dwp.p_asset_domain "
                "(domain_code, domain_name, display_order, is_active, is_deleted) "
                "VALUES (?, ?, 99, 'Y', 'N')",
                params=[domain, f"dap-265 {domain}"],
            )
            self.created_reference_rows.append(("p_asset_domain", domain))
        layers = {row["layer_code"] for row in self._rows("SELECT layer_code FROM dwp.p_asset_layer")}
        for layer in sorted({asset["layer"] for asset in seed.ASSETS} - layers):
            execute_sql(
                self.profile,
                "INSERT INTO dwp.p_asset_layer "
                "(layer_code, layer_name, display_order, is_active, is_deleted) "
                "VALUES (?, ?, 99, 'Y', 'N')",
                params=[layer, f"dap-265 {layer}"],
            )
            self.created_reference_rows.append(("p_asset_layer", layer))

    def _next_id(self, table, column):
        return int(self._rows(f"SELECT COALESCE(MAX({column}), 0) + 1 AS value FROM dwp.{table}")[0]["value"])

    def _create_decoy_rows(self):
        """Create rows owned by another operator that ``--cleanup`` must not delete."""
        asset_id = self._next_id("p_asset_table", "asset_id")
        field_id = self._next_id("p_asset_field", "field_id")
        change_id = self._next_id("p_asset_change_log", "change_id")
        execute_sql(
            self.profile,
            "INSERT INTO dwp.p_asset_table "
            "(asset_id, table_name, table_cn_name, schema_name, layer_code, domain_code, "
            "owner_name, field_count, is_deleted, created_by, updated_by) "
            "VALUES (?, ?, ?, 'dwp', 'DM', 'PAY', 'decoy', 1, 'N', ?, ?)",
            params=[asset_id, DECOY_ASSET_NAME, "dap-265 cleanup decoy", DECOY_OPERATOR, DECOY_OPERATOR],
        )
        execute_sql(
            self.profile,
            "INSERT INTO dwp.p_asset_field "
            "(field_id, asset_id, field_name, field_cn_name, field_order, "
            "nullable_flag, pk_flag, partition_flag, is_deleted, created_by, updated_by) "
            "VALUES (?, ?, ?, ?, 1, 'Y', 'N', 'N', 'N', ?, ?)",
            params=[field_id, asset_id, "decoy_column", "decoy column", DECOY_OPERATOR, DECOY_OPERATOR],
        )
        execute_sql(
            self.profile,
            "INSERT INTO dwp.p_asset_change_log "
            "(change_id, asset_id, table_name, change_type, change_summary, "
            "before_json, after_json, operator_name) "
            "VALUES (?, ?, ?, 'CREATE_TABLE', 'dap-265 cleanup decoy', NULL, NULL, ?)",
            params=[change_id, asset_id, DECOY_ASSET_NAME, DECOY_OPERATOR],
        )
        return asset_id

    def _delete_probe_rows(self):
        for table, column in (
            ("p_asset_change_log", "operator_name"),
            ("p_asset_field", "created_by"),
            ("p_asset_table", "created_by"),
        ):
            execute_sql(
                self.profile,
                f"DELETE FROM dwp.{table} WHERE {column} = ?",
                params=[DECOY_OPERATOR],
            )
        # Best effort only: a failing test must not leave seed rows behind.
        try:
            seed._cleanup(self.profile)
        except Exception:  # pragma: no cover - teardown must never mask the failure
            pass

    def _delete_reference_rows(self):
        for table, code_column in (
            ("p_asset_domain", "domain_code"),
            ("p_asset_layer", "layer_code"),
        ):
            codes = [code for name, code in self.created_reference_rows if name == table]
            for code in codes:
                execute_sql(
                    self.profile,
                    f"DELETE FROM dwp.{table} WHERE {code_column} = ?",
                    params=[code],
                )

    def test_apply_is_idempotent_and_cleanup_is_scoped(self):
        self.assertEqual(0, self._run("--apply"))
        seeded = self._seeded_counts()
        self.assertEqual(len(seed.ASSETS), seeded["assets"])
        self.assertGreater(seeded["fields"], 0)
        self.assertEqual(len(seed.ASSETS), seeded["change_logs"])

        # Seeded assets stay portal-only: no source-scoped identity is invented.
        self.assertEqual(
            0,
            int(
                self._scalar(
                    "SELECT COUNT(*) AS value FROM dwp.p_asset_table "
                    "WHERE created_by = ? AND (source_key IS NOT NULL "
                    "OR asset_type IS NOT NULL OR external_id IS NOT NULL)",
                    [seed.SEED_OPERATOR],
                )
            ),
        )

        # Replaying --apply against the same profile must not duplicate rows.
        self.assertEqual(0, self._run("--apply"))
        self.assertEqual(seeded, self._seeded_counts())

        decoy_asset_id = self._create_decoy_rows()
        self.assertEqual(0, self._run("--cleanup"))
        self.assertEqual({"assets": 0, "fields": 0, "change_logs": 0}, self._seeded_counts())

        # Rows owned by another operator survive cleanup.
        for table, column in (
            ("p_asset_table", "asset_id"),
            ("p_asset_field", "asset_id"),
            ("p_asset_change_log", "asset_id"),
        ):
            self.assertEqual(
                1,
                int(
                    self._scalar(
                        f"SELECT COUNT(*) AS value FROM dwp.{table} WHERE {column} = ?",
                        [decoy_asset_id],
                    )
                ),
                table,
            )

        # Repeating cleanup is safe.
        self.assertEqual(0, self._run("--cleanup"))
        self.assertEqual({"assets": 0, "fields": 0, "change_logs": 0}, self._seeded_counts())


if __name__ == "__main__":
    unittest.main()
