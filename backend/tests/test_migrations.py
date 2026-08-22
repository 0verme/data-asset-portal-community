from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from backend.app.db.sqlite_adapter import connect
from backend.app.migrations.schema import (
    BASELINE_REVISION,
    SUPPORTED_DIALECTS,
    baseline_columns,
    baseline_path,
    baseline_tables,
    current_revision,
    initialize,
    stamp_existing,
    verify_baselines,
    verify_database,
)


class BaselineSchemaTests(unittest.TestCase):
    def test_all_supported_dialects_have_the_same_tables(self):
        self.assertEqual(("sqlite", "postgresql", "mysql", "dws"), SUPPORTED_DIALECTS)
        tables = verify_baselines()
        self.assertEqual(39, len(tables))
        for dialect in SUPPORTED_DIALECTS:
            self.assertTrue(baseline_path(dialect).is_file())
            self.assertEqual(set(tables), set(baseline_tables(dialect)))
            self.assertEqual(set(tables), set(baseline_columns(dialect)))

    def test_mysql_baseline_declares_portable_storage_defaults(self):
        sql = baseline_path("mysql").read_text(encoding="utf-8")
        self.assertIn("AUTO_INCREMENT", sql)
        self.assertIn("ENGINE=InnoDB", sql)
        self.assertIn("DEFAULT CHARSET=utf8mb4", sql)
        self.assertIn("COLLATE=utf8mb4_0900_ai_ci", sql)
        self.assertNotIn("dwp.", sql.lower())

    def test_schema_qualification_matches_backend_contract(self):
        self.assertIn("dwp.", baseline_path("sqlite").read_text(encoding="utf-8").lower())
        self.assertIn("dwp.", baseline_path("postgresql").read_text(encoding="utf-8").lower())
        self.assertIn("dwp.", baseline_path("dws").read_text(encoding="utf-8").lower())


class BaselineLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.database = Path(self.temp_dir.name) / "schema.sqlite"
        self.config = {"type": "sqlite", "database": str(self.database)}
        self.connection = connect(self.config)
        self.addCleanup(self.connection.close)

    def test_fresh_database_initializes_and_stamps_once(self):
        self.assertTrue(initialize(self.connection, self.config, "sqlite"))
        self.assertEqual(BASELINE_REVISION, current_revision(self.connection, self.config))
        self.assertEqual(BASELINE_REVISION, verify_database(self.connection, self.config, "sqlite"))
        self.assertFalse(initialize(self.connection, self.config, "sqlite"))

    def test_existing_compatible_database_is_stamped_without_replaying_ddl(self):
        for statement in baseline_path("sqlite").read_text(encoding="utf-8").split(";"):
            if statement.strip():
                self.connection.execute(statement)
        self.connection.execute(
            "INSERT INTO dwp.p_system "
            "(system_id, system_code, system_name, system_abbr, system_type, status_code) "
            "VALUES (1, 'LEGACY', 'Legacy system', 'LEG', 'business', 'enabled')"
        )
        self.connection.commit()

        self.assertEqual(BASELINE_REVISION, stamp_existing(self.connection, self.config, "sqlite"))
        self.assertEqual(BASELINE_REVISION, current_revision(self.connection, self.config))
        self.assertEqual(
            (1,),
            self.connection.execute(
                "SELECT system_id FROM dwp.p_system WHERE system_code = 'LEGACY'"
            ).fetchone(),
        )

    def test_existing_database_must_verify_before_stamp(self):
        self.connection.execute("CREATE TABLE p_asset_table (asset_id TEXT PRIMARY KEY)")
        self.connection.commit()
        with self.assertRaisesRegex(RuntimeError, "missing tables"):
            stamp_existing(self.connection, self.config, "sqlite")
        self.assertIsNone(current_revision(self.connection, self.config))

    def test_non_empty_database_cannot_be_initialized_as_fresh(self):
        self.connection.execute("CREATE TABLE dwp.unrelated (id INTEGER PRIMARY KEY)")
        self.connection.commit()
        with self.assertRaisesRegex(RuntimeError, "already contains user tables"):
            initialize(self.connection, self.config, "sqlite")

    def test_existing_database_column_shape_is_verified(self):
        initialize(self.connection, self.config, "sqlite")
        self.connection.execute("DROP TABLE dwp.p_asset_table")
        self.connection.execute("CREATE TABLE dwp.p_asset_table (asset_id INTEGER PRIMARY KEY)")
        self.connection.commit()
        with self.assertRaisesRegex(RuntimeError, "missing columns: p_asset_table"):
            verify_database(self.connection, self.config, "sqlite")


if __name__ == "__main__":
    unittest.main()
