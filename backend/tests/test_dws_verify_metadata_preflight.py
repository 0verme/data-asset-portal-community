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
    _normalize_gaussdb_catalog_vector,
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
        elif "from pg_attribute a" in lowered:
            marker = "attributes reflection"
        elif "from pg_constraint c" in lowered:
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


class JavaArrayLike:
    """Small indexable fixture matching the Python surface of a Java array."""

    def __init__(self, values):
        self.values = tuple(values)

    def __len__(self):
        return len(self.values)

    def __getitem__(self, index):
        return self.values[index]


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
    child_attributes = {
        "pk_second": 1,
        "uq_second": 2,
        "pk_first": 3,
        "uq_first": 4,
        "fk_second": 5,
        "fk_first": 6,
        "ix_second": 7,
        "ix_first": 8,
        "uix_second": 9,
        "uix_first": 10,
    }
    return {
        "columns reflection": [
            *(
                _column_row("p_pair", name, primary=name in {"pk_second", "pk_first"})
                for name in child_attributes
            ),
            _column_row("p_parent", "parent_second"),
            _column_row("p_parent", "parent_first"),
        ],
        "attributes reflection": [
            *((101, attnum, name) for name, attnum in child_attributes.items()),
            (202, 2, "parent_second"),
            (202, 1, "parent_first"),
        ],
        "constraints reflection": [
            ("p_pair", "PRIMARY KEY", "p_pair_pkey", "{1,3}", 101, None, 0, None, None),
            ("p_pair", "UNIQUE", "p_pair_uq", (2, 4), 101, None, 0, None, None),
            ("p_pair", "FOREIGN KEY", "p_pair_fk", [5, 6], 101, "p_parent", 202, "2 1", "CASCADE"),
        ],
        "referential constraints": [("p_pair_fk", "CASCADE")],
        "indexes reflection": [
            ("p_pair", "idx_pair", False, (7, 8), 101),
            ("p_pair", "idx_unique_pair", True, "9 10", 101),
        ],
    }


class DwsReflectionQueryTests(unittest.TestCase):
    def test_gaussdb_uses_raw_vectors_without_correlated_from_expansion(self):
        queries = _reflection_metadata_queries(dict(PROFILE))
        by_name = {query.name: query for query in queries}
        self.assertEqual(
            [
                "columns reflection",
                "attributes reflection",
                "constraints reflection",
                "referential constraints",
                "indexes reflection",
            ],
            [query.name for query in queries],
        )
        for query in queries:
            expected_params = ("dap", "dap") if query.name == "attributes reflection" else ("dap",)
            self.assertEqual(expected_params, query.params)
            self.assertNotRegex(
                query.sql,
                r"(?i)\bLATERAL\b|\bunnest\s*\(|\bWITH\s+ORDINALITY\b|\bgenerate_subscripts\s*\(",
            )
        combined_sql = " ".join(query.sql for query in queries)
        self.assertNotRegex(
            combined_sql,
            r"(?i)\bgenerate_subscripts\s*\(\s*(?:c|ix)\s*\.",
        )
        constraints = by_name["constraints reflection"].sql
        indexes = by_name["indexes reflection"].sql
        attributes = by_name["attributes reflection"].sql
        self.assertIn("c.conkey", constraints)
        self.assertIn("c.confkey", constraints)
        self.assertIn("c.conrelid", constraints)
        self.assertIn("c.confrelid", constraints)
        self.assertIn("ix.indkey", indexes)
        self.assertIn("ix.indrelid", indexes)
        self.assertIn("pg_attribute", attributes)
        self.assertIn("UNION", attributes)

    def test_catalog_attnum_vector_normalizes_supported_driver_forms(self):
        supported = (
            ("{1,2}", (1, 2)),
            (" 1 3 ", (1, 3)),
            ([1, 2], (1, 2)),
            ((1, 3), (1, 3)),
            (JavaArrayLike([3, 1]), (3, 1)),
        )
        for value, expected in supported:
            with self.subTest(value=value):
                self.assertEqual(expected, _normalize_gaussdb_catalog_vector(value))

    def test_unsupported_catalog_vector_representation_fails_explicitly(self):
        with self.assertRaisesRegex(
            ValueError, "unsupported GaussDB catalog vector representation"
        ):
            _normalize_gaussdb_catalog_vector({"not": "an attnum vector"})

        connection = ReflectionConnection(
            {
                "columns reflection": [_column_row("p_single", "id", primary=True)],
                "attributes reflection": [(303, 1, "id")],
                "constraints reflection": [
                    ("p_single", "PRIMARY KEY", "p_single_pkey", {"bad": "vector"}, 303, None, 0, None, None)
                ],
            }
        )
        with self.assertRaisesRegex(
            ValueError,
            "GaussDB constraints reflection for p_single_pkey: "
            "unsupported GaussDB catalog vector representation",
        ):
            reflect_schema(connection, dict(PROFILE), SchemaModel())

    def test_postgresql_keeps_existing_lateral_catalog_reflection(self):
        queries = _reflection_metadata_queries({"type": "postgres", "schema": "app"})
        by_name = {query.name: query for query in queries}
        self.assertIn("JOIN LATERAL unnest(c.conkey) WITH ORDINALITY", by_name["constraints reflection"].sql)
        self.assertIn("JOIN LATERAL unnest(c.confkey) WITH ORDINALITY", by_name["constraints reflection"].sql)
        self.assertIn("JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY", by_name["indexes reflection"].sql)
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

    def test_single_column_primary_key_is_reflected_from_catalog_vector(self):
        table = TableSpec("p_single")
        table.columns["id"] = ColumnSpec("id", "BIGINT", False, None, True)
        table.columns["name"] = ColumnSpec("name", "BIGINT", True, None)
        table.primary_key = ("id",)
        table.indexes["idx_single_name"] = IndexSpec("idx_single_name", ("name",))
        expected = SchemaModel({"p_single": table})
        connection = ReflectionConnection(
            {
                "columns reflection": [
                    _column_row("p_single", "id", primary=True),
                    _column_row("p_single", "name"),
                ],
                "attributes reflection": [(303, 1, "id"), (303, 2, "name")],
                "constraints reflection": [
                    ("p_single", "PRIMARY KEY", "p_single_pkey", "1", 303, None, 0, None, None)
                ],
                "indexes reflection": [("p_single", "idx_single_name", False, "2", 303)],
            }
        )
        actual = reflect_schema(connection, dict(PROFILE), expected)
        self.assertEqual(("id",), actual.tables["p_single"].primary_key)
        self.assertEqual({"idx_single_name": IndexSpec("idx_single_name", ("name",))}, actual.tables["p_single"].indexes)
        self.assertEqual([], compare_schema(expected, actual))

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

    def test_catalog_query_failures_identify_the_reflection_phase(self):
        connection = ReflectionConnection(fail_markers={"indexes reflection"})
        with self.assertRaisesRegex(
            RuntimeError, "schema reflection query 'indexes reflection' failed"
        ):
            reflect_schema(connection, dict(PROFILE), SchemaModel())

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
                "attributes reflection": [(404, 1, "id")],
                "constraints reflection": [
                    ("p_operation_log", "PRIMARY KEY", "p_operation_log_pkey", "{1}", 404, None, 0, None, None)
                ],
                "indexes reflection": [("p_operation_log", "p_operation_log_pkey", True, "1", 404)],
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
            "attributes reflection",
            "constraints reflection",
            "referential constraints",
            "indexes reflection",
        ):
            self.assertIn(f"{label:<28} PASS", output)
        self.assertIn("TOTAL : 5", output)
        self.assertIn("FAIL  : 0", output)
        self.assertEqual(5, len(connection.executed))
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
        self.assertEqual(5, len(connection.executed))

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
        self.assertIn("attributes reflection", output)
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
