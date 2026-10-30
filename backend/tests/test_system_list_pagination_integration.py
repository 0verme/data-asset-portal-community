"""Real provider pagination contracts on isolated, explicitly opted-in databases.

SQLite always runs. PostgreSQL/MySQL use the repository's dedicated TEST_*
profiles (including CI disposable services), never an ambient application
profile. Only synthetic, uniquely named task objects are written/cleaned.
"""
from __future__ import annotations

import os
import tempfile
import unittest
import uuid
from pathlib import Path
from time import perf_counter
from unittest.mock import patch

from sqlalchemy import delete, insert, select

from backend.app.db.core import execute_statements_core, fetch_all_core, next_pk
from backend.app.db.facade import clear_engine_cache, connect_with_profile, database_transaction, get_db_profile
from backend.app.db.tables import push_job, push_job_field, push_system, upstream_system
from backend.app.migrations.schema import initialize
from backend.app.services.common_code_service import common_code_service
from backend.app.services.push_service import PushService
from backend.app.services.upstream_service import UpstreamService


def _configured(profile_key, config_key):
    return bool(os.getenv(profile_key) and Path(os.getenv(config_key, "")).is_file())


class _RecordingCursor:
    """Delegate to the actual driver; record only successfully executed SQL."""
    def __init__(self, cursor, record):
        self.cursor = cursor
        self.record = record

    def execute(self, sql, params=None):
        started = perf_counter()
        result = self.cursor.execute(sql) if params is None else self.cursor.execute(sql, params)
        self.record.append((str(sql), params, (perf_counter() - started) * 1000))
        return result

    def __getattr__(self, name):
        return getattr(self.cursor, name)


class _RecordingConnection:
    def __init__(self, connection, record):
        self.connection = connection
        self.record = record

    def cursor(self, *args, **kwargs):
        return _RecordingCursor(self.connection.cursor(*args, **kwargs), self.record)

    def __getattr__(self, name):
        return getattr(self.connection, name)


class _SystemPaginationContract:
    provider = "sqlite"
    profile_env = ""
    config_env = ""

    def setUp(self):
        if self.provider == "sqlite":
            temporary = tempfile.TemporaryDirectory(prefix="dap-464-provider-")
            self.addCleanup(temporary.cleanup)
            database = Path(temporary.name) / "pagination.sqlite"
            config_path = Path(temporary.name) / "config.yaml"
            config_path.write_text(
                f"profiles:\n  dap_464_sqlite:\n    type: sqlite\n    database: '{database.as_posix()}'\n",
                encoding="utf-8",
            )
            self.profile = "dap_464_sqlite"
        else:
            self.profile = os.environ[self.profile_env]
            config_path = Path(os.environ[self.config_env])
        environment = patch.dict(os.environ, {
            "ASSET_DB_PROFILE": self.profile, "ASSET_DB_CONFIG_PATH": str(config_path),
        })
        environment.start()
        self.addCleanup(environment.stop)
        # Explicit dedicated profiles must not be silently redirected by a
        # developer's ambient application connection overrides.
        for key in ("TYPE", "HOST", "PORT", "DATABASE", "USER", "PASSWORD", "DSN", "JDBC_URL"):
            os.environ.pop(f"ASSET_DB_{key}", None)
        clear_engine_cache()
        self.addCleanup(clear_engine_cache)
        config = get_db_profile(self.profile)
        self.assertEqual(self.provider, config["type"])
        if self.provider == "sqlite":
            connection = connect_with_profile(self.profile)
            try:
                self.assertTrue(initialize(connection, config, "sqlite"))
            finally:
                connection.close()
        dictionary_profile = patch.object(common_code_service, "_db_profile", self.profile)
        dictionary_profile.start()
        self.addCleanup(dictionary_profile.stop)
        self.upstream = UpstreamService()
        self.push = PushService()
        self.baseline_up = self.upstream.get_system_page(page=1, page_size=1)["stats"]["systemCount"]
        self.baseline_push = self.push.get_push_system_page(page=1, page_size=1)["stats"]
        self.prefix = f"D464_{uuid.uuid4().hex[:8]}_"
        self.job_keyword = f"jobneedle{uuid.uuid4().hex[:8]}"
        up_start = next_pk(self.profile, upstream_system, upstream_system.c.system_pk)
        push_start = next_pk(self.profile, push_system, push_system.c.system_id)
        job_start = next_pk(self.profile, push_job, push_job.c.job_id)
        field_start = next_pk(self.profile, push_job_field, push_job_field.c.field_id)
        self.up_ids = list(range(up_start, up_start + 8))
        self.push_ids = list(range(push_start, push_start + 8))
        self.up_codes = [f"{self.prefix}U{index:02}" for index in range(1, 9)]
        self.push_codes = [f"{self.prefix}P{index:02}" for index in range(1, 9)]
        self.job_codes = [f"{self.prefix}J{index:02}" for index in range(24)]
        self.addCleanup(self._clean_owned_fixture)
        statements = []
        for offset in range(8):
            index = offset + 1
            deleted = "Y" if index == 8 else "N"
            statements.extend([
                insert(upstream_system).values(
                    system_pk=self.up_ids[offset], system_id=self.up_codes[offset], system_abbr="SAME",
                    system_name=f"{self.prefix} system", db_type="PostgreSQL", host_name="fixture.demo.invalid",
                    status_code="enabled" if index % 2 else "disabled", dept_name="DAP464", is_deleted=deleted,
                ),
                insert(push_system).values(
                    system_id=self.push_ids[offset], system_code=self.push_codes[offset], system_abbr="SAME",
                    system_name=f"{self.prefix} system", protocol_type="SFTP", host_name="fixture.demo.invalid", port_no=22,
                    status_code="enabled" if index % 2 else "disabled", importance_level_code="important" if index % 3 == 1 else "normal",
                    dept_name="DAP464", job_count=999, is_deleted=deleted,
                ),
            ])
            for number in range(3):
                job_id = job_start + offset * 3 + number
                statements.extend([
                    insert(push_job).values(
                        job_id=job_id, system_id=self.push_ids[offset], job_code=self.job_codes[offset * 3 + number],
                        job_name=self.job_keyword if index % 3 == 1 else "Other fixture job",
                        target_file_name="fixture.csv", freq_type="DAP464-only-last" if index == 7 else "T+1",
                        is_deleted="Y" if number == 2 else "N",
                    ),
                    insert(push_job_field).values(
                        field_id=field_start + offset * 3 + number, job_id=job_id,
                        field_name="fixture_id", field_cn_name="Fixture", data_type="string",
                    ),
                ])
        with database_transaction():
            execute_statements_core(self.profile, statements)
        self.executed_sql = []

        def record_connection(*args, **kwargs):
            return _RecordingConnection(connect_with_profile(*args, **kwargs), self.executed_sql)

        recorder = patch("backend.app.db.facade.connect_with_profile", side_effect=record_connection)
        recorder.start()
        self.addCleanup(recorder.stop)

    def _clean_owned_fixture(self):
        owned_push = select(push_system.c.system_id).where(
            push_system.c.system_id.in_(self.push_ids), push_system.c.system_code.in_(self.push_codes),
        )
        owned_jobs = select(push_job.c.job_id).where(
            push_job.c.system_id.in_(owned_push), push_job.c.job_code.in_(self.job_codes),
        )
        with database_transaction():
            execute_statements_core(self.profile, [
                delete(push_job_field).where(push_job_field.c.job_id.in_(owned_jobs)),
                delete(push_job).where(push_job.c.system_id.in_(owned_push), push_job.c.job_code.in_(self.job_codes)),
                delete(push_system).where(push_system.c.system_id.in_(self.push_ids), push_system.c.system_code.in_(self.push_codes)),
                delete(upstream_system).where(upstream_system.c.system_pk.in_(self.up_ids), upstream_system.c.system_id.in_(self.up_codes)),
            ])
        # Exact ownership cleanup, not deletion of existing integration/demo rows.
        _, remaining = fetch_all_core(self.profile, select(push_system.c.system_id).where(push_system.c.system_code.in_(self.push_codes)))
        self.assertEqual([], remaining)

    def _assert_executed_page_sql(self, table):
        statements = [(sql, params, duration) for sql, params, duration in self.executed_sql
                      if table in sql and "ORDER BY" in sql and "LIMIT" in sql]
        self.assertTrue(statements, f"No executed, bounded {table} query")
        sql, params, duration = statements[0]
        # Synthetic query binds only; no credentials or connection configuration.
        print(f"Pagination SQL [{self.provider}] execute_ms={duration:.3f}: {sql}; binds={params!r}")

    def test_upstream_real_filter_count_stable_pages_and_legacy(self):
        ids = []
        for page, count in ((1, 3), (2, 3), (3, 1), (4, 0)):
            result = self.upstream.get_system_page(keyword=self.prefix, page=page, page_size=3, profile="strict")
            self.assertEqual((7, count), (result["total"], len(result["items"])))
            self.assertEqual(self.baseline_up + 7, result["stats"]["systemCount"])
            ids.extend(item["id"] for item in result["items"])
        self.assertEqual(self.up_codes[:7], ids)
        filtered = self.upstream.get_system_page(keyword=self.prefix, status="enabled", page=1, page_size=2)
        self.assertEqual(4, filtered["total"])
        self.assertEqual(self.up_codes[:3:2], [item["id"] for item in filtered["items"]])
        legacy = self.upstream.get_systems(keyword=self.prefix)
        self.assertEqual(7, len(legacy))
        self.assertEqual(self.up_codes[6], self.upstream.get_system_detail(self.up_codes[6])["id"])
        self._assert_executed_page_sql("p_upstream_system")

    def test_push_real_job_search_count_importance_lightweight_and_global_options(self):
        ids = []
        for page in range(1, 5):
            result = self.push.get_push_system_page(keyword=self.prefix, page=page, page_size=3)
            self.assertEqual(7, result["total"])
            self.assertTrue(all(item["jobs"] == [] and item["jobCount"] == 2 for item in result["items"]))
            self.assertEqual(self.baseline_push["systemCount"] + 7, result["stats"]["systemCount"])
            self.assertEqual(self.baseline_push["jobCount"] + 14, result["stats"]["jobCount"])
            self.assertTrue(set(self.push_codes[:7]) <= set(result["options"]["systemIds"]))
            self.assertNotIn(self.push_codes[7], result["options"]["systemIds"])
            self.assertIn("DAP464-only-last", result["options"]["freqTypes"])
            ids.extend(item["id"] for item in result["items"])
        self.assertEqual([self.push_codes[index] for index in (0, 3, 6, 1, 2, 4, 5)], ids)
        filtered = self.push.get_push_system_page(keyword=self.job_keyword, importance_level="important", status="enabled",
                                                page=2, page_size=1)
        self.assertEqual(2, filtered["total"])
        self.assertEqual(self.push_codes[6], filtered["items"][0]["id"])
        self.assertFalse(any("p_push_job_field" in sql for sql, _params, _duration in self.executed_sql))
        self._assert_executed_page_sql("p_push_system")

    def test_push_real_details_legacy_fields_empty_and_descending_sort(self):
        result = self.push.get_push_system_page(keyword=self.prefix, page=1, page_size=2, sort_key="id", sort_direction="desc")
        self.assertEqual(self.push_codes[5:7][::-1], [item["id"] for item in result["items"]])
        empty = self.push.get_push_system_page(keyword=self.prefix, protocol="not-a-fixture-protocol", page=1, page_size=2)
        self.assertEqual((0, []), (empty["total"], empty["items"]))
        legacy = self.push.get_push_systems(keyword=self.prefix)
        self.assertEqual(7, len(legacy))
        self.assertTrue(all(len(system["jobs"]) == 2 for system in legacy))
        detail = self.push.get_push_system_detail(self.push_codes[6])
        self.assertEqual(self.push_codes[6], detail["id"])
        self.assertEqual(2, len(detail["jobs"]))
        self.assertTrue(all(job["fields"][0]["name"] == "fixture_id" for job in detail["jobs"]))
        self._assert_executed_page_sql("p_push_system")


class SQLiteSystemPaginationIntegrationTests(_SystemPaginationContract, unittest.TestCase):
    pass


@unittest.skipUnless(_configured("TEST_DATABASE_PROFILE", "TEST_DATABASE_CONFIG_PATH"), "dedicated PostgreSQL test profile not configured")
class PostgresSystemPaginationIntegrationTests(_SystemPaginationContract, unittest.TestCase):
    provider = "postgres"
    profile_env = "TEST_DATABASE_PROFILE"
    config_env = "TEST_DATABASE_CONFIG_PATH"


@unittest.skipUnless(_configured("TEST_MYSQL_DATABASE_PROFILE", "TEST_MYSQL_DATABASE_CONFIG_PATH"), "dedicated MySQL test profile not configured")
class MySQLSystemPaginationIntegrationTests(_SystemPaginationContract, unittest.TestCase):
    provider = "mysql"
    profile_env = "TEST_MYSQL_DATABASE_PROFILE"
    config_env = "TEST_MYSQL_DATABASE_CONFIG_PATH"


if __name__ == "__main__":
    unittest.main()
