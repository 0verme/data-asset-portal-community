import unittest
from unittest.mock import MagicMock, patch

from backend.app.db.facade import (
    _connect_gaussdb,
    _prepare_execute_args,
    active_transaction_connection,
    database_transaction,
    execute_statements,
)


GAUSS_CONFIG = {
    "driver": "com.huawei.gauss200.jdbc.Driver",
    "jdbc_url": "jdbc:gaussdb://db.example.test:25308/asset_portal",
    "user": "test-user",
    "password": "test-password",
    "jar_path": "gaussdb200.jar",
}


class GaussDbConnectionTests(unittest.TestCase):
    def test_connect_disables_and_verifies_jdbc_autocommit(self):
        conn = MagicMock()
        conn.jconn.getAutoCommit.return_value = False

        with patch("backend.app.db.gaussdb_adapter.jaydebeapi.connect", return_value=conn):
            result = _connect_gaussdb(GAUSS_CONFIG)

        self.assertIs(result, conn)
        conn.jconn.setAutoCommit.assert_called_once_with(False)
        conn.jconn.getAutoCommit.assert_called_once_with()
        conn.close.assert_not_called()

    def test_connect_closes_connection_when_autocommit_cannot_be_disabled(self):
        conn = MagicMock()
        conn.jconn.setAutoCommit.side_effect = RuntimeError("unsupported")

        with patch("backend.app.db.gaussdb_adapter.jaydebeapi.connect", return_value=conn):
            with self.assertRaisesRegex(RuntimeError, "unsupported"):
                _connect_gaussdb(GAUSS_CONFIG)

        conn.close.assert_called_once_with()

    def test_connect_closes_connection_when_autocommit_remains_enabled(self):
        conn = MagicMock()
        conn.jconn.getAutoCommit.return_value = True

        with patch("backend.app.db.gaussdb_adapter.jaydebeapi.connect", return_value=conn):
            with self.assertRaisesRegex(RuntimeError, "remained in auto-commit mode"):
                _connect_gaussdb(GAUSS_CONFIG)

        conn.jconn.setAutoCommit.assert_called_once_with(False)
        conn.close.assert_called_once_with()


class DatabaseTransactionTests(unittest.TestCase):
    def test_success_commits_once_after_all_shared_statements(self):
        conn = MagicMock()
        conn.jconn.getAutoCommit.return_value = False

        with patch("backend.app.db.facade.connect_with_profile", return_value=conn):
            with database_transaction():
                execute_statements("primary", ["UPDATE first", "UPDATE second"])
                conn.commit.assert_not_called()

        conn.commit.assert_called_once_with()
        conn.rollback.assert_not_called()
        conn.close.assert_called_once_with()

    def test_failure_rolls_back_once(self):
        conn = MagicMock()
        conn.jconn.getAutoCommit.return_value = False

        with patch("backend.app.db.facade.connect_with_profile", return_value=conn):
            with self.assertRaisesRegex(ValueError, "business failure"):
                with database_transaction():
                    active_transaction_connection("primary")
                    raise ValueError("business failure")

        conn.commit.assert_not_called()
        conn.rollback.assert_called_once_with()
        conn.close.assert_called_once_with()

    def test_rollback_failure_does_not_replace_business_exception(self):
        conn = MagicMock()
        conn.jconn.getAutoCommit.return_value = False
        conn.rollback.side_effect = RuntimeError("rollback failure")

        with patch("backend.app.db.facade.connect_with_profile", return_value=conn):
            with self.assertLogs("backend.app.db.facade", level="ERROR"):
                with self.assertRaisesRegex(ValueError, "business failure"):
                    with database_transaction():
                        active_transaction_connection("primary")
                        raise ValueError("business failure")

    def test_execute_statements_keeps_question_placeholders_for_gaussdb(self):
        """GaussDB/JDBC path keeps ? placeholders (same as former non-postgres engines)."""
        conn = MagicMock()
        cursor = conn.cursor.return_value
        conn.jconn.getAutoCommit.return_value = False

        with (
            patch("backend.app.db.facade.connect_with_profile", return_value=conn),
            patch(
                "backend.app.db.facade.get_db_profile",
                return_value={"type": "gaussdb"},
            ),
        ):
            execute_statements(
                "primary",
                [
                    "UPDATE legacy",
                    ("UPDATE parameterized SET value = ? WHERE id = ?", ["值", 7]),
                    "   ",
                ],
            )

        self.assertEqual(
            [
                unittest.mock.call("UPDATE legacy"),
                unittest.mock.call(
                    "UPDATE parameterized SET value = ? WHERE id = ?",
                    ("值", 7),
                ),
            ],
            cursor.execute.call_args_list,
        )
        conn.commit.assert_called_once_with()
        conn.rollback.assert_not_called()

    def test_execute_statements_rolls_back_parameterized_batch_failure(self):
        conn = MagicMock()
        cursor = conn.cursor.return_value
        conn.jconn.getAutoCommit.return_value = False
        cursor.execute.side_effect = [None, RuntimeError("write failed")]

        with (
            patch("backend.app.db.facade.connect_with_profile", return_value=conn),
            patch(
                "backend.app.db.facade.get_db_profile",
                return_value={"type": "gaussdb"},
            ),
        ):
            with self.assertRaisesRegex(RuntimeError, "write failed"):
                execute_statements(
                    "primary",
                    [
                        ("UPDATE first SET value = ?", [1]),
                        ("UPDATE second SET value = ?", [2]),
                    ],
                )

        conn.commit.assert_not_called()
        conn.rollback.assert_called_once_with()

    def test_postgres_placeholder_conversion_keeps_bound_values_separate(self):
        with patch(
            "backend.app.db.facade.get_db_profile",
            return_value={"type": "postgres"},
        ):
            sql, params = _prepare_execute_args(
                "primary",
                "UPDATE sample SET name = ? WHERE id = ?",
                params=["O'Reilly", 3],
            )

        self.assertEqual("UPDATE sample SET name = %s WHERE id = %s", sql)
        self.assertEqual(("O'Reilly", 3), params)

    def test_unsupported_profile_type_fails_fast(self):
        from backend.app.db.facade import get_db_profile

        with patch(
            "backend.app.db.facade.load_db_profiles",
            return_value={"bad": {"type": "oracle", "database": "x.db"}},
        ), patch(
            "backend.app.db.facade.get_db_profile_overrides",
            return_value={},
        ):
            with self.assertRaisesRegex(ValueError, "Supported types"):
                get_db_profile("bad")

    def test_execute_statements_rejects_ambiguous_statement_shapes(self):
        conn = MagicMock()
        conn.jconn.getAutoCommit.return_value = False

        with patch("backend.app.db.facade.connect_with_profile", return_value=conn):
            with self.assertRaisesRegex(TypeError, "statement must be SQL text"):
                execute_statements("primary", [("UPDATE sample", [], "extra")])

        conn.rollback.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()
