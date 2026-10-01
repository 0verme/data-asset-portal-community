from __future__ import annotations

import os
import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from sqlalchemy import delete, insert, select
from sqlalchemy.exc import IntegrityError

from backend.app.db.core import execute_core, fetch_all_core
from backend.app.db.facade import (
    clear_engine_cache,
    database_transaction,
    execute_many,
    execute_sql,
    fetch_all,
    get_db_profile,
)
from backend.app.db.tables import admin_user
from backend.scripts.schema_migrate import repository_alembic_head


MYSQL_PROFILE = "TEST_MYSQL_DATABASE_PROFILE"
MYSQL_CONFIG = "TEST_MYSQL_DATABASE_CONFIG_PATH"
REPO_ROOT = Path(__file__).resolve().parents[2]
MIGRATE = REPO_ROOT / "backend" / "scripts" / "schema_migrate.py"
LEGACY_REVISION = "0010_field_mapping_identity"

# Mirrors the reported production maximum: 84 characters / 225 UTF-8 bytes.
REAL_WORLD_FREQ_DESC = (
    "每日早中晚三次增量推送；每周日凌晨全量推送；每月最后一天全量推送并生成对账文件，"
    "遇法定节假日顺延至节后首个工作日，结果写入推送变更日志并留痕· 07:30/23:00."
)
# PostgreSQL/MySQL count VARCHAR(n) in characters, so the pre-upgrade rejection
# probe must exceed 200 characters instead of 200 bytes.
OVER_CAPACITY_FREQ_DESC = "推送" * 125


def mysql_configured() -> bool:
    return bool(os.getenv(MYSQL_PROFILE) and Path(os.getenv(MYSQL_CONFIG, "")).is_file())


@unittest.skipUnless(mysql_configured(), "set dedicated MySQL integration profile/config")
class MySQLIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.profile = os.environ[MYSQL_PROFILE]
        self.environment = patch.dict(
            os.environ,
            {
                "ASSET_DB_PROFILE": self.profile,
                "ASSET_DB_CONFIG_PATH": os.environ[MYSQL_CONFIG],
            },
            clear=False,
        )
        self.environment.start()
        clear_engine_cache()
        execute_core(self.profile, delete(admin_user).where(admin_user.c.username.like("contract-%")))

    def tearDown(self):
        clear_engine_cache()
        self.environment.stop()

    def test_crud_batch_pagination_unique_constraint_and_rollback(self):
        execute_many(
            self.profile,
            "INSERT INTO __app__.p_admin_user "
            "(id, username, password_hash, status, role) VALUES (?, ?, ?, ?, ?)",
            [
                (910001, "contract-a", "hash", "ACTIVE", "admin"),
                (910002, "contract-b", "hash", "ACTIVE", "admin"),
            ],
        )
        execute_core(
            self.profile,
            insert(admin_user).values(
                id=910005,
                username="contract-中文😀",
                password_hash="hash",
                display_name="演示用户😀",
                last_login_at=None,
                status="ACTIVE",
                role="admin",
            ),
        )
        columns, rows = fetch_all_core(
            self.profile,
            select(admin_user.c.username, admin_user.c.display_name, admin_user.c.last_login_at)
            .where(admin_user.c.username == "contract-中文😀"),
        )
        self.assertEqual(["username", "display_name", "last_login_at"], columns)
        self.assertEqual([("contract-中文😀", "演示用户😀", None)], rows)
        columns, rows = fetch_all_core(
            self.profile,
            select(admin_user.c.username)
            .where(admin_user.c.username.like("contract-%"))
            .order_by(admin_user.c.username)
            .limit(1)
            .offset(1),
        )
        self.assertEqual(["username"], columns)
        self.assertEqual([("contract-b",)], rows)

        with self.assertRaises(IntegrityError):
            execute_core(
                self.profile,
                insert(admin_user).values(
                    id=910003,
                    username="contract-a",
                    password_hash="hash",
                    status="ACTIVE",
                    role="admin",
                ),
            )

        with self.assertRaisesRegex(RuntimeError, "force rollback"), database_transaction():
            execute_core(
                self.profile,
                insert(admin_user).values(
                    id=910004,
                    username="contract-rollback",
                    password_hash="hash",
                    status="ACTIVE",
                    role="admin",
                ),
            )
            raise RuntimeError("force rollback")
        _, rows = fetch_all_core(
            self.profile,
            select(admin_user.c.username).where(admin_user.c.username == "contract-rollback"),
        )
        self.assertEqual([], rows)


@unittest.skipUnless(mysql_configured(), "set dedicated MySQL integration profile/config")
class MySQLFreqDescCapacityTests(unittest.TestCase):
    """Real ``p_push_job.freq_desc`` widening from the legacy ``VARCHAR(200)``."""

    def setUp(self):
        self.profile = os.environ[MYSQL_PROFILE]
        self.config_path = Path(os.environ[MYSQL_CONFIG])
        self.environment = patch.dict(
            os.environ,
            {"ASSET_DB_PROFILE": self.profile, "ASSET_DB_CONFIG_PATH": str(self.config_path)},
            clear=False,
        )
        self.environment.start()
        self.addCleanup(self.environment.stop)
        clear_engine_cache()
        self.addCleanup(clear_engine_cache)
        schema = get_db_profile(self.profile).get("schema")
        self.prefix = f"{schema}." if schema else ""
        self.addCleanup(self._delete_probe_rows)
        self._delete_probe_rows()

    def _delete_probe_rows(self):
        execute_sql(
            self.profile,
            f"DELETE FROM {self.prefix}p_push_job WHERE job_code LIKE 'dap315-%'",
        )
        execute_sql(
            self.profile,
            f"DELETE FROM {self.prefix}p_push_system WHERE system_code LIKE 'dap315-%'",
        )

    def _scalar(self, sql, params=None):
        _, rows = fetch_all(self.profile, sql, params=params)
        return rows[0][0]

    def _run_cli(self, command):
        environment = dict(os.environ)
        environment.setdefault("APP_SECRET_KEY", "test-only-migration-secret")
        return subprocess.run(
            [
                sys.executable,
                str(MIGRATE),
                command,
                "--profile",
                self.profile,
                "--config",
                str(self.config_path),
            ],
            cwd=REPO_ROOT,
            env=environment,
            capture_output=True,
            text=True,
            timeout=180,
        )

    def test_existing_200_column_upgrades_to_1000_and_keeps_all_values(self):
        job_table = f"{self.prefix}p_push_job"
        system_table = f"{self.prefix}p_push_system"
        execute_sql(
            self.profile,
            f"INSERT INTO {system_table} "
            "(system_id, system_code, system_name, system_abbr, protocol_type, host_name, port_no) "
            "VALUES (315001, 'dap315-mysql', 'DAP 315 system', 'D315', 'SFTP', 'dap315.invalid', 22)",
        )
        execute_sql(
            self.profile,
            f"INSERT INTO {job_table} "
            "(job_id, system_id, job_code, job_name, target_file_name, freq_desc) "
            "VALUES (315001, 315001, 'dap315-mysql-legacy', 'DAP 315 legacy job', 'dap315.csv', '每日')",
        )
        execute_sql(self.profile, f"ALTER TABLE {job_table} MODIFY freq_desc VARCHAR(200)")
        execute_sql(
            self.profile,
            f"UPDATE {self.prefix}alembic_version SET version_num = '{LEGACY_REVISION}'",
        )
        self.assertEqual(
            200,
            self._scalar(
                "SELECT character_maximum_length FROM information_schema.columns "
                "WHERE table_schema = DATABASE() AND table_name = 'p_push_job' "
                "AND column_name = 'freq_desc'"
            ),
        )

        with self.assertRaises(Exception) as raised:
            execute_sql(
                self.profile,
                f"INSERT INTO {job_table} "
                "(job_id, system_id, job_code, job_name, target_file_name, freq_desc) "
                "VALUES (315002, 315001, 'dap315-mysql-too-long', 'DAP 315 long job', "
                "'dap315-long.csv', ?)",
                params=[OVER_CAPACITY_FREQ_DESC],
            )
        self.assertIn("too long", str(raised.exception).lower())

        applied = self._run_cli("apply")
        self.assertEqual(0, applied.returncode, applied.stderr)
        verified = self._run_cli("verify")
        self.assertEqual(0, verified.returncode, verified.stderr)
        self.assertIn("verify=ok", verified.stdout)

        self.assertEqual(
            repository_alembic_head(),
            self._scalar(f"SELECT version_num FROM {self.prefix}alembic_version"),
        )
        self.assertEqual(
            1000,
            self._scalar(
                "SELECT character_maximum_length FROM information_schema.columns "
                "WHERE table_schema = DATABASE() AND table_name = 'p_push_job' "
                "AND column_name = 'freq_desc'"
            ),
        )
        self.assertEqual(
            "每日",
            self._scalar(f"SELECT freq_desc FROM {job_table} WHERE job_id = 315001"),
        )
        execute_sql(
            self.profile,
            f"INSERT INTO {job_table} "
            "(job_id, system_id, job_code, job_name, target_file_name, freq_desc) "
            "VALUES (315002, 315001, 'dap315-mysql-long', 'DAP 315 long job', "
            "'dap315-long.csv', ?)",
            params=[REAL_WORLD_FREQ_DESC],
        )
        self.assertEqual(
            REAL_WORLD_FREQ_DESC,
            self._scalar(f"SELECT freq_desc FROM {job_table} WHERE job_id = 315002"),
        )
        execute_sql(
            self.profile,
            f"INSERT INTO {job_table} "
            "(job_id, system_id, job_code, job_name, target_file_name, freq_desc) "
            "VALUES (315003, 315001, 'dap315-mysql-over-capacity', 'DAP 315 over capacity', "
            "'dap315-over.csv', ?)",
            params=[OVER_CAPACITY_FREQ_DESC],
        )
        self.assertEqual(
            OVER_CAPACITY_FREQ_DESC,
            self._scalar(f"SELECT freq_desc FROM {job_table} WHERE job_id = 315003"),
        )


if __name__ == "__main__":
    unittest.main()
