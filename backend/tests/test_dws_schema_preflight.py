from __future__ import annotations

import io
import re
import unittest
from backend.app.migrations.schema import (
    SCHEMA_ROOT,
    _split_sql_statements,
    render_baseline_for_profile,
)
from backend.scripts.dws_schema_preflight import run_preflight


PROFILE = {
    "type": "gaussdb",
    "schema": "dap",
    "password": "unit-test-password",
    "token": "unit-test-token",
    "url": "unit-test-endpoint",
}


class FakeJavaConnection:
    def __init__(self, *, auto_commit: bool = False):
        self.auto_commit = auto_commit

    def getAutoCommit(self):
        return self.auto_commit


class FakeCursor:
    def __init__(self, connection):
        self.connection = connection
        self.result = None

    def execute(self, sql, params=None):
        statement = sql.strip()
        self.connection.executed.append((statement, params))
        lowered = statement.lower()
        if lowered == "select version()":
            self.result = (self.connection.version,)
        elif "from information_schema.schemata" in lowered:
            self.result = (1,) if self.connection.schema_exists else None
        elif "from information_schema.tables" in lowered:
            self.result = (1,) if self.connection.user_tables else None
        elif lowered.startswith("savepoint "):
            self.connection.savepoints[statement.split()[-1]] = len(self.connection.ddl_state)
        elif lowered.startswith("rollback to savepoint "):
            name = statement.split()[-1]
            self.connection.ddl_state = self.connection.ddl_state[: self.connection.savepoints[name]]
        elif re.search(r"\bCREATE\s+(?:TABLE|INDEX)\b", statement, re.I):
            self.connection.ddl_state.append(statement)
            if any(marker in statement for marker in self.connection.fail_markers):
                raise RuntimeError(self.connection.failure_message)
        return self

    def fetchone(self):
        return self.result

    def close(self):
        pass


class FakeConnection:
    def __init__(
        self,
        *,
        schema_exists=True,
        user_tables=False,
        fail_markers=(),
        failure_message="recorded DDL failure",
        auto_commit=False,
    ):
        self.schema_exists = schema_exists
        self.user_tables = user_tables
        self.fail_markers = tuple(fail_markers)
        self.failure_message = failure_message
        self.version = "PostgreSQL 9.2.4 (GaussDB 8.1.3 fake test version)"
        self.jconn = FakeJavaConnection(auto_commit=auto_commit)
        self.executed = []
        self.savepoints = {}
        self.ddl_state = []
        self.state_at_rollback = []
        self.rollback_calls = 0
        self.commit_calls = 0
        self.close_calls = 0

    def cursor(self):
        return FakeCursor(self)

    def rollback(self):
        self.rollback_calls += 1
        self.state_at_rollback.append(list(self.ddl_state))
        self.ddl_state.clear()

    def commit(self):
        self.commit_calls += 1

    def close(self):
        self.close_calls += 1


class DwsSchemaPreflightTests(unittest.TestCase):
    def setUp(self):
        self.statements = _split_sql_statements(
            render_baseline_for_profile(PROFILE, "dws", SCHEMA_ROOT)
        )

    def _run(self, connection, config=None):
        output = io.StringIO()
        errors = io.StringIO()
        calls = []

        def connect():
            calls.append(True)
            return connection

        code = run_preflight(
            "gauss_primary",
            config or dict(PROFILE),
            connect,
            output=output,
            error_output=errors,
        )
        return code, output.getvalue(), errors.getvalue(), calls

    def test_non_gaussdb_profile_is_rejected_before_connecting(self):
        output = io.StringIO()
        errors = io.StringIO()
        calls = []
        result = run_preflight(
            "local_sqlite",
            {"type": "sqlite"},
            lambda: calls.append(True),
            output=output,
            error_output=errors,
        )
        self.assertEqual(2, result)
        self.assertEqual([], calls)
        self.assertIn("requires a GaussDB profile", errors.getvalue())

    def test_existing_user_tables_refuse_preflight_before_any_ddl(self):
        connection = FakeConnection(user_tables=True)
        code, output, errors, _ = self._run(connection)
        self.assertEqual(2, code)
        self.assertIn("target schema already contains user tables; preflight refused", errors)
        self.assertFalse(connection.ddl_state)
        self.assertEqual(1, connection.rollback_calls)
        self.assertEqual(0, connection.commit_calls)

    def test_all_statements_pass_report_summary_and_final_rollback(self):
        connection = FakeConnection()
        code, output, errors, _ = self._run(connection)
        self.assertEqual(0, code, errors)
        self.assertIn("=== DWS VERSION ===", output)
        self.assertIn(connection.version, output)
        self.assertIn("=== PREFLIGHT ===", output)
        self.assertIn(f"TOTAL : {len(self.statements)}", output)
        self.assertIn(f"PASS  : {len(self.statements)}", output)
        self.assertIn("FAIL  : 0", output)
        self.assertEqual(1, connection.rollback_calls)
        self.assertEqual(0, connection.commit_calls)
        self.assertEqual(len(self.statements), len(connection.state_at_rollback[0]))
        self.assertFalse(connection.ddl_state)
        self.assertEqual(1, connection.close_calls)

    def test_statement_failure_does_not_stop_later_statements(self):
        failed_index, failed = next(
            (index, statement)
            for index, statement in enumerate(self.statements, start=1)
            if "idx_p_api_asset_filter" in statement
        )
        connection = FakeConnection(fail_markers=("idx_p_api_asset_filter",))
        code, output, errors, _ = self._run(connection)
        self.assertEqual(1, code)
        self.assertEqual("", errors)
        self.assertIn(f"FAIL {failed_index:03d} |", output)
        self.assertIn(f"TOTAL : {len(self.statements)}", output)
        self.assertIn(f"PASS  : {len(self.statements) - 1}", output)
        self.assertEqual(len(self.statements) - 1, len(connection.state_at_rollback[0]))
        self.assertNotIn(failed, connection.state_at_rollback[0])
        self.assertEqual(self.statements[-1], connection.state_at_rollback[0][-1])
        self.assertEqual(1, connection.rollback_calls)

    def test_all_statement_failures_are_reported_together(self):
        connection = FakeConnection(
            fail_markers=(
                "idx_p_api_asset_filter",
                "idx_p_role_permission_permission",
            )
        )
        code, output, _, _ = self._run(connection)
        self.assertEqual(1, code)
        self.assertIn("FAIL  : 2", output)
        self.assertIn("=== ALL FAILURES ===", output)
        for marker in ("idx_p_api_asset_filter", "idx_p_role_permission_permission"):
            index = next(
                position
                for position, statement in enumerate(self.statements, start=1)
                if marker in statement
            )
            self.assertIn(f"[{index:03d}]", output)
        attempted_ddls = [
            statement for statement, _ in connection.executed
            if re.search(r"\bCREATE\s+(?:TABLE|INDEX)\b", statement, re.I)
        ]
        self.assertEqual(len(self.statements), len(attempted_ddls))

    def test_savepoint_rollback_is_followed_by_later_execution_and_final_rollback(self):
        connection = FakeConnection(fail_markers=("idx_p_api_asset_filter",))
        code, _, errors, _ = self._run(connection)
        self.assertEqual(1, code, errors)
        failed_ddl = next(
            sql for sql, _ in connection.executed
            if "idx_p_api_asset_filter" in sql and sql.lstrip().upper().startswith("CREATE INDEX")
        )
        self.assertNotIn(failed_ddl, connection.state_at_rollback[0])
        self.assertTrue(any(sql == self.statements[-1] for sql in connection.state_at_rollback[0]))
        self.assertEqual(1, connection.rollback_calls)

    def test_version_query_is_executed_and_printed(self):
        connection = FakeConnection()
        code, output, errors, _ = self._run(connection)
        self.assertEqual(0, code, errors)
        self.assertIn(
            ("SELECT version()", None),
            connection.executed,
        )
        self.assertLess(output.index("=== DWS VERSION ==="), output.index("=== PREFLIGHT ==="))
        self.assertIn("GaussDB 8.1.3 fake test version", output)

    def test_sensitive_database_errors_are_redacted(self):
        connection = FakeConnection(
            fail_markers=("idx_p_api_asset_filter",),
            failure_message=(
                "password=unit-test-password token=unit-test-token "
                "endpoint=unit-test-endpoint"
            ),
        )
        code, output, errors, _ = self._run(connection)
        self.assertEqual(1, code)
        combined = output + errors
        for secret in (
            "unit-test-password",
            "unit-test-token",
            "unit-test-endpoint",
        ):
            self.assertNotIn(secret, combined)
        self.assertIn("password=***", combined)
        self.assertIn("token=***", combined)

    def test_autocommit_connection_is_refused_and_still_rolled_back(self):
        connection = FakeConnection(auto_commit=True)
        code, _, errors, _ = self._run(connection)
        self.assertEqual(2, code)
        self.assertIn("auto-commit is enabled", errors)
        self.assertEqual(1, connection.rollback_calls)
        self.assertFalse(connection.ddl_state)


if __name__ == "__main__":
    unittest.main()
