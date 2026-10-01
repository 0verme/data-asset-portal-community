from __future__ import annotations

import re
import unittest
from pathlib import Path

# pi-lens-ignore: reportMissingImports
from backend.app.migrations.schema import (
    SUPPORTED_DIALECTS,
    baseline_path,
    _split_sql_statements,
    baseline_schema,
    baseline_tables,
    _normalize_reflected_column_default,
)
from backend.tests.dws_relationship_contract import (
    DWS_LOGICAL_RELATIONSHIPS,
    LogicalRelationship,
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


def _mask_sql_non_code(sql: str) -> str:
    """Mask comments and quoted values/identifiers before checking DDL tokens."""
    masked = []
    index = 0
    while index < len(sql):
        pair = sql[index:index + 2]
        if pair == "--":
            end = sql.find("\n", index)
            end = len(sql) if end < 0 else end
            masked.extend("\n" if char == "\n" else " " for char in sql[index:end])
            index = end
        elif pair == "/*":
            start = index
            depth = 1
            index += 2
            while index < len(sql) and depth:
                if sql.startswith("/*", index):
                    depth += 1
                    index += 2
                elif sql.startswith("*/", index):
                    depth -= 1
                    index += 2
                else:
                    index += 1
            masked.extend("\n" if char == "\n" else " " for char in sql[start:index])
        elif sql[index] == "$":
            match = re.match(r"\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$", sql[index:])
            if not match:
                masked.append(sql[index])
                index += 1
                continue
            delimiter = match.group(0)
            close = sql.find(delimiter, index + len(delimiter))
            end = len(sql) if close < 0 else close + len(delimiter)
            masked.extend("\n" if char == "\n" else " " for char in sql[index:end])
            index = end
        elif sql[index] in "'\"`":
            quote = sql[index]
            start = index
            index += 1
            while index < len(sql):
                if sql[index] == "\\" and quote in {"'", "`"} and index + 1 < len(sql):
                    index += 2
                elif sql[index] == quote:
                    if index + 1 < len(sql) and sql[index + 1] == quote:
                        index += 2
                    else:
                        index += 1
                        break
                else:
                    index += 1
            masked.extend("\n" if char == "\n" else " " for char in sql[start:index])
        else:
            masked.append(sql[index])
            index += 1
    return "".join(masked)


def _physical_relationship_inventory(model):
    return {
        LogicalRelationship(
            child_table=table_name,
            child_columns=foreign_key.columns,
            parent_table=foreign_key.referenced_table,
            parent_columns=foreign_key.referenced_columns,
            on_delete=foreign_key.on_delete or "NO ACTION",
        )
        for table_name, table in model.tables.items()
        for foreign_key in table.foreign_keys
    }


def _physical_fk_statement_violations(sql: str, source: str) -> list[str]:
    violations = []
    for statement in _split_sql_statements(sql):
        masked = _mask_sql_non_code(statement)
        if not re.search(r"\b(?:FOREIGN\s+KEY|REFERENCES)\b", masked, re.I):
            continue
        table_match = re.search(
            r"\bALTER\s+TABLE\s+(?:[A-Za-z0-9_]+\.)?([A-Za-z0-9_]+)",
            masked,
            re.I,
        ) or re.search(
            r"\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"
            r"(?:[A-Za-z0-9_]+\.)?([A-Za-z0-9_]+)",
            masked,
            re.I,
        )
        table = table_match.group(1) if table_match else "unknown table"
        violations.append(f"{source}:{table}: {statement[:180].replace(chr(10), ' ')}")
    return violations


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
                self.assertEqual(expected.indexes, actual.indexes, f"{dialect}.{table_name}.indexes")

    def test_sqlite_postgresql_mysql_keep_physical_foreign_keys_and_dws_keeps_logical_contract(self):
        models = {dialect: baseline_schema(dialect) for dialect in SUPPORTED_DIALECTS}
        expected = set(DWS_LOGICAL_RELATIONSHIPS)
        self.assertEqual(13, len(expected))

        for dialect in ("sqlite", "postgresql", "mysql"):
            with self.subTest(dialect=dialect):
                inventory = _physical_relationship_inventory(models[dialect])
                self.assertEqual(expected, inventory)
                self.assertEqual(13, len(inventory))

        dws = models["dws"]
        self.assertEqual(
            0,
            sum(len(table.foreign_keys) for table in dws.tables.values()),
            "DWS baseline must not model unsupported physical FOREIGN KEY constraints",
        )

        for relationship in DWS_LOGICAL_RELATIONSHIPS:
            with self.subTest(relationship=relationship):
                child = dws.tables[relationship.child_table]
                parent = dws.tables[relationship.parent_table]
                self.assertTrue(set(relationship.child_columns).issubset(child.columns))
                self.assertTrue(set(relationship.parent_columns).issubset(parent.columns))
                candidate_keys = {parent.primary_key, *parent.unique_constraints}
                candidate_keys.update(
                    index.columns for index in parent.indexes.values() if index.unique
                )
                self.assertIn(relationship.parent_columns, candidate_keys)
                self.assertEqual(len(relationship.child_columns), len(relationship.parent_columns))
                for child_column, parent_column in zip(
                    relationship.child_columns, relationship.parent_columns
                ):
                    self.assertEqual(
                        child.columns[child_column].type_name,
                        parent.columns[parent_column].type_name,
                        f"{relationship.child_table}.{child_column} -> "
                        f"{relationship.parent_table}.{parent_column} type mismatch",
                    )

    def test_dws_baseline_avoids_unsupported_813_index_if_not_exists(self):
        sql = baseline_path("dws").read_text(encoding="utf-8")
        violations = [
            statement
            for statement in _split_sql_statements(sql)
            if re.search(
                r"\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\b",
                _mask_sql_non_code(statement),
                re.I,
            )
        ]
        self.assertEqual([], violations)
        self.assertRegex(
            _mask_sql_non_code(sql),
            r"CREATE\s+INDEX\s+idx_p_asset_table_filter\s+ON\s+dwp\.p_asset_table\s*"
            r"\(\s*layer_code\s*,\s*domain_code\s*\)",
        )

    def test_dws_baseline_avoids_unsupported_813_identity_syntax(self):
        sql = baseline_path("dws").read_text(encoding="utf-8")
        violations = [
            statement
            for statement in _split_sql_statements(sql)
            if re.search(
                r"\bGENERATED\s+BY\s+DEFAULT\s+AS\s+IDENTITY\b",
                _mask_sql_non_code(statement),
                re.I,
            )
        ]
        self.assertEqual([], violations)

        operation_log = next(
            statement
            for statement in _split_sql_statements(sql)
            if re.search(r"\bp_operation_log\b", _mask_sql_non_code(statement), re.I)
        )
        self.assertRegex(
            _mask_sql_non_code(operation_log),
            r"\bid\s+BIGSERIAL\s+PRIMARY\s+KEY\b",
        )

    def test_dws_bigserial_reflects_as_logical_bigint_primary_key_without_default_drift(self):
        operation_log_id = baseline_schema("dws").tables["p_operation_log"].columns["id"]
        self.assertEqual("BIGINT", operation_log_id.type_name)
        self.assertTrue(operation_log_id.primary_key)
        self.assertFalse(operation_log_id.nullable)
        self.assertIsNone(operation_log_id.default)
        self.assertTrue(operation_log_id.generated_by_default)

        reflected_sequence_default = "nextval('dap.p_operation_log_id_seq'::regclass)"
        self.assertEqual(
            operation_log_id.default,
            _normalize_reflected_column_default(
                reflected_sequence_default,
                "BIGINT",
                db_type="gaussdb",
                expected_column=operation_log_id,
            ),
        )
        self.assertNotEqual(
            operation_log_id.default,
            _normalize_reflected_column_default(
                reflected_sequence_default,
                "BIGINT",
                db_type="postgres",
                expected_column=operation_log_id,
            ),
        )

    def test_dws_baseline_contains_no_physical_foreign_keys(self):
        sql = baseline_path("dws").read_text(encoding="utf-8")
        violations = _physical_fk_statement_violations(sql, "backend/schema/dws.sql")
        self.assertEqual([], violations)

        # Comment and string text is not executable DDL and must not trigger this contract.
        self.assertEqual(
            [],
            _physical_fk_statement_violations(
                "-- FOREIGN KEY REFERENCES are discussed here\n"
                "CREATE TABLE IF NOT EXISTS dwp.sample (note TEXT DEFAULT 'REFERENCES');",
                "fixture",
            ),
        )
        invalid_ddl = (
            "CREATE TABLE dwp.bad_relation (child_id BIGINT, "
            "FOREIGN KEY (child_id) REFERENCES dwp.parent_relation(parent_id));"
        )
        violations = _physical_fk_statement_violations(invalid_ddl, "fixture")
        self.assertEqual(1, len(violations))
        self.assertIn("bad_relation", violations[0])
        self.assertIn("CREATE TABLE", violations[0])

    def test_dws_supplementary_sql_contains_no_physical_foreign_keys(self):
        project_root = Path(__file__).resolve().parents[2]
        for path in sorted((project_root / "docs/dws").glob("*.sql")):
            with self.subTest(path=path.name):
                violations = _physical_fk_statement_violations(
                    path.read_text(encoding="utf-8-sig"),
                    str(path.relative_to(project_root)),
                )
                self.assertEqual([], violations)

    def test_dws_healthcheck_audits_logical_relationships_not_physical_fk(self):
        project_root = Path(__file__).resolve().parents[2]
        sql = (project_root / "docs/dws/app-dws-healthcheck.sql").read_text(
            encoding="utf-8-sig"
        )
        normalized = " ".join(sql.lower().split())
        self.assertIn("'logical_relationship_checklist'", normalized)
        self.assertIn("missing_parent_key", normalized)
        self.assertIn("'upstream_system_id'", normalized)
        self.assertNotIn("fk_p_field_mapping_table_upstream", normalized)
        self.assertNotIn("constraint_type = 'foreign key'", normalized)

        match = re.search(
            r"expected_relationships AS \(.*?VALUES(?P<rows>.*?)\)\s+AS t\(child_table",
            sql,
            re.I | re.S,
        )
        self.assertIsNotNone(match)
        actual = {
            tuple(value.upper() for value in row)
            for row in re.findall(
                r"\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*,"
                r"\s*'([^']+)'\s*,\s*'([^']+)'\s*\)",
                match.group("rows"),
            )
        }
        expected = {
            (
                relationship.child_table.upper(),
                relationship.child_columns[0].upper(),
                relationship.parent_table.upper(),
                relationship.parent_columns[0].upper(),
                relationship.on_delete,
            )
            for relationship in DWS_LOGICAL_RELATIONSHIPS
        }
        self.assertEqual(expected, actual)

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

    def test_indexes_keep_the_same_contract(self):
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
