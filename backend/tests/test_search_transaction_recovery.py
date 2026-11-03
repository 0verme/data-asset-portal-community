import unittest
from unittest.mock import patch

from backend.app.services.search_provider import KeywordSearchProvider, SearchDataSourceError


class FakeJavaConnection:
    def __init__(self, auto_commit=False):
        self.auto_commit = auto_commit

    def getAutoCommit(self):
        return self.auto_commit


class FakeJDBCCursor:
    def __init__(self, connection):
        self.connection = connection

    def execute(self, statement):
        connection = self.connection
        connection.attempted_statements.append(statement)
        if connection.closed:
            raise RuntimeError("connection is closed")
        if connection.aborted:
            raise RuntimeError("current transaction is aborted")
        connection.transaction_open = True
        if statement in connection.fail_statements:
            connection.aborted = True
            raise RuntimeError("memory is temporarily unavailable")

    def close(self):
        pass


class FakeGaussDBJDBCConnection:
    """Model JDBC AutoCommit=False and PostgreSQL-style aborted transactions."""

    def __init__(self, *, fail_statements=(), fail_rollback=False):
        self.jconn = FakeJavaConnection(auto_commit=False)
        self.fail_statements = set(fail_statements)
        self.fail_rollback = fail_rollback
        self.aborted = False
        self.transaction_open = False
        self.attempted_statements = []
        self.rollback_calls = 0
        self.closed = False

    def cursor(self):
        return FakeJDBCCursor(self)

    def rollback(self):
        self.rollback_calls += 1
        if self.fail_rollback:
            raise RuntimeError("JDBC rollback failed")
        self.aborted = False
        self.transaction_open = False

    def close(self):
        self.closed = True


class SearchTransactionRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.provider = KeywordSearchProvider()
        self.provider._db_profile = "gaussdb"
        self.configs = [
            {"type": "asset", "statement": "asset-search"},
            {"type": "indicator", "statement": "indicator-search"},
        ]

    def _run(self, connections):
        def search_one(connection, config, query, limit, profile=None):
            # A module always starts in a clean transaction. Results from this
            # module are fully materialized before the transaction is rolled back.
            if connection.transaction_open:
                raise AssertionError("module inherited a previous transaction")
            cursor = connection.cursor()
            try:
                cursor.execute(config["statement"])
            finally:
                cursor.close()
            return {
                "type": config["type"],
                "count": 1,
                "hasMore": False,
                "items": [],
            }

        with (
            patch.object(self.provider, "_visible_configs", return_value=self.configs),
            patch.object(self.provider, "_search_one", side_effect=search_one),
            patch(
                "backend.app.services.search_provider.connect_with_profile",
                side_effect=connections,
            ) as connect,
        ):
            result = self.provider.search("query", scope="all", profile="internal")
        return result, connect

    def test_gaussdb_aborted_transaction_recovers_after_successful_rollback(self):
        connection = FakeGaussDBJDBCConnection(fail_statements={"asset-search"})

        result, connect = self._run([connection])

        self.assertEqual(1, connect.call_count)
        self.assertEqual(["asset-search", "indicator-search"], connection.attempted_statements)
        self.assertEqual(2, connection.rollback_calls)
        self.assertFalse(connection.aborted)
        self.assertTrue(connection.closed)
        self.assertEqual(["indicator"], [group["type"] for group in result["groups"]])
        self.assertTrue(result["partial"])
        self.assertEqual(["asset"], result["failedGroups"])

    def test_failed_rollback_discards_session_and_uses_fresh_connection(self):
        aborted_connection = FakeGaussDBJDBCConnection(
            fail_statements={"asset-search"}, fail_rollback=True
        )
        fresh_connection = FakeGaussDBJDBCConnection()

        result, connect = self._run([aborted_connection, fresh_connection])

        self.assertEqual(2, connect.call_count)
        self.assertEqual(["asset-search"], aborted_connection.attempted_statements)
        self.assertEqual(["indicator-search"], fresh_connection.attempted_statements)
        self.assertTrue(aborted_connection.closed)
        self.assertTrue(fresh_connection.closed)
        self.assertEqual(["indicator"], [group["type"] for group in result["groups"]])
        self.assertTrue(result["partial"])
        self.assertEqual(["asset"], result["failedGroups"])

    def test_failed_rollback_and_reconnect_fail_closed_without_reusing_session(self):
        aborted_connection = FakeGaussDBJDBCConnection(
            fail_statements={"asset-search"}, fail_rollback=True
        )

        with self.assertRaisesRegex(SearchDataSourceError, "搜索模块暂时不可用"):
            self._run([aborted_connection, RuntimeError("reconnect unavailable")])

        self.assertEqual(1, aborted_connection.rollback_calls)
        self.assertEqual(["asset-search"], aborted_connection.attempted_statements)
        self.assertTrue(aborted_connection.closed)

    def test_successful_module_transactions_are_rolled_back_between_groups(self):
        connection = FakeGaussDBJDBCConnection()

        result, connect = self._run([connection])

        self.assertEqual(1, connect.call_count)
        self.assertEqual(2, connection.rollback_calls)
        self.assertEqual(["asset", "indicator"], [group["type"] for group in result["groups"]])
        self.assertNotIn("partial", result)

    def test_all_module_failures_keep_global_error_contract(self):
        connection = FakeGaussDBJDBCConnection(
            fail_statements={"asset-search", "indicator-search"}
        )

        with self.assertRaisesRegex(SearchDataSourceError, "搜索模块暂时不可用"):
            self._run([connection])

        self.assertEqual(["asset-search", "indicator-search"], connection.attempted_statements)
        self.assertEqual(2, connection.rollback_calls)
        self.assertTrue(connection.closed)


if __name__ == "__main__":
    unittest.main()
