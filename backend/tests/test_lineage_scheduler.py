# Copyright 2025 Jearhe
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Scheduler source adapter boundary: configurable, identifier-safe table names."""

from __future__ import annotations

import unittest
from unittest.mock import patch

from backend.app.services.lineage.scheduler import (
    DEFAULT_JOB_TABLE,
    DEFAULT_PROGRAM_TABLE,
    JOB_TABLE_ENV,
    PROGRAM_TABLE_ENV,
    job_sql,
    program_sql,
    resolve_scheduler_tables,
    validate_identifier,
)
from backend.app.services.lineage_collector import build_snapshot


class IdentifierValidationTests(unittest.TestCase):
    def test_accepts_plain_identifiers(self):
        self.assertEqual("p_job_hjj", validate_identifier("p_job_hjj", "job table"))
        self.assertEqual("P_program_1", validate_identifier("P_program_1", "program table"))

    def test_rejects_unsafe_identifiers(self):
        for value in (
            "p_job; DROP TABLE x",
            "p_job--",
            "p_job' OR '1'='1",
            "dwp.p_job_hjj",  # schema-qualified names are not accepted
            "1p_job",
            "p job",
            "",
            "p_job_hjj]",
        ):
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    validate_identifier(value, "job table")


class SchedulerTableResolutionTests(unittest.TestCase):
    def test_defaults_to_community_generic_names(self):
        tables = resolve_scheduler_tables()
        self.assertEqual((DEFAULT_JOB_TABLE, DEFAULT_PROGRAM_TABLE), tables)

    def test_explicit_arguments_win_over_environment(self):
        with patch.dict("os.environ", {JOB_TABLE_ENV: "p_job_env", PROGRAM_TABLE_ENV: "p_program_env"}):
            tables = resolve_scheduler_tables(job_table="p_job_arg")
            self.assertEqual("p_job_arg", tables.job_table)
            self.assertEqual("p_program_env", tables.program_table)

    def test_environment_override(self):
        with patch.dict("os.environ", {JOB_TABLE_ENV: "p_job_hjj", PROGRAM_TABLE_ENV: "p_program_hjj"}):
            tables = resolve_scheduler_tables()
            self.assertEqual(("p_job_hjj", "p_program_hjj"), tables)

    def test_invalid_environment_value_is_rejected(self):
        with patch.dict("os.environ", {JOB_TABLE_ENV: "p_job; DROP TABLE"}):
            with self.assertRaises(ValueError):
                resolve_scheduler_tables()


class SchedulerSqlTests(unittest.TestCase):
    def test_sql_uses_resolved_table_names(self):
        tables = resolve_scheduler_tables("p_job_custom", "p_program_custom")
        self.assertIn("dwp.p_job_custom", job_sql(tables.job_table))
        job_stmt = program_sql(tables.job_table, tables.program_table)
        self.assertIn("dwp.p_job_custom job", job_stmt)
        self.assertIn("dwp.p_program_custom program", job_stmt)
        self.assertNotIn(";", job_stmt.splitlines()[0].strip().rstrip(","))


class SnapshotMetadataUsesSourceTablesTests(unittest.TestCase):
    JOB_ROWS = [("PLAN_A", "JOB_A", "")]
    TABLE_JOB_ROWS = [("DWF.ACCOUNT", "JOB_A")]

    def test_generator_and_source_reflect_injected_table_names(self):
        snapshot = build_snapshot(
            self.JOB_ROWS,
            self.TABLE_JOB_ROWS,
            snapshot_id="S1",
            generated_at="2026-01-01T00:00:00Z",
            job_table="p_job_custom",
            program_table="p_program_custom",
        )
        self.assertEqual("p_job_custom+p_program_custom-collector", snapshot["generator"]["name"])
        self.assertIn("dwp.p_job_custom", snapshot["nodes"][0]["attributes"]["source"])
        self.assertIn(
            "p_program_custom",
            snapshot["edges"][0]["evidence"]["sourceRecordId"],
        )

    def test_default_snapshot_uses_generic_community_names(self):
        snapshot = build_snapshot(
            self.JOB_ROWS,
            self.TABLE_JOB_ROWS,
            snapshot_id="S2",
            generated_at="2026-01-01T00:00:00Z",
        )
        self.assertEqual("p_job+p_program-collector", snapshot["generator"]["name"])
        self.assertNotIn("hjj", snapshot["generator"]["name"])

    def test_empty_source_error_names_the_configured_table(self):
        with self.assertRaisesRegex(ValueError, "p_job_custom contains no usable jobs"):
            build_snapshot(
                [],
                self.TABLE_JOB_ROWS,
                job_table="p_job_custom",
                program_table="p_program_custom",
            )


if __name__ == "__main__":
    unittest.main()
