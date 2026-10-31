"""Forward-migration coverage for the selective field-mapping lookup index."""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from backend.app.db.sqlite_adapter import connect
from backend.app.migrations.schema import baseline_schema, initialize
from backend.app.db.tables import mapping_field

REPO_ROOT = Path(__file__).resolve().parents[2]
MIGRATE = REPO_ROOT / "backend" / "scripts" / "schema_migrate.py"
INDEX_NAME = "idx_p_field_mapping_field_table_deleted"
LEGACY_REVISION = "0012_search_hot_keywords"
HEAD_REVISION = "0013_field_filter_index"


def _temporary_directory(prefix: str):
    scratch_root = os.environ.get("DAP_403_TEST_ROOT")
    if scratch_root:
        Path(scratch_root).mkdir(parents=True, exist_ok=True)
    return tempfile.TemporaryDirectory(prefix=prefix, dir=scratch_root)


def _prepare_database(root: Path) -> tuple[Path, Path, dict]:
    database = root / "field-mapping.sqlite"
    config_file = root / "database.yaml"
    config_file.write_text(
        "profiles:\n  isolated:\n    type: sqlite\n"
        f"    database: {database.as_posix()}\n",
        encoding="utf-8",
    )
    profile = {"type": "sqlite", "database": str(database)}
    connection = connect(profile)
    try:
        initialize(connection, profile, "sqlite")
        connection.execute(
            f"UPDATE dwp.alembic_version SET version_num = '{LEGACY_REVISION}'"
        )
        connection.commit()
    finally:
        connection.close()
    return database, config_file, profile


def _run_apply(config_file: Path) -> subprocess.CompletedProcess[str]:
    environment = dict(os.environ)
    environment.setdefault("APP_SECRET_KEY", "test-only-migration-secret")
    return subprocess.run(
        [
            sys.executable,
            str(MIGRATE),
            "apply",
            "--profile",
            "isolated",
            "--config",
            str(config_file),
        ],
        cwd=REPO_ROOT,
        env=environment,
        capture_output=True,
        text=True,
        timeout=180,
    )


class FieldMappingFilterIndexMigrationTests(unittest.TestCase):
    def test_revision_id_fits_the_cross_dialect_version_column(self):
        self.assertLessEqual(len(HEAD_REVISION), 32)

    def test_supported_baselines_and_runtime_metadata_declare_the_lookup_index(self):
        for dialect in ("sqlite", "postgresql", "mysql", "dws"):
            index = baseline_schema(dialect).tables[
                "p_field_mapping_field"
            ].indexes.get(INDEX_NAME)
            self.assertIsNotNone(index, dialect)
            self.assertEqual(("table_pk", "is_deleted"), index.columns, dialect)
            self.assertFalse(index.unique, dialect)

        runtime_index = next(
            index for index in mapping_field.indexes if index.name == INDEX_NAME
        )
        self.assertEqual(
            ["table_pk", "is_deleted"],
            [column.name for column in runtime_index.columns],
        )

    def test_0012_database_receives_the_non_unique_composite_index(self):
        with _temporary_directory("field-filter-index-403-") as directory:
            root = Path(directory)
            _, config_file, profile = _prepare_database(root)
            connection = connect(profile)
            try:
                connection.execute(f"DROP INDEX dwp.{INDEX_NAME}")
                connection.commit()
            finally:
                connection.close()

            result = _run_apply(config_file)
            self.assertEqual(0, result.returncode, result.stderr)

            connection = connect(profile)
            try:
                index = connection.execute(
                    "PRAGMA dwp.index_list('p_field_mapping_field')"
                ).fetchall()
                self.assertIn(INDEX_NAME, {row[1] for row in index})
                columns = connection.execute(
                    f"PRAGMA dwp.index_info('{INDEX_NAME}')"
                ).fetchall()
                self.assertEqual(["table_pk", "is_deleted"], [row[2] for row in columns])
                self.assertEqual(
                    (HEAD_REVISION,),
                    connection.execute(
                        "SELECT version_num FROM dwp.alembic_version"
                    ).fetchone(),
                )
            finally:
                connection.close()

    def test_0013_fails_closed_for_a_same_name_wrong_index(self):
        with _temporary_directory("field-filter-index-conflict-403-") as directory:
            root = Path(directory)
            _, config_file, profile = _prepare_database(root)
            connection = connect(profile)
            try:
                connection.execute(f"DROP INDEX dwp.{INDEX_NAME}")
                connection.execute(
                    f"CREATE INDEX dwp.{INDEX_NAME} "
                    "ON p_field_mapping_field (is_deleted, table_pk)"
                )
                connection.commit()
            finally:
                connection.close()

            result = _run_apply(config_file)
            self.assertNotEqual(0, result.returncode)
            self.assertIn("unexpected definition", result.stderr)

            connection = connect(profile)
            try:
                self.assertEqual(
                    (LEGACY_REVISION,),
                    connection.execute(
                        "SELECT version_num FROM dwp.alembic_version"
                    ).fetchone(),
                )
                columns = connection.execute(
                    f"PRAGMA dwp.index_info('{INDEX_NAME}')"
                ).fetchall()
                self.assertEqual(["is_deleted", "table_pk"], [row[2] for row in columns])
            finally:
                connection.close()


if __name__ == "__main__":
    unittest.main()
