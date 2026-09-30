from __future__ import annotations

import re
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from sqlalchemy import Column, Integer, MetaData, Table, select
from sqlalchemy.dialects import postgresql

from backend.app.authorization.persistence import _qualified_table as _rbac_qualified_table
from backend.app.authorization.repository import _qualified_table as _auth_qualified_table
from backend.app.db.core import _compile
from backend.app.db.facade import normalize_sql_for_profile
from backend.app.migrations.schema import (
    _prefix,
    _execute,
    _split_sql_statements,
    _schema_for_reflection,
    baseline_schema,
    initialize,
    reflect_schema,
    render_baseline_for_profile,
    verify_baselines,
    verify_database,
)


class RecordingCursor:
    def __init__(self, connection):
        self.connection = connection
        self.result = None

    def execute(self, sql, params=None):
        sql = sql.strip()
        self.connection.executed.append((sql, params))
        if self.connection.fail_on and self.connection.fail_on in sql:
            raise RuntimeError("recorded statement failure")
        lowered = sql.lower()
        if "from information_schema.schemata" in lowered:
            self.result = (1,) if self.connection.schema_exists else None
        elif lowered.startswith("select version_num from"):
            self.result = (self.connection.revision,) if self.connection.revision else None
        elif "from information_schema.tables" in lowered:
            self.result = None
        else:
            self.result = None
        return self

    def fetchone(self):
        return self.result

    def fetchall(self):
        return []

    def close(self):
        pass


class RecordingConnection:
    def __init__(self, *, schema_exists=True, revision=None, fail_on=None):
        self.schema_exists = schema_exists
        self.revision = revision
        self.fail_on = fail_on
        self.executed = []
        self.commits = 0
        self.rollbacks = 0

    def cursor(self):
        return RecordingCursor(self)

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1


def _mask_literals_and_comments(sql: str) -> str:
    """Keep identifier text while masking values and comments for qualifier checks."""
    output = list(sql)
    index = 0
    while index < len(sql):
        if sql.startswith("--", index):
            end = sql.find("\n", index)
            end = len(sql) if end < 0 else end
            for position in range(index, end):
                output[position] = " "
            index = end
            continue
        if sql.startswith("/*", index):
            depth = 1
            end = index + 2
            while end < len(sql) and depth:
                if sql.startswith("/*", end):
                    depth += 1
                    end += 2
                elif sql.startswith("*/", end):
                    depth -= 1
                    end += 2
                else:
                    end += 1
            for position in range(index, end):
                if output[position] != "\n":
                    output[position] = " "
            index = end
            continue
        if sql[index] == "$":
            match = re.match(r"\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$", sql[index:])
            if match:
                delimiter = match.group(0)
                close = sql.find(delimiter, index + len(delimiter))
                end = len(sql) if close < 0 else close + len(delimiter)
                for position in range(index, end):
                    if output[position] != "\n":
                        output[position] = " "
                index = end
                continue
        if sql[index] == "'":
            end = index + 1
            while end < len(sql):
                if sql[end] == "\\" and end + 1 < len(sql):
                    end += 2
                elif sql[end] == "'":
                    if end + 1 < len(sql) and sql[end + 1] == "'":
                        end += 2
                    else:
                        end += 1
                        break
                else:
                    end += 1
            for position in range(index, end):
                if output[position] != "\n":
                    output[position] = " "
            index = end
            continue
        index += 1
    return "".join(output)


class DwsSchemaSafetyTests(unittest.TestCase):
    config = {"type": "gaussdb", "schema": "dap"}

    def test_runtime_renderer_rewrites_qualified_identifiers_only(self):
        with tempfile.TemporaryDirectory(prefix="dws-render-") as directory:
            root = Path(directory)
            (root / "dws.sql").write_text(
                "-- keep comment dwp.p_comment unchanged\n"
                "CREATE TABLE dwp.sample (schema_name TEXT DEFAULT 'dwp', "
                "note TEXT DEFAULT 'dwp.table; still a value', "
                "payload TEXT DEFAULT $tag$dwp.quoted$tag$);\n"
                "CREATE INDEX idx_sample ON dwp.sample (schema_name);\n",
                encoding="utf-8",
            )
            rendered = render_baseline_for_profile(self.config, "dws", root)

        self.assertIn("CREATE TABLE dap.sample", rendered)
        self.assertIn("CREATE INDEX idx_sample ON dap.sample", rendered)
        self.assertIn("DEFAULT 'dwp'", rendered)
        self.assertIn("DEFAULT 'dwp.table; still a value'", rendered)
        self.assertIn("$tag$dwp.quoted$tag$", rendered)
        self.assertIn("-- keep comment dwp.p_comment unchanged", rendered)
        self.assertNotRegex(_mask_literals_and_comments(rendered), r"\bdwp\s*\.")

    def test_mixed_case_schema_stays_consistent_across_dws_sql_paths(self):
        config = {"type": "gaussdb", "schema": "Dap"}
        rendered = render_baseline_for_profile(config, "dws")
        self.assertIn('CREATE TABLE IF NOT EXISTS "Dap".p_system', rendered)
        self.assertEqual('"Dap".', _prefix(config))

        with patch("backend.app.db.facade.get_db_profile", return_value=config):
            sql = normalize_sql_for_profile(
                "gauss_primary", "SELECT * FROM __app__.p_system"
            )
        self.assertIn('"Dap".p_system', sql)

        table = Table("sample", MetaData(), Column("id", Integer), schema="__app__")
        with patch("backend.app.db.core.get_db_profile", return_value=config):
            sql, _ = _compile(
                "gauss_primary",
                select(table),
                dialect=postgresql.dialect(paramstyle="qmark"),
            )
        self.assertIn('FROM "Dap".sample', sql)
        self.assertEqual('"Dap".p_admin_user', _auth_qualified_table(config, "p_admin_user"))
        self.assertEqual('"Dap".p_role', _rbac_qualified_table("p_role", "Dap", gaussdb=True))

    def test_real_dws_baseline_maps_to_profile_schema_and_keeps_business_default(self):
        rendered = render_baseline_for_profile(self.config, "dws")
        self.assertIn("CREATE TABLE IF NOT EXISTS dap.p_system", rendered)
        self.assertIn("CREATE TABLE IF NOT EXISTS dap.p_admin_user", rendered)
        self.assertIn("CREATE TABLE IF NOT EXISTS dap.p_asset_table", rendered)
        self.assertIn("schema_name VARCHAR(128) NOT NULL DEFAULT 'dwp'", rendered)
        self.assertNotRegex(_mask_literals_and_comments(rendered), r"\bdwp\s*\.")
        self.assertNotRegex(rendered, r"CREATE\s+SCHEMA\s+IF\s+NOT\s+EXISTS")

    def test_fresh_apply_executes_profile_rendered_statements_and_stamps_same_schema(self):
        connection = RecordingConnection()
        self.assertTrue(initialize(connection, self.config, "dws"))

        baseline_statements = _split_sql_statements(
            render_baseline_for_profile(self.config, "dws")
        )
        executed_baseline = [
            sql for sql, _ in connection.executed if sql in set(baseline_statements)
        ]
        self.assertEqual(baseline_statements, executed_baseline)

        ddl = [
            sql for sql, _ in connection.executed
            if re.search(
                r"\b(?:CREATE\s+TABLE|CREATE\s+(?:UNIQUE\s+)?INDEX|ALTER\s+TABLE|DROP\s+)",
                sql,
                re.I,
            )
        ]
        for statement in ddl:
            self.assertNotRegex(_mask_literals_and_comments(statement), r"\bdwp\s*\.")
        self.assertFalse(any(re.search(r"CREATE\s+SCHEMA", sql, re.I) for sql, _ in connection.executed))
        self.assertIn(
            "CREATE TABLE IF NOT EXISTS dap.alembic_version "
            "(version_num VARCHAR(32) NOT NULL PRIMARY KEY)",
            [sql for sql, _ in connection.executed],
        )
        self.assertIn("DELETE FROM dap.alembic_version", [sql for sql, _ in connection.executed])
        self.assertTrue(any(sql.startswith("INSERT INTO dap.alembic_version") for sql, _ in connection.executed))
        self.assertFalse(any("dwp.alembic_version" in sql for sql, _ in connection.executed))
        schema_check = next(
            item for item in connection.executed
            if "information_schema.schemata" in item[0]
        )
        self.assertEqual(("dap",), schema_check[1])
        empty_check = next(
            item for item in connection.executed
            if "information_schema.tables" in item[0]
        )
        self.assertEqual(("dap",), empty_check[1])

    def test_missing_target_schema_fails_before_any_ddl(self):
        connection = RecordingConnection(schema_exists=False)
        with self.assertRaisesRegex(
            RuntimeError,
            "target schema 'dap' does not exist; create it before applying migrations",
        ) as error:
            initialize(connection, self.config, "dws")
        self.assertNotIn("jdbc", str(error.exception).lower())
        self.assertNotIn("password", str(error.exception).lower())
        self.assertFalse(any(re.match(r"(?:CREATE|ALTER|DROP)\b", sql, re.I) for sql, _ in connection.executed))
        self.assertEqual(1, len(connection.executed))

    def test_missing_empty_and_unsafe_schema_fail_before_connection_execution(self):
        invalid_schemas = (None, "", "   ", "dap;DROP SCHEMA xxx", "foo.bar")
        for schema in invalid_schemas:
            with self.subTest(schema=schema):
                config = {"type": "gaussdb"}
                if schema is not None:
                    config["schema"] = schema
                connection = RecordingConnection()
                with self.assertRaisesRegex(ValueError, "safe SQL identifier"):
                    initialize(connection, config, "dws")
                self.assertEqual([], connection.executed)

    def test_statement_splitter_preserves_semicolons_in_values_comments_and_dollar_quotes(self):
        sql = (
            "-- comment ; remains attached\n"
            "CREATE TABLE a (v TEXT DEFAULT 'one;two', q TEXT DEFAULT 'it''s;ok');\n"
            "/* block ; comment */ CREATE TABLE b (v TEXT DEFAULT $tag$three;four$tag$);\n"
            "CREATE TABLE c (v TEXT);"
        )
        statements = _split_sql_statements(sql)
        self.assertEqual(3, len(statements))
        self.assertIn("'one;two'", statements[0])
        self.assertIn("'it''s;ok'", statements[0])
        self.assertIn("$tag$three;four$tag$", statements[1])

    def test_statement_execution_stops_at_first_failure(self):
        connection = RecordingConnection(fail_on="CREATE TABLE failed")
        with self.assertRaisesRegex(RuntimeError, "recorded statement failure"):
            _execute(
                connection,
                "CREATE TABLE first (id INTEGER);"
                "CREATE TABLE failed (id INTEGER);"
                "CREATE TABLE last (id INTEGER);",
                split=True,
            )
        self.assertEqual(
            ["CREATE TABLE first (id INTEGER)", "CREATE TABLE failed (id INTEGER)"],
            [sql for sql, _ in connection.executed],
        )

    def test_reflection_and_verify_use_profile_schema(self):
        expected = baseline_schema("dws")
        connection = RecordingConnection()
        self.assertEqual("dap", _schema_for_reflection(self.config))
        reflect_schema(connection, self.config, expected)
        scoped_reads = [
            (sql, params) for sql, params in connection.executed
            if "information_schema.columns" in sql
            or "pg_constraint" in sql
            or "information_schema.referential_constraints" in sql
            or "pg_index" in sql
        ]
        self.assertTrue(scoped_reads)
        self.assertTrue(all(params == ("dap",) for _, params in scoped_reads))

        verify_connection = RecordingConnection(revision="0001_baseline")
        with patch(
            "backend.app.migrations.schema.reflect_schema", return_value=expected
        ):
            self.assertEqual(
                "0001_baseline",
                verify_database(verify_connection, self.config, "dws"),
            )
        self.assertIn(
            "SELECT version_num FROM dap.alembic_version",
            [sql for sql, _ in verify_connection.executed],
        )
        self.assertFalse(
            any("dwp.alembic_version" in sql for sql, _ in verify_connection.executed)
        )

    def test_four_dialect_baseline_table_parity_remains_intact(self):
        self.assertEqual(39, len(verify_baselines()))


if __name__ == "__main__":
    unittest.main()
