"""Regression coverage for the ``p_push_job.freq_desc`` capacity fix (#315).

Real DWP data contains Chinese push-frequency descriptions up to 84 characters
/ 225 UTF-8 bytes.  The previous ``VARCHAR(200)`` DAP baseline rejected them
with ``value too long for type character varying(200)`` and blocked the
DWP -> DAP ``p_push_job`` migration.

These tests pin the widened ``VARCHAR(1000)`` contract for the fresh baseline
and the Alembic forward revision, and exercise the widening on SQLite locally
and on a real PostgreSQL instance when an isolated test profile is configured.
They assert that no value is truncated or rewritten.
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from alembic.config import Config
from alembic.script import ScriptDirectory

from backend.app.db.facade import clear_engine_cache, execute_sql, fetch_all, get_db_profile
from backend.app.db.sqlite_adapter import connect
from backend.app.db.tables import push_job
from backend.app.migrations.schema import baseline_schema, initialize
from backend.scripts.schema_migrate import repository_alembic_head
from backend.tests.db_test_support import (
    DOCS_DWS,
    DOCS_PG,
    TEST_CONFIG_ENV,
    TEST_PROFILE_ENV,
    read_sql,
    skip_without_postgres_integration,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
MIGRATE = REPO_ROOT / "backend" / "scripts" / "schema_migrate.py"
CAPACITY_REVISION = "0011_push_job_freq_desc_capacity"
LEGACY_REVISION = "0010_field_mapping_identity"

# Mirrors the reported production maximum: 84 characters / 225 UTF-8 bytes
# (70 CJK characters, one 2-byte middle dot, 13 ASCII characters).
REAL_WORLD_FREQ_DESC = (
    "每日早中晚三次增量推送；每周日凌晨全量推送；每月最后一天全量推送并生成对账文件，"
    "遇法定节假日顺延至节后首个工作日，结果写入推送变更日志并留痕· 07:30/23:00."
)

# PostgreSQL/MySQL count VARCHAR(n) in characters, so the pre-upgrade rejection
# probe must exceed 200 characters instead of 200 bytes.
OVER_CAPACITY_FREQ_DESC = "推送" * 125


def _run_cli(command: str, profile: str, config: Path):
    environment = dict(os.environ)
    environment.setdefault("APP_SECRET_KEY", "test-only-migration-secret")
    return subprocess.run(
        [
            sys.executable,
            str(MIGRATE),
            command,
            "--profile",
            profile,
            "--config",
            str(config),
        ],
        cwd=REPO_ROOT,
        env=environment,
        capture_output=True,
        text=True,
        timeout=180,
    )


class PushJobFreqDescContractTests(unittest.TestCase):
    def test_baselines_declare_widened_capacity_without_touching_other_columns(self):
        expected_freq = {
            "postgresql": "VARCHAR(1000)",
            "mysql": "VARCHAR(1000)",
            "dws": "VARCHAR(1000)",
            "sqlite": "TEXT",
        }
        expected_row_count = {
            "postgresql": "VARCHAR(200)",
            "mysql": "VARCHAR(200)",
            "dws": "VARCHAR(200)",
            "sqlite": "TEXT",
        }
        for dialect, type_name in expected_freq.items():
            table = baseline_schema(dialect).tables["p_push_job"]
            self.assertEqual(type_name, table.columns["freq_desc"].type_name, dialect)
            self.assertEqual(
                expected_row_count[dialect],
                table.columns["row_count_desc"].type_name,
                f"{dialect} must not change unrelated columns",
            )

    def test_runtime_metadata_declares_widened_capacity(self):
        self.assertEqual(1000, push_job.c.freq_desc.type.length)
        self.assertEqual(200, push_job.c.row_count_desc.type.length)

    def test_docs_reference_ddl_declares_widened_capacity(self):
        for docs, suffix in ((DOCS_PG, "pg"), (DOCS_DWS, "dws")):
            sql = read_sql(docs / f"push-app-{suffix}-ddl.sql")
            self.assertRegex(sql, re.compile(r"freq_desc\s+VARCHAR\(1000\)", re.I))
            self.assertRegex(sql, re.compile(r"row_count_desc\s+VARCHAR\(200\)", re.I))

    def test_capacity_revision_precedes_search_hot_keyword_head(self):
        self.assertEqual("0012_search_hot_keywords", repository_alembic_head())
        script = ScriptDirectory.from_config(Config(str(REPO_ROOT / "backend" / "alembic.ini")))
        revision = script.get_revision(CAPACITY_REVISION)
        self.assertIsNotNone(revision)
        self.assertEqual(LEGACY_REVISION, revision.down_revision)
        self.assertIn(
            CAPACITY_REVISION,
            {item.revision for item in script.walk_revisions()},
        )

    def test_real_world_sample_is_multibyte_beyond_the_old_capacity(self):
        encoded = REAL_WORLD_FREQ_DESC.encode("utf-8")
        self.assertEqual(84, len(REAL_WORLD_FREQ_DESC))
        self.assertEqual(225, len(encoded))
        self.assertGreater(len(encoded), 200)
        self.assertLessEqual(len(REAL_WORLD_FREQ_DESC), 1000)


class PushJobFreqDescSqliteUpgradeTests(unittest.TestCase):
    def test_legacy_0010_database_upgrades_to_capacity_head_without_data_loss(self):
        with tempfile.TemporaryDirectory(prefix="freq-desc-315-") as directory:
            root = Path(directory)
            database = root / "legacy.sqlite"
            config = root / "database.yaml"
            config.write_text(
                "profiles:\n  legacy:\n    type: sqlite\n"
                f"    database: {database.as_posix()}\n",
                encoding="utf-8",
            )
            profile_config = {"type": "sqlite", "database": str(database)}
            connection = connect(profile_config)
            try:
                self.assertTrue(initialize(connection, profile_config, "sqlite"))
                connection.execute(
                    "INSERT INTO dwp.p_push_system "
                    "(system_id, system_code, system_name, system_abbr, protocol_type, host_name, port_no) "
                    "VALUES (1, 'LEGACY', 'Legacy system', 'LEG', 'SFTP', 'legacy.invalid', 22)"
                )
                connection.execute(
                    "INSERT INTO dwp.p_push_job "
                    "(job_id, system_id, job_code, job_name, target_file_name, freq_desc) "
                    "VALUES (1, 1, 'LEGACY_JOB', 'Legacy job', 'legacy.csv', '每日')"
                )
                connection.execute(
                    f"UPDATE dwp.alembic_version SET version_num = '{LEGACY_REVISION}'"
                )
                connection.commit()
            finally:
                connection.close()

            result = _run_cli("apply", "legacy", config)
            self.assertEqual(0, result.returncode, result.stderr)

            connection = connect(profile_config)
            try:
                self.assertEqual(
                    (repository_alembic_head(),),
                    connection.execute(
                        "SELECT version_num FROM dwp.alembic_version"
                    ).fetchone(),
                )
                self.assertEqual(
                    ("每日",),
                    connection.execute(
                        "SELECT freq_desc FROM dwp.p_push_job WHERE job_id = 1"
                    ).fetchone(),
                )
                self.assertEqual("TEXT", _sqlite_column_type(connection, "freq_desc"))
                connection.execute(
                    "INSERT INTO dwp.p_push_job "
                    "(job_id, system_id, job_code, job_name, target_file_name, freq_desc) "
                    "VALUES (2, 1, 'LONG_JOB', 'Long job', 'long.csv', ?)",
                    (REAL_WORLD_FREQ_DESC,),
                )
                connection.commit()
                stored = connection.execute(
                    "SELECT freq_desc FROM dwp.p_push_job WHERE job_id = 2"
                ).fetchone()[0]
                self.assertEqual(REAL_WORLD_FREQ_DESC, stored)
            finally:
                connection.close()


def _sqlite_column_type(connection, column_name: str) -> str | None:
    for row in connection.execute("PRAGMA dwp.table_info(p_push_job)"):
        if row[1] == column_name:
            return str(row[2]).upper()
    return None


@skip_without_postgres_integration()
class PushJobFreqDescPostgresUpgradeTests(unittest.TestCase):
    """Real widening against an isolated PostgreSQL test database."""

    def setUp(self):
        self.profile = os.environ[TEST_PROFILE_ENV]
        self.config_path = Path(os.environ[TEST_CONFIG_ENV])
        self.environment = patch.dict(
            os.environ,
            {"ASSET_DB_CONFIG_PATH": str(self.config_path), "ASSET_DB_PROFILE": self.profile},
            clear=False,
        )
        self.environment.start()
        self.addCleanup(self.environment.stop)
        clear_engine_cache()
        self.addCleanup(clear_engine_cache)
        self.schema = str(get_db_profile(self.profile).get("schema") or "dwp")
        self.addCleanup(self._delete_probe_rows)
        self._delete_probe_rows()

    def _delete_probe_rows(self):
        execute_sql(
            self.profile,
            f"DELETE FROM {self.schema}.p_push_job WHERE job_code LIKE 'dap315-%'",
        )
        execute_sql(
            self.profile,
            f"DELETE FROM {self.schema}.p_push_system WHERE system_code LIKE 'dap315-%'",
        )

    def _scalar(self, sql: str, params=None):
        _, rows = fetch_all(self.profile, sql, params=params)
        return rows[0][0]

    def test_existing_200_column_upgrades_to_1000_and_keeps_all_values(self):
        job_table = f"{self.schema}.p_push_job"
        system_table = f"{self.schema}.p_push_system"
        execute_sql(
            self.profile,
            f"INSERT INTO {system_table} "
            "(system_id, system_code, system_name, system_abbr, protocol_type, host_name, port_no) "
            "VALUES (215001, 'dap315-pg', 'DAP 315 system', 'D315', 'SFTP', 'dap315.invalid', 22)",
        )
        execute_sql(
            self.profile,
            f"INSERT INTO {job_table} "
            "(job_id, system_id, job_code, job_name, target_file_name, freq_desc) "
            "VALUES (215001, 215001, 'dap315-pg-legacy', 'DAP 315 legacy job', 'dap315.csv', '每日')",
        )
        execute_sql(
            self.profile,
            f"ALTER TABLE {job_table} ALTER COLUMN freq_desc TYPE VARCHAR(200)",
        )
        execute_sql(
            self.profile,
            f"UPDATE {self.schema}.alembic_version SET version_num = '{LEGACY_REVISION}'",
        )
        self.assertEqual(
            200,
            self._scalar(
                "SELECT character_maximum_length FROM information_schema.columns "
                "WHERE table_schema = ? AND table_name = 'p_push_job' "
                "AND column_name = 'freq_desc'",
                params=[self.schema],
            ),
        )

        with self.assertRaises(Exception) as raised:
            execute_sql(
                self.profile,
                f"INSERT INTO {job_table} "
                "(job_id, system_id, job_code, job_name, target_file_name, freq_desc) "
                "VALUES (215002, 215001, 'dap315-pg-too-long', 'DAP 315 long job', "
                "'dap315-long.csv', ?)",
                params=[OVER_CAPACITY_FREQ_DESC],
            )
        self.assertIn("too long", str(raised.exception).lower())

        applied = _run_cli("apply", self.profile, self.config_path)
        self.assertEqual(0, applied.returncode, applied.stderr)
        verified = _run_cli("verify", self.profile, self.config_path)
        self.assertEqual(0, verified.returncode, verified.stderr)
        self.assertIn("verify=ok", verified.stdout)

        self.assertEqual(
            repository_alembic_head(),
            self._scalar(f"SELECT version_num FROM {self.schema}.alembic_version"),
        )
        self.assertEqual(
            1000,
            self._scalar(
                "SELECT character_maximum_length FROM information_schema.columns "
                "WHERE table_schema = ? AND table_name = 'p_push_job' "
                "AND column_name = 'freq_desc'",
                params=[self.schema],
            ),
        )
        self.assertEqual(
            "每日",
            self._scalar(f"SELECT freq_desc FROM {job_table} WHERE job_id = 215001"),
        )
        execute_sql(
            self.profile,
            f"INSERT INTO {job_table} "
            "(job_id, system_id, job_code, job_name, target_file_name, freq_desc) "
            "VALUES (215002, 215001, 'dap315-pg-long', 'DAP 315 long job', "
            "'dap315-long.csv', ?)",
            params=[REAL_WORLD_FREQ_DESC],
        )
        self.assertEqual(
            REAL_WORLD_FREQ_DESC,
            self._scalar(f"SELECT freq_desc FROM {job_table} WHERE job_id = 215002"),
        )
        execute_sql(
            self.profile,
            f"INSERT INTO {job_table} "
            "(job_id, system_id, job_code, job_name, target_file_name, freq_desc) "
            "VALUES (215003, 215001, 'dap315-pg-over-capacity', 'DAP 315 over capacity', "
            "'dap315-over.csv', ?)",
            params=[OVER_CAPACITY_FREQ_DESC],
        )
        self.assertEqual(
            OVER_CAPACITY_FREQ_DESC,
            self._scalar(f"SELECT freq_desc FROM {job_table} WHERE job_id = 215003"),
        )


if __name__ == "__main__":
    unittest.main()
