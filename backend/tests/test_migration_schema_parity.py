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

"""Community schema parity contracts.

The migration manifest (backend/migrations/manifest.json + <dialect>/*.sql) is
the schema source of truth. These tests pin the Community logical schema and
require the SQLite / PostgreSQL / DWS migration trees to stay aligned, and the
demo seed plan to stay within Community-owned tables with canonical columns.

NOTE: the DWS assertions are static SQL contract checks. No real GaussDB/DWS
instance was used, so DWS is NOT integration-tested by this suite.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

from backend.app.migrations.manifest import load_manifest

BACKEND = Path(__file__).resolve().parents[1]
MIGRATIONS = BACKEND / "migrations"
DEMO = BACKEND.parent / "demo"

# Community core tables created by migration 0005 (create_community_core_runtime)
# plus 0006 (complete_community_runtime_tables).
COMMUNITY_CORE_TABLES = {
    "p_admin_user",
    "p_asset_domain",
    "p_asset_layer",
    "p_asset_table",
    "p_asset_field",
    "p_asset_change_log",
    "p_root_category",
    "p_root_item",
    "p_indicator_item",
    "p_indicator_path_config",
    "p_operation_log",
    # 0006 runtime tables
    "p_menu",
    "p_code_category",
    "p_code_item",
    "p_root_change_log",
    "p_indicator_change_log",
}

# Tables owned by private modules (upstream / report / push / codeTable).
PRIVATE_TABLES = {
    "p_push_system",
    "p_push_job",
    "p_push_job_field",
    "p_push_change_log",
    "p_upstream_system",
    "p_upstream_unload_time",
    "p_upstream_change_log",
    "p_report_asset",
    "p_manual_code_table",
}

# Canonical columns that Community runtime queries actually depend on.
CANONICAL_COLUMNS = {
    "p_asset_domain": {"domain_code", "domain_name", "display_order", "is_active"},
    "p_asset_layer": {"layer_code", "layer_name", "display_order", "is_active"},
    "p_asset_table": {
        "asset_id", "table_name", "table_cn_name", "schema_name", "layer_code",
        "domain_code", "owner_name", "grain_desc", "cycle_desc", "table_desc",
        "field_count", "is_deleted",
    },
    "p_asset_field": {
        "field_id", "asset_id", "field_name", "field_cn_name", "data_type",
        "field_order", "nullable_flag", "pk_flag", "partition_flag",
        "enum_desc", "field_desc", "is_deleted",
    },
    "p_root_item": {"root_id", "root_abbr", "root_en_name", "root_cn_name", "category_name"},
    "p_indicator_item": {"indicator_pk", "indicator_id", "indicator_name", "status_code"},
    "p_admin_user": {"id", "username", "password_hash", "role", "status"},
    "p_operation_log": {"id", "module_name", "operation_type", "result_status", "created_at"},
}


def _table_columns(sql: str) -> dict[str, set[str]]:
    """Return {table_name: set(column names)} from CREATE TABLE blocks."""
    result: dict[str, set[str]] = {}
    for match in re.finditer(
        r"CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(?:\w+\.)?(\w+)\s*\((.*?)\)\s*(?:DISTRIBUTE\s+BY[^;]*)?;",
        sql,
        re.S | re.I,
    ):
        table, body = match.group(1), match.group(2)
        body = re.sub(r"--[^\n]*", "", body)
        columns = set(
            re.findall(
                r"(?:^|,)\s*[`\"]?(\w+)[`\"]?\s+(?:BIGINT|INTEGER|INT|TEXT|VARCHAR|CHAR|SMALLINT|TIMESTAMP|BOOLEAN|NUMERIC|DECIMAL|SERIAL|BIGSERIAL)",
                body,
                re.I,
            )
        )
        result[table] = columns
    return result


class MigrationDialectParityTests(unittest.TestCase):
    def setUp(self):
        self.manifest = load_manifest(MIGRATIONS)
        self.by_version = {m.version: m for m in self.manifest}

    def test_0005_available_for_all_three_dialects(self):
        files = self.by_version["0005"].files
        self.assertEqual({"sqlite", "postgresql", "dws"}, set(files))

    def test_0006_available_for_all_three_dialects(self):
        files = self.by_version["0006"].files
        self.assertEqual({"sqlite", "postgresql", "dws"}, set(files))

    def test_manifest_files_exist_for_every_declared_dialect(self):
        for migration in self.manifest:
            for dialect, path in migration.files.items():
                self.assertTrue(path.is_file(), f"{migration.version} {dialect} file missing")

    def test_community_core_tables_present_in_all_dialects(self):
        for dialect in ("sqlite", "postgresql", "dws"):
            sql = "\n".join(
                self.by_version[version].files[dialect].read_text(encoding="utf-8")
                for version in ("0005", "0006")
            )
            tables = _table_columns(sql)
            missing = COMMUNITY_CORE_TABLES - set(tables)
            self.assertFalse(missing, f"{dialect} migrations missing tables: {sorted(missing)}")

    def test_canonical_columns_present_in_all_dialects(self):
        for dialect in ("sqlite", "postgresql", "dws"):
            sql = self.by_version["0005"].files[dialect].read_text(encoding="utf-8")
            tables = _table_columns(sql)
            for table, columns in CANONICAL_COLUMNS.items():
                missing = columns - tables.get(table, set())
                self.assertFalse(
                    missing,
                    f"{dialect} {table} missing canonical columns: {sorted(missing)}",
                )

    def test_no_legacy_domain_or_layer_id_in_any_dialect(self):
        for dialect in ("sqlite", "postgresql", "dws"):
            sql = self.by_version["0005"].files[dialect].read_text(encoding="utf-8")
            self.assertNotIn("domain_id", sql, f"{dialect} 0005 must not declare domain_id")
            self.assertNotIn("layer_id", sql, f"{dialect} 0005 must not declare layer_id")

    def test_migrations_never_create_private_tables(self):
        for migration in self.manifest:
            for dialect, path in migration.files.items():
                tables = _table_columns(path.read_text(encoding="utf-8"))
                created_private = PRIVATE_TABLES & set(tables)
                self.assertFalse(
                    created_private,
                    f"{migration.version} {dialect} creates private tables: {sorted(created_private)}",
                )


class DwsDialectSyntaxTests(unittest.TestCase):
    """Static DWS dialect checks. NOT integration-tested against a DWS instance."""

    def setUp(self):
        by_version = {m.version: m for m in load_manifest(MIGRATIONS)}
        self.sql = by_version["0005"].files["dws"].read_text(encoding="utf-8")

    def test_uses_dws_distribute_by_clauses(self):
        self.assertIn("DISTRIBUTE BY REPLICATION", self.sql)
        self.assertIn("DISTRIBUTE BY HASH", self.sql)

    def test_no_postgres_only_identity_or_serial_syntax(self):
        self.assertNotIn("GENERATED BY DEFAULT AS IDENTITY", self.sql.upper())
        self.assertNotIn("SERIAL", self.sql.upper())
        self.assertNotIn("AUTOINCREMENT", self.sql.upper())

    def test_operation_log_sequence_backed_id(self):
        self.assertIn("p_operation_log_id_seq", self.sql)
        self.assertRegex(self.sql, re.compile(r"nextval\s*\(\s*'dwp\.p_operation_log_id_seq'", re.I))


class SeedSchemaContractTests(unittest.TestCase):
    """Demo seed plan must stay within Community tables + canonical columns."""

    def setUp(self):
        import sys

        sys.path.insert(0, str(DEMO))
        from seed_loader import community_seed_plan

        self.plan = community_seed_plan()
        self.by_version = {m.version: m for m in load_manifest(MIGRATIONS)}

    def test_seed_plan_tables_exist_in_community_migrations(self):
        migration_tables = set()
        for migration in self.by_version.values():
            for dialect, path in migration.files.items():
                migration_tables.update(_table_columns(path.read_text(encoding="utf-8")))
        for table in self.plan:
            self.assertIn(table, migration_tables, f"seed plans unknown table {table}")

    def test_seed_plan_never_touches_private_tables(self):
        for table in self.plan:
            self.assertNotIn(table, PRIVATE_TABLES, f"seed must not plan private table {table}")

    def test_seed_plan_columns_exist_in_canonical_sqlite_schema(self):
        migration_tables = {}
        for migration in self.by_version.values():
            if "sqlite" not in migration.files:
                continue
            migration_tables.update(
                _table_columns(migration.files["sqlite"].read_text(encoding="utf-8"))
            )
        for table, spec in self.plan.items():
            allowed = migration_tables.get(table, set())
            extra = set(spec["columns"]) - allowed
            self.assertFalse(
                extra, f"seed {table} columns missing from migration: {sorted(extra)}"
            )

    def test_seed_plan_domain_and_layer_use_codes(self):
        self.assertEqual(
            set(self.plan["p_asset_domain"]["columns"]),
            {"domain_code", "domain_name", "display_order", "is_active", "is_deleted"},
        )
        self.assertEqual(
            set(self.plan["p_asset_layer"]["columns"]),
            {"layer_code", "layer_name", "display_order", "is_active", "is_deleted"},
        )


class DocsDdlParityTests(unittest.TestCase):
    """docs DDL is reference documentation; it must no longer contradict migrations."""

    def test_docs_asset_domain_and_layer_have_no_legacy_id_columns(self):
        for path in (
            Path("docs/pg/assets-app-pg-ddl.sql"),
            Path("docs/dws/assets-app-dws-ddl.sql"),
        ):
            sql = path.read_text(encoding="utf-8-sig", errors="replace")
            self.assertNotIn("domain_id", sql, f"{path} must not declare domain_id")
            self.assertNotIn("layer_id", sql, f"{path} must not declare layer_id")

    def test_docs_api_asset_and_field_mapping_declare_public_relations(self):
        pg_api = Path("docs/pg/api-assets-app-pg-ddl.sql").read_text(encoding="utf-8-sig", errors="replace")
        dws_api = Path("docs/dws/api-assets-app-dws-ddl.sql").read_text(encoding="utf-8-sig", errors="replace")
        for sql in (pg_api, dws_api):
            self.assertIn("system_id", sql)
        pg_fm = Path("docs/pg/field-mappings-app-pg-ddl.sql").read_text(encoding="utf-8-sig", errors="replace")
        dws_fm = Path("docs/dws/field-mappings-app-dws-ddl.sql").read_text(encoding="utf-8-sig", errors="replace")
        for sql in (pg_fm, dws_fm):
            self.assertIn("data_source_id", sql)


if __name__ == "__main__":
    unittest.main()
