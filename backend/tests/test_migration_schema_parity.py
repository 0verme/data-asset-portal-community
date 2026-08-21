from __future__ import annotations

import re
import unittest

from backend.app.migrations.schema import SUPPORTED_DIALECTS, baseline_path, baseline_tables


def _table_body(sql: str, table: str) -> str:
    match = re.search(
        rf"CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(?:dwp\.)?{re.escape(table)}\s*\((.*?)\)\s*(?:ENGINE|;)",
        sql,
        re.I | re.S,
    )
    if not match:
        raise AssertionError(f"missing DDL body for {table}")
    return match.group(1).lower()


class MigrationSchemaParityTests(unittest.TestCase):
    def setUp(self):
        self.sql = {
            dialect: baseline_path(dialect).read_text(encoding="utf-8")
            for dialect in SUPPORTED_DIALECTS
        }

    def test_table_inventory_is_identical(self):
        expected = set(baseline_tables("sqlite"))
        for dialect in SUPPORTED_DIALECTS:
            self.assertEqual(expected, set(baseline_tables(dialect)), dialect)

    def test_core_table_columns_are_preserved(self):
        contracts = {
            "p_asset_table": {"asset_id", "table_name", "layer_code", "domain_code"},
            "p_asset_field": {"field_id", "asset_id", "field_name", "data_type"},
            "p_admin_user": {"id", "username", "password_hash", "role"},
            "p_api_asset": {"api_pk", "api_code", "api_name", "system_id"},
        }
        for dialect, sql in self.sql.items():
            for table, columns in contracts.items():
                body = _table_body(sql, table)
                for column in columns:
                    self.assertRegex(body, rf"\b{column}\b", f"{dialect}.{table}.{column}")

    def test_primary_and_unique_constraints_exist_across_dialects(self):
        for dialect, sql in self.sql.items():
            normalized = sql.lower()
            self.assertIn("primary key", normalized, dialect)
            self.assertIn("unique", normalized, dialect)

    def test_indexes_and_foreign_keys_keep_the_same_contract(self):
        required = (
            "idx_p_api_asset_filter",
            "idx_p_field_mapping_table_source",
            "foreign key (system_id)",
            "foreign key (data_source_id)",
            "foreign key (table_pk)",
            "on delete cascade",
        )
        for dialect, sql in self.sql.items():
            normalized = " ".join(sql.lower().split())
            for fragment in required:
                self.assertIn(fragment, normalized, f"{dialect}: {fragment}")

    def test_portable_defaults_are_preserved(self):
        required = (
            "default current_timestamp",
            "default 'system'",
            "default 'n'",
            "default 'y'",
        )
        for dialect, sql in self.sql.items():
            normalized = sql.lower()
            for fragment in required:
                self.assertIn(fragment, normalized, f"{dialect}: {fragment}")


if __name__ == "__main__":
    unittest.main()
