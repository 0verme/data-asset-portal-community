# pi-lens-ignore: I001
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


class FieldMappingIdentityMigrationTests(unittest.TestCase):
    def _prepare_legacy_database(self, database: Path, *, ambiguous: bool = False) -> Path:
        config = database.with_suffix(".yaml")
        config.write_text(
            "profiles:\n  legacy:\n    type: sqlite\n"
            f"    database: {database.as_posix()}\n",
            encoding="utf-8",
        )
        connection = connect({"type": "sqlite", "database": str(database)})
        try:
            self.assertTrue(initialize(connection, {"type": "sqlite", "database": str(database)}, "sqlite"))
            connection.commit()
            connection.execute("PRAGMA foreign_keys = OFF")
            connection.execute("DROP TABLE dwp.p_field_mapping_field")
            connection.execute("DROP TABLE dwp.p_field_mapping_table")
            connection.executescript(
                """
                CREATE TABLE dwp.p_field_mapping_table (
                    table_pk INTEGER PRIMARY KEY,
                    data_source_id INTEGER NOT NULL,
                    upstream_system_id INTEGER,
                    source_table_name TEXT NOT NULL,
                    source_table_cn TEXT,
                    target_layer_code TEXT NOT NULL DEFAULT 'DWF',
                    target_table_name TEXT,
                    load_mode TEXT,
                    field_total_count INTEGER NOT NULL DEFAULT 0,
                    mapped_field_count INTEGER NOT NULL DEFAULT 0,
                    latest_mapping_time TIMESTAMP,
                    table_desc TEXT,
                    is_deleted TEXT NOT NULL DEFAULT 'N',
                    created_by TEXT NOT NULL DEFAULT 'system',
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_by TEXT NOT NULL DEFAULT 'system',
                    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (data_source_id) REFERENCES p_data_source(source_id) ON DELETE RESTRICT
                );
                CREATE INDEX dwp.idx_p_field_mapping_table_source
                    ON p_field_mapping_table(data_source_id, source_table_name);
                INSERT INTO p_data_source
                    (source_id, source_code, source_name, source_type, status_code)
                VALUES (1, 'MEM', '会员档案数据源', 'relational', 'enabled');
                INSERT INTO p_upstream_system
                    (system_pk, data_source_id, system_id, system_abbr, system_name, db_type, host_name, status_code)
                VALUES (101, 1, 'up_member', 'MEM', '会员档案数据源', 'PostgreSQL', 'member.demo.invalid', 'enabled');
                INSERT INTO p_field_mapping_table
                    (table_pk, data_source_id, source_table_name, target_layer_code)
                VALUES (201, 1, 'MEMBER_A', 'DWD');
                """
            )
            if ambiguous:
                connection.execute(
                    "INSERT INTO p_upstream_system "
                    "(system_pk, data_source_id, system_id, system_abbr, system_name, db_type, host_name, status_code) "
                    "VALUES (102, 1, 'up_member_test', 'MEM_TEST', '会员档案数据源', 'PostgreSQL', 'member-test.demo.invalid', 'enabled')"
                )
            connection.execute(
                "UPDATE dwp.alembic_version SET version_num = '0005_rbac_persistence'"
            )
            connection.commit()
        finally:
            connection.close()
        return config

    def _run_migration(self, config: Path):
        environment = dict(os.environ)
        environment["APP_SECRET_KEY"] = os.urandom(24).hex()
        return subprocess.run(
            [sys.executable, str(MIGRATE), "apply", "--profile", "legacy", "--config", str(config)],
            cwd=PROJECT_ROOT,
            env=environment,
            capture_output=True,
            text=True,
            timeout=120,
        )

    def test_unique_legacy_relation_is_backfilled_and_constrained(self):
        with tempfile.TemporaryDirectory(prefix="field-mapping-migration-") as directory:
            database = Path(directory) / "legacy.sqlite"
            config = self._prepare_legacy_database(database)
            result = self._run_migration(config)
            self.assertEqual(0, result.returncode, result.stderr)

            connection = sqlite3.connect(database)
            try:
                self.assertEqual(
                    (101,),
                    connection.execute(
                        "SELECT upstream_system_id FROM p_field_mapping_table WHERE table_pk = 201"
                    ).fetchone(),
                )
                self.assertEqual(
                    ("0008_indicator_semantic_contract",),
                    connection.execute("SELECT version_num FROM alembic_version").fetchone(),
                )
                foreign_keys = connection.execute(
                    "PRAGMA foreign_key_list(p_field_mapping_table)"
                ).fetchall()
                indexes = connection.execute(
                    "PRAGMA index_list(p_field_mapping_table)"
                ).fetchall()
            finally:
                connection.close()
            self.assertTrue(any(row[2] == "p_upstream_system" and row[3] == "upstream_system_id" for row in foreign_keys))
            self.assertTrue(any(row[1] == "idx_p_field_mapping_table_uk_01" and row[2] for row in indexes))

    def test_ambiguous_legacy_relation_fails_without_guessing(self):
        with tempfile.TemporaryDirectory(prefix="field-mapping-migration-ambiguous-") as directory:
            database = Path(directory) / "legacy.sqlite"
            config = self._prepare_legacy_database(database, ambiguous=True)
            result = self._run_migration(config)
            self.assertNotEqual(0, result.returncode)
            self.assertIn("多个候选上游系统", result.stderr)

            connection = sqlite3.connect(database)
            try:
                self.assertEqual(
                    (None,),
                    connection.execute(
                        "SELECT upstream_system_id FROM p_field_mapping_table WHERE table_pk = 201"
                    ).fetchone(),
                )
                self.assertEqual(
                    ("0005_rbac_persistence",),
                    connection.execute("SELECT version_num FROM alembic_version").fetchone(),
                )
            finally:
                connection.close()


if __name__ == "__main__":
    unittest.main()
