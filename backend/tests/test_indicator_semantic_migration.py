"""Upgrade coverage for the indicator semantic contract revision."""

from __future__ import annotations

import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

# pi-lens-ignore: reportMissingImports
from backend.app.db.sqlite_adapter import connect
# pi-lens-ignore: reportMissingImports
from backend.app.migrations.schema import initialize

ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = ROOT.parent
MIGRATE = ROOT / "scripts" / "schema_migrate.py"


class IndicatorSemanticMigrationTests(unittest.TestCase):
    def _config(self, directory: Path, database: Path) -> Path:
        config = directory / "database.yaml"
        config.write_text(
            "profiles:\n  legacy:\n    type: sqlite\n"
            f"    database: {database.as_posix()}\n",
            encoding="utf-8",
        )
        return config

    def _insert_asset(self, connection, asset_id, table_name, schema_name, qualified_name):
        connection.execute(
            "INSERT INTO dwp.p_asset_table "
            "(asset_id, table_name, table_cn_name, schema_name, qualified_name, field_count) "
            "VALUES (?, ?, ?, ?, ?, 0)",
            (asset_id, table_name, table_name, schema_name, qualified_name),
        )

    def _insert_field(self, connection, field_id, asset_id, field_name):
        connection.execute(
            "INSERT INTO dwp.p_asset_field "
            "(field_id, asset_id, field_name, field_cn_name, field_order) "
            "VALUES (?, ?, ?, ?, 1)",
            (field_id, asset_id, field_name, field_name),
        )

    def _insert_indicator(
        self,
        connection,
        indicator_pk,
        indicator_id,
        table_name,
        field_name,
        status="enabled",
        source_asset_id=None,
        result_field_id=None,
    ):
        connection.execute(
            "INSERT INTO dwp.p_indicator_item "
            "(indicator_pk, indicator_id, indicator_name, meaning_desc, "
            "result_table_name, result_field_name, source_asset_id, result_field_id, "
            "aggregation_code, semantic_state, dimension_code, caliber_desc, path_desc, "
            "status_code, registrar_name, registered_date) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                indicator_pk,
                indicator_id,
                indicator_id,
                "legacy indicator",
                table_name,
                field_name,
                source_asset_id,
                result_field_id,
                None,
                "candidate",
                "ord",
                "legacy",
                "legacy",
                status,
                "migration-test",
                "2026-08-01",
            ),
        )

    def _prepare_database(self, directory: Path, *, drop_new_columns: bool) -> Path:
        database = directory / "legacy.sqlite"
        config = self._config(directory, database)
        connection = connect({"type": "sqlite", "database": str(database)})
        try:
            self.assertTrue(
                initialize(
                    connection,
                    {"type": "sqlite", "database": str(database)},
                    "sqlite",
                )
            )
            self._insert_asset(connection, 1, "orders", "sales", "sales.orders")
            self._insert_asset(connection, 2, "orders", "finance", "finance.orders")
            self._insert_asset(connection, 3, "unique_table", "sales", "sales.unique_table")
            self._insert_asset(connection, 4, "fieldless_table", "sales", "sales.fieldless_table")
            self._insert_field(connection, 101, 1, "amount")
            self._insert_field(connection, 201, 2, "amount")
            self._insert_field(connection, 301, 3, "unique_value")
            if drop_new_columns:
                self._insert_indicator(connection, 1, "QUALIFIED", "sales.orders", "amount")
                self._insert_indicator(connection, 2, "AMBIGUOUS", "orders", "amount")
                self._insert_indicator(connection, 3, "UNIQUE", "unique_table", "unique_value")
                self._insert_indicator(connection, 4, "MISSING_FIELD", "fieldless_table", "not_there")
                self._insert_indicator(connection, 5, "WRONG_OWNER", "unique_table", "amount")
                self._insert_indicator(connection, 6, "UNKNOWN", "missing_table", "amount")
                self._insert_indicator(
                    connection,
                    7,
                    "DISABLED",
                    "unique_table",
                    "unique_value",
                    status="disabled",
                )
                connection.execute("DROP INDEX dwp.idx_p_indicator_semantic_ref")
                for column in (
                    "source_asset_id",
                    "result_field_id",
                    "aggregation_code",
                    "semantic_state",
                ):
                    connection.execute(f"ALTER TABLE dwp.p_indicator_item DROP COLUMN {column}")
            else:
                self._insert_indicator(
                    connection,
                    1,
                    "EXISTING_IDS",
                    "legacy_table_snapshot",
                    "legacy_field_snapshot",
                    source_asset_id=3,
                    result_field_id=301,
                )
            connection.execute(
                "UPDATE dwp.alembic_version SET version_num = '0007_binary_status_contract'"
            )
            connection.commit()
        finally:
            connection.close()
        return config

    def _run_migration(self, config: Path):
        environment = dict(os.environ)
        environment["APP_SECRET_KEY"] = os.urandom(24).hex()
        return subprocess.run(
            [
                sys.executable,
                str(MIGRATE),
                "apply",
                "--profile",
                "legacy",
                "--config",
                str(config),
            ],
            cwd=PROJECT_ROOT,
            env=environment,
            capture_output=True,
            text=True,
            timeout=120,
        )

    def _indicator_rows(self, database: Path):
        connection = sqlite3.connect(database)
        try:
            return connection.execute(
                "SELECT indicator_id, result_table_name, result_field_name, "
                "source_asset_id, result_field_id, status_code, semantic_state "
                "FROM p_indicator_item ORDER BY indicator_pk"
            ).fetchall()
        finally:
            connection.close()

    def test_legacy_backfill_requires_exact_unique_matches_and_preserves_disabled_rows(self):
        with tempfile.TemporaryDirectory(prefix="indicator-semantic-migration-") as directory:
            root = Path(directory)
            database = root / "legacy.sqlite"
            config = self._prepare_database(root, drop_new_columns=True)
            result = self._run_migration(config)
            self.assertEqual(0, result.returncode, result.stderr)

            rows = {
                row[0]: row[1:]
                for row in self._indicator_rows(database)
            }
            self.assertEqual(("sales.orders", "amount", 1, 101, "enabled", "candidate"), rows["QUALIFIED"])
            self.assertEqual(("orders", "amount", None, None, "enabled", "candidate"), rows["AMBIGUOUS"])
            self.assertEqual(("unique_table", "unique_value", 3, 301, "enabled", "candidate"), rows["UNIQUE"])
            self.assertEqual(("fieldless_table", "not_there", 4, None, "enabled", "candidate"), rows["MISSING_FIELD"])
            self.assertEqual(("unique_table", "amount", 3, None, "enabled", "candidate"), rows["WRONG_OWNER"])
            self.assertEqual(("missing_table", "amount", None, None, "enabled", "candidate"), rows["UNKNOWN"])
            self.assertEqual(("unique_table", "unique_value", 3, 301, "disabled", "candidate"), rows["DISABLED"])

    def test_existing_stable_ids_are_not_overwritten_and_revision_is_idempotent(self):
        with tempfile.TemporaryDirectory(prefix="indicator-semantic-existing-") as directory:
            root = Path(directory)
            database = root / "legacy.sqlite"
            config = self._prepare_database(root, drop_new_columns=False)
            first = self._run_migration(config)
            self.assertEqual(0, first.returncode, first.stderr)
            self.assertEqual(
                ("legacy_table_snapshot", "legacy_field_snapshot", 3, 301, "enabled", "candidate"),
                self._indicator_rows(database)[0][1:],
            )
            first_rows = self._indicator_rows(database)
            second = self._run_migration(config)
            self.assertEqual(0, second.returncode, second.stderr)
            self.assertEqual(first_rows, self._indicator_rows(database))
            connection = sqlite3.connect(database)
            try:
                self.assertEqual(
                    ("0009_upstream_option_contract",),
                    connection.execute("SELECT version_num FROM alembic_version").fetchone(),
                )
                columns = {
                    row[1] for row in connection.execute("PRAGMA table_info(p_indicator_item)")
                }
            finally:
                connection.close()
            self.assertTrue(
                {
                    "source_asset_id",
                    "result_field_id",
                    "aggregation_code",
                    "semantic_state",
                } <= columns
            )


if __name__ == "__main__":
    unittest.main()
