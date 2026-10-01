from __future__ import annotations

import re
import unittest
from pathlib import Path

# pi-lens-ignore: reportMissingImports
from backend.app.migrations.schema import (
    SUPPORTED_DIALECTS,
    baseline_path,
    baseline_schema,
    baseline_tables,
)


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

    def test_structural_inventory_is_identical_across_dialects(self):
        models = {dialect: baseline_schema(dialect) for dialect in SUPPORTED_DIALECTS}
        reference = models["sqlite"]
        for dialect, model in models.items():
            self.assertEqual(set(reference.tables), set(model.tables), dialect)
            for table_name in reference.tables:
                expected = reference.tables[table_name]
                actual = model.tables[table_name]
                self.assertEqual(set(expected.columns), set(actual.columns), f"{dialect}.{table_name}.columns")
                self.assertEqual(expected.primary_key, actual.primary_key, f"{dialect}.{table_name}.primary_key")
                self.assertEqual(expected.unique_constraints, actual.unique_constraints, f"{dialect}.{table_name}.unique")
                self.assertEqual(expected.foreign_keys, actual.foreign_keys, f"{dialect}.{table_name}.foreign_keys")
                self.assertEqual(expected.indexes, actual.indexes, f"{dialect}.{table_name}.indexes")

    def test_core_table_columns_are_preserved(self):
        contracts = {
            "p_asset_table": {"asset_id", "table_name", "layer_code", "domain_code"},
            "p_asset_field": {"field_id", "asset_id", "field_name", "data_type"},
            "p_indicator_item": {
                "indicator_pk", "result_table_name", "result_field_name",
                "source_asset_id", "result_field_id", "aggregation_code", "semantic_state",
            },
            "p_admin_user": {"id", "username", "password_hash", "role"},
            "p_role": {"role_code", "name", "description", "builtin", "enabled"},
            "p_permission": {"permission_code", "resource", "action", "name"},
            "p_role_permission": {"role_code", "permission_code"},
            "p_api_asset": {"api_pk", "api_code", "api_name", "system_id"},
            "p_upstream_system": {"system_pk", "data_source_id", "system_id", "host_name"},
            "p_push_system": {"system_id", "master_system_id", "system_code", "protocol_type"},
            "p_push_job": {"job_id", "system_id", "job_code", "target_file_name"},
            "p_report_asset": {"report_pk", "report_code", "related_tables_json"},
            "p_manual_code_table": {"table_id", "table_code", "table_style"},
            "p_lineage_snapshot": {"snapshot_id", "import_batch_id", "status_code"},
            "p_lineage_node": {"snapshot_id", "node_id", "attributes_json"},
            "p_lineage_edge": {"snapshot_id", "edge_id", "source_node_id", "target_node_id"},
        }
        for dialect, sql in self.sql.items():
            for table, columns in contracts.items():
                body = _table_body(sql, table)
                for column in columns:
                    self.assertRegex(body, rf"\b{column}\b", f"{dialect}.{table}.{column}")

    def test_manual_code_table_status_is_binary_across_dialects(self):
        for dialect, sql in self.sql.items():
            body = _table_body(sql, "p_manual_code_table")
            self.assertIn("default 'enabled'", body, dialect)
            self.assertIn("status_code in ('enabled', 'disabled')", body, dialect)
            self.assertNotIn("'active'", body, dialect)
            self.assertNotIn("'draft'", body, dialect)

    def test_primary_and_unique_constraints_exist_across_dialects(self):
        for dialect, sql in self.sql.items():
            normalized = sql.lower()
            self.assertIn("primary key", normalized, dialect)
            self.assertIn("unique", normalized, dialect)

    def test_indexes_and_foreign_keys_keep_the_same_contract(self):
        required = (
            "idx_p_api_asset_filter",
            "idx_p_field_mapping_table_source",
            "idx_p_field_mapping_table_identity",
            "idx_p_upstream_system_ix_01",
            "idx_p_push_system_ix_01",
            "idx_p_report_asset_ix_01",
            "idx_p_indicator_semantic_ref",
            "idx_p_manual_code_table_filter",
            "idx_p_lineage_node_lookup",
            "idx_p_role_permission_permission",
            "foreign key (system_id)",
            "foreign key (data_source_id)",
            "foreign key (upstream_system_id)",
            "foreign key (table_pk)",
            "on delete cascade",
            "foreign key (master_system_id)",
            "foreign key (snapshot_id)",
            "foreign key (role_code)",
            "foreign key (permission_code)",
        )
        for dialect, sql in self.sql.items():
            normalized = " ".join(sql.lower().split())
            for fragment in required:
                self.assertIn(fragment, normalized, f"{dialect}: {fragment}")

    def test_field_mapping_business_identity_has_a_non_unique_cross_dialect_index(self):
        expected_identity = (
            "upstream_system_id",
            "source_table_name",
            "target_layer_code",
            "target_table_name",
            "load_mode",
        )
        for dialect in SUPPORTED_DIALECTS:
            table = baseline_schema(dialect).tables["p_field_mapping_table"]
            identity_index = table.indexes.get("idx_p_field_mapping_table_identity")
            self.assertIsNotNone(identity_index, dialect)
            self.assertEqual(expected_identity, identity_index.columns, dialect)
            self.assertFalse(identity_index.unique, dialect)
            self.assertNotIn("idx_p_field_mapping_table_uk_01", table.indexes, dialect)
            self.assertTrue(table.columns["target_table_name"].nullable, dialect)
            self.assertTrue(table.columns["load_mode"].nullable, dialect)
            self.assertNotIn(
                ("upstream_system_id", "source_table_name"),
                table.unique_constraints,
                dialect,
            )

    def test_supplementary_pg_and_dws_ddl_use_the_same_non_unique_identity_index(self):
        project_root = Path(__file__).resolve().parents[2]
        for relative_path in (
            "docs/pg/field-mappings-app-pg-ddl.sql",
            "docs/dws/field-mappings-app-dws-ddl.sql",
        ):
            sql = (project_root / relative_path).read_text(encoding="utf-8")
            self.assertNotIn("idx_p_field_mapping_table_uk_01", sql.lower())
            self.assertRegex(
                sql.lower(),
                re.compile(
                    r"create\s+index(?:\s+if\s+not\s+exists)?\s+"
                    r"idx_p_field_mapping_table_identity\s+on\s+"
                    r"(?:dwp\.)?p_field_mapping_table\s*\(\s*"
                    r"upstream_system_id\s*,\s*source_table_name\s*,\s*"
                    r"target_layer_code\s*,\s*target_table_name\s*,\s*load_mode\s*\)",
                    re.I | re.S,
                ),
            )
            self.assertNotRegex(
                sql.lower(),
                r"create\s+unique\s+index[^;]*p_field_mapping_table",
            )

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
