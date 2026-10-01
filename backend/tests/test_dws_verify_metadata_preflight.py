from __future__ import annotations

import io
import unittest
from contextlib import redirect_stderr, redirect_stdout
from unittest.mock import patch

from backend.app.migrations.schema import (
    ColumnSpec,
    ForeignKeySpec,
    IndexSpec,
    SchemaModel,
    TableSpec,
    _reflection_metadata_queries,
    baseline_schema,
    compare_schema,
    reflect_schema,
)
from backend.scripts.dws_verify_metadata_preflight import main as preflight_main
from backend.scripts.dws_verify_metadata_preflight import run_preflight


PROFILE = {
    "type": "gaussdb",
    "schema": "dap",
    "password": "unit-test-password",
}


class ReflectionCursor:
    def __init__(self, connection):
        self.connection = connection
        self.rows = []

    def execute(self, sql, params=None):
        self.connection.executed.append((sql, params))
        lowered = sql.lower()
        if "information_schema.columns" in lowered:
            marker = "columns reflection"
        elif "from pg_constraint" in lowered:
            marker = "constraints reflection"
        elif "information_schema.referential_constraints" in lowered:
            marker = "referential constraints"
        elif "from pg_class t" in lowered and "pg_index" in lowered:
            marker = "indexes reflection"
        else:
            raise AssertionError(f"unexpected metadata SQL: {sql}")
        if marker in self.connection.fail_markers:
            raise RuntimeError(self.connection.failure_message)
        self.rows = self.connection.results.get(marker, [])
        return self

    def fetchall(self):
        return list(self.rows)

    def close(self):
        pass


class ReflectionConnection:
    def __init__(self, results=None, *, fail_markers=(), failure_message="metadata SQL failure"):
        self.results = results or {}
        self.fail_markers = set(fail_markers)
        self.failure_message = failure_message
        self.executed = []
        self.rollback_calls = 0
        self.commit_calls = 0
        self.close_calls = 0

    def cursor(self):
        return ReflectionCursor(self)

    def rollback(self):
        self.rollback_calls += 1

    def commit(self):
        self.commit_calls += 1

    def close(self):
        self.close_calls += 1


def _column_row(table, column, *, primary=False, default=None):
    return (
        table,
        column,
        "bigint",
        None,
        64,
        0,
        "NO" if primary else "YES",
        default,
    )


def _constraint_row(kind, name, column, ordinal, ref_table=None, ref_column=None, delete_action=None):
    return (
        "p_pair",
        kind,
        name,
        column,
        ordinal,
        ref_table,
        ref_column,
        delete_action,
    )


def _composite_contract():
    table = TableSpec("p_pair")
    pk = ("pk_second", "pk_first")
    columns = (
        "pk_second", "pk_first", "uq_second", "uq_first", "fk_second", "fk_first",
        "ix_second", "ix_first", "uix_second", "uix_first",
    )
    for name in columns:
        is_primary = name in pk
        table.columns[name] = ColumnSpec(
            name,
            "BIGINT",
            not is_primary,
            None,
            is_primary,
        )
    table.primary_key = pk
    table.unique_constraints = {("uq_second", "uq_first")}
    table.foreign_keys = {
        ForeignKeySpec(
            ("fk_second", "fk_first"),
            "p_parent",
            ("parent_second", "parent_first"),
            "CASCADE",
        )
    }
    table.indexes = {
        "idx_pair": IndexSpec("idx_pair", ("ix_second", "ix_first")),
        "idx_unique_pair": IndexSpec(
            "idx_unique_pair", ("uix_second", "uix_first"), unique=True
        ),
    }
    parent = TableSpec("p_parent")
    for name in ("parent_second", "parent_first"):
        parent.columns[name] = ColumnSpec(name, "BIGINT", True, None)
    return SchemaModel({"p_pair": table, "p_parent": parent})


def _composite_reflection_results():
    return {
        "columns reflection": [
            *(
                _column_row("p_pair", name, primary=name in {"pk_second", "pk_first"})
                for name in (
                    "pk_second", "pk_first", "uq_second", "uq_first", "fk_second", "fk_first",
                    "ix_second", "ix_first", "uix_second", "uix_first",
                )
            ),
            _column_row("p_parent", "parent_second"),
            _column_row("p_parent", "parent_first"),
        ],
        "constraints reflection": [
            _constraint_row("PRIMARY KEY", "p_pair_pkey", "pk_first", 2),
            _constraint_row("PRIMARY KEY", "p_pair_pkey", "pk_second", 1),
            _constraint_row("UNIQUE", "p_pair_uq", "uq_first", 2),
            _constraint_row("UNIQUE", "p_pair_uq", "uq_second", 1),
            _constraint_row("FOREIGN KEY", "p_pair_fk", "fk_first", 2, "p_parent", "parent_first"),
            _constraint_row("FOREIGN KEY", "p_pair_fk", "fk_second", 1, "p_parent", "parent_second"),
        ],
        "referential constraints": [("p_pair_fk", "CASCADE")],
        "indexes reflection": [
            ("p_pair", "idx_pair", False, 2, "ix_first"),
            ("p_pair", "idx_pair", False, 1, "ix_second"),
            ("p_pair", "idx_unique_pair", True, 2, "uix_first"),
            ("p_pair", "idx_unique_pair", True, 1, "uix_second"),
        ],
    }


class DwsReflectionQueryTests(unittest.TestCase):
    def test_gaussdb_uses_its_own_non_lateral_ordered_catalog_queries(self):
        queries = _reflection_metadata_queries(dict(PROFILE))
        self.assertEqual(
            [
                "columns reflection",
                "constraints reflection",
                "referential constraints",
                "indexes reflection",
            ],
            [query.name for query in queries],
        )
        for query in queries:
            self.assertEqual(("dap",), query.params)
            self.assertNotRegex(query.sql, r"(?i)\bLATERAL\b|\bunnest\s*\(|\bWITH\s+ORDINALITY\b")
        constraints = queries[1].sql
        indexes = queries[3].sql
        self.assertIn("generate_subscripts(c.conkey, 1)", constraints)
        self.assertIn("c.conkey[k.ord]", constraints)
        self.assertIn("c.confkey[k.ord]", constraints)
        self.assertIn("generate_subscripts(ix.indkey, 1)", indexes)
        self.assertIn("ix.indkey[k.ord]", indexes)

    def test_postgresql_keeps_existing_lateral_catalog_reflection(self):
        queries = _reflection_metadata_queries({"type": "postgres", "schema": "app"})
        self.assertIn("JOIN LATERAL unnest(c.conkey) WITH ORDINALITY", queries[1].sql)
        self.assertIn("JOIN LATERAL unnest(c.confkey) WITH ORDINALITY", queries[1].sql)
        self.assertIn("JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY", queries[3].sql)
        self.assertNotIn("generate_subscripts", " ".join(query.sql for query in queries))

    def test_mysql_and_sqlite_reflection_routes_remain_native(self):
        mysql = _reflection_metadata_queries({"type": "mysql", "database": "community"})
        self.assertIn("table_schema = DATABASE()", mysql[0].sql)
        self.assertIn("information_schema.key_column_usage", mysql[1].sql)
        self.assertIn("information_schema.statistics", mysql[3].sql)
        self.assertNotIn("pg_constraint", " ".join(query.sql for query in mysql))

        # SQLite continues to use its PRAGMA reflection implementation rather
        # than entering any information_schema/catalog query branch.
        with patch("backend.app.migrations.schema._reflect_sqlite", return_value=SchemaModel()) as reflect:
            result = reflect_schema(object(), {"type": "sqlite"}, SchemaModel())
        self.assertEqual(SchemaModel(), result)
        reflect.assert_called_once()

    def test_composite_keys_foreign_key_pairs_and_index_orders_are_preserved(self):
        expected = _composite_contract()
        connection = ReflectionConnection(_composite_reflection_results())
        actual = reflect_schema(connection, dict(PROFILE), expected)

        self.assertEqual(expected.tables["p_pair"].primary_key, actual.tables["p_pair"].primary_key)
        self.assertEqual(
            expected.tables["p_pair"].unique_constraints,
            actual.tables["p_pair"].unique_constraints,
        )
        self.assertEqual(expected.tables["p_pair"].foreign_keys, actual.tables["p_pair"].foreign_keys)
        self.assertEqual(expected.tables["p_pair"].indexes, actual.tables["p_pair"].indexes)
        self.assertEqual([], compare_schema(expected, actual))

    def test_bigserial_sequence_default_normalization_survives_dws_reflection(self):
        expected = baseline_schema("dws")
        connection = ReflectionConnection(
            {
                "columns reflection": [
                    _column_row(
                        "p_operation_log",
                        "id",
                        primary=True,
                        default="nextval('dap.p_operation_log_id_seq'::regclass)",
                    )
                ],
                "constraints reflection": [
                    ("p_operation_log", "PRIMARY KEY", "p_operation_log_pkey", "id", 1, None, None, None)
                ],
                "indexes reflection": [("p_operation_log", "p_operation_log_pkey", True, 0, "id")],
            }
        )
        actual = reflect_schema(connection, dict(PROFILE), expected)
        reflected_id = actual.tables["p_operation_log"].columns["id"]
        self.assertIsNone(reflected_id.default)
        self.assertEqual("BIGINT", reflected_id.type_name)
        self.assertTrue(reflected_id.primary_key)
        self.assertEqual(("id",), actual.tables["p_operation_log"].primary_key)


class DwsVerifyMetadataPreflightTests(unittest.TestCase):
    def _run(self, connection, config=None):
        output = io.StringIO()
        errors = io.StringIO()
        calls = []
        code = run_preflight(
            "gauss_primary",
            config or dict(PROFILE),
            lambda: calls.append(True) or connection,
            output=output,
            error_output=errors,
        )
        return code, output.getvalue(), errors.getvalue(), calls

    def test_non_gaussdb_profile_is_rejected_before_connecting(self):
        connection = ReflectionConnection()
        code, output, errors, calls = self._run(connection, {"type": "sqlite"})
        self.assertEqual(2, code)
        self.assertEqual([], calls)
        self.assertIn("requires a GaussDB profile", errors)
        self.assertEqual([], connection.executed)

    def test_preflight_executes_formal_metadata_sql_read_only(self):
        connection = ReflectionConnection()
        code, output, errors, calls = self._run(connection)
        self.assertEqual(0, code, errors)
        self.assertEqual([True], calls)
        for label in (
            "columns reflection",
            "constraints reflection",
            "referential constraints",
            "indexes reflection",
        ):
            self.assertIn(f"{label:<28} PASS", output)
        self.assertIn("TOTAL : 4", output)
        self.assertIn("FAIL  : 0", output)
        self.assertEqual(4, len(connection.executed))
        self.assertTrue(all(sql.lstrip().upper().startswith("SELECT") for sql, _ in connection.executed))
        self.assertEqual(0, connection.commit_calls)
        self.assertEqual(1, connection.rollback_calls)
        self.assertEqual(1, connection.close_calls)

    def test_cli_resolves_named_profile_and_runs_the_metadata_preflight(self):
        connection = ReflectionConnection()
        stdout = io.StringIO()
        stderr = io.StringIO()
        with (
            patch("backend.scripts.dws_verify_metadata_preflight._load_runtime"),
            patch("backend.scripts.dws_verify_metadata_preflight.get_db_profile", return_value=dict(PROFILE)),
            patch("backend.scripts.dws_verify_metadata_preflight.connect_with_profile", return_value=connection),
            redirect_stdout(stdout),
            redirect_stderr(stderr),
        ):
            code = preflight_main(["--profile", "gauss_primary"])
        self.assertEqual(0, code, stderr.getvalue())
        self.assertIn("columns reflection", stdout.getvalue())
        self.assertEqual(4, len(connection.executed))

    def test_independent_catalog_failures_are_reported_and_sensitive_text_redacted(self):
        connection = ReflectionConnection(
            fail_markers={"constraints reflection", "indexes reflection"},
            failure_message="password=unit-test-password",
        )
        code, output, errors, _ = self._run(connection)
        self.assertEqual(1, code)
        self.assertEqual("", errors)
        self.assertIn("columns reflection", output)
        self.assertIn("constraints reflection", output)
        self.assertIn("referential constraints", output)
        self.assertIn("indexes reflection", output)
        self.assertIn("FAIL  : 2", output)
        self.assertIn("password=***", output)
        self.assertNotIn("unit-test-password", output)
        self.assertEqual(3, connection.rollback_calls)
        self.assertEqual(0, connection.commit_calls)
        self.assertEqual(1, connection.close_calls)


if __name__ == "__main__":
    unittest.main()
