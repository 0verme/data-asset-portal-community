# pyright: reportMissingImports=false

import inspect
import unittest
from unittest.mock import MagicMock, patch

from backend.app.application import Identity, RequestContext, request_context_scope
from backend.app.services.operation_log_service import (
    AuditLogError,
    OperationLogService,
)
from backend.tests.db_test_support import skip_without_postgres_integration
from sqlalchemy.dialects import mysql, postgresql, sqlite


class OperationLogServiceUnitTests(unittest.TestCase):
    def setUp(self):
        self.service = OperationLogService()
        self.table_patch = patch(
            "backend.app.services.operation_log_service.TABLE_OPERATION_LOG",
            "dwp.p_operation_log",
        )
        self.table_patch.start()

    def tearDown(self):
        self.table_patch.stop()

    def test_service_reads_audit_metadata_from_neutral_context(self):
        context = RequestContext(
            identity=Identity("maintainer", "alice", "Alice"),
            method="POST",
            path="/api/assets/tables",
            client_address="203.0.113.10",
            user_agent="neutral-test-agent",
            elapsed_time_ms=37,
        )
        with request_context_scope(context):
            self.assertEqual(
                {
                    "userId": "alice",
                    "userName": "Alice",
                    "deptName": "",
                    "requestMethod": "POST",
                    "requestUrl": "/api/assets/tables",
                    "ipAddress": "203.0.113.10",
                    "userAgent": "neutral-test-agent",
                },
                self.service._request_context(),
            )
            self.assertEqual(37, self.service._cost_time_ms())

    def test_service_source_has_no_flask_request_dependency(self):
        source = inspect.getsource(OperationLogService).lower()
        self.assertNotIn("flask", source)

    def test_generated_insert_delegates_id_to_database(self):
        sql = self.service._build_audit_insert_sql(
            module_name="test",
            operation_type="CREATE",
            operation_object="item",
        )
        self.assertNotIn("MAX(", sql.upper())
        self.assertNotIn(" id,", sql.lower())
        self.assertIn("INSERT INTO dwp.p_operation_log", sql)
        self.assertIn("CURRENT_TIMESTAMP", sql)

    def test_snapshots_redact_sensitive_values_in_sql_payload(self):
        sql = self.service._build_audit_insert_sql(
            module_name="test",
            operation_type="CREATE",
            operation_object="item",
            before={"password": "p", "token": "t", "safe": "kept"},
            after={"jdbc_url": "jdbc:secret", "connectionString": "secret"},
        )
        self.assertIn("[REDACTED]", sql)
        self.assertIn("kept", sql)
        self.assertNotIn("jdbc:secret", sql)
        self.assertNotIn("'p'", sql)
        self.assertNotIn("'t'", sql)

    def test_batch_summary_stores_counts_not_rows(self):
        conn = MagicMock()
        cursor = conn.cursor.return_value
        self.service.record_required_batch_audit(
            connection=conn,
            batch_id="batch-1",
            resource_type="root",
            operation="IMPORT",
            total_count=10,
            success_count=8,
            failed_count=1,
            skipped_count=1,
            summary="root import",
        )
        sql = cursor.execute.call_args.args[0]
        self.assertIn('"batchId": "batch-1"', sql)
        self.assertIn('"totalCount": 10', sql)
        self.assertNotIn("rows", sql)
        conn.commit.assert_not_called()

    def test_required_audit_uses_external_connection_without_commit(self):
        conn = MagicMock()
        cursor = conn.cursor.return_value
        self.assertTrue(
            self.service.record_required_audit(
                connection=conn,
                module_name="test",
                operation_type="CREATE",
                operation_object="item",
            )
        )
        cursor.execute.assert_called_once()
        conn.commit.assert_not_called()
        conn.rollback.assert_not_called()

    def test_required_audit_failure_raises_domain_error_without_swallowing(self):
        conn = MagicMock()
        cursor = conn.cursor.return_value
        cursor.execute.side_effect = RuntimeError("db down")
        with self.assertRaises(AuditLogError):
            self.service.record_required_audit(
                connection=conn,
                module_name="test",
                operation_type="CREATE",
                operation_object="item",
            )
        conn.commit.assert_not_called()

    def test_best_effort_failure_returns_false_and_logs_without_sensitive_values(self):
        conn = MagicMock()
        cursor = conn.cursor.return_value
        cursor.execute.side_effect = RuntimeError("db down")
        with self.assertLogs("backend.app.services.operation_log_service", level="ERROR") as logs:
            result = self.service.record_best_effort_audit(
                connection=conn,
                module_name="auth",
                operation_type="LOGIN",
                operation_object="user",
                before={"password": "do-not-log"},
            )
        self.assertFalse(result)
        self.assertNotIn("do-not-log", "\n".join(logs.output))

    def test_log_page_reuses_one_transaction_scope_and_preserves_empty_page_total(self):
        self.service._db_profile = "test"
        rows_page = [
            {
                "id": 2,
                "module_name": "root",
                "operation_type": "UPDATE",
                "result_status": "success",
                "created_at": "2026-07-30 11:00:00",
                "cost_time_ms": 0,
            }
        ]
        with patch(
            "backend.app.services.operation_log_service.database_transaction"
        ) as tx, patch.object(
            self.service,
            "_fetch_rows",
            side_effect=[[{"total": 3}], rows_page],
        ) as fetch:
            tx.return_value.__enter__.return_value = None
            tx.return_value.__exit__.return_value = None
            result = self.service.get_logs({"page": 2, "pageSize": 1})

        self.assertEqual([item["id"] for item in result["items"]], [2])
        self.assertEqual(result["total"], 3)
        self.assertEqual(fetch.call_count, 2)
        tx.assert_called_once()

    def test_log_queries_use_bound_core_filters_and_logical_schema(self):
        self.service._db.fetch_rows = MagicMock(side_effect=[[{"total": 1}], [{"id": 2}]])

        result = self.service.get_logs({"keyword": "root' OR 1=1", "module": "root"})

        self.assertEqual(1, result["total"])
        statements = [call.args[0] for call in self.service._db.fetch_rows.call_args_list]
        for statement in statements:
            for dialect in (sqlite.dialect(), postgresql.dialect(), mysql.dialect()):
                with self.subTest(dialect=dialect.name):
                    compiled = statement.compile(dialect=dialect)
                    self.assertIn("p_operation_log", str(compiled))
                    self.assertIn("__app__", str(compiled))
                    self.assertNotIn("root' OR 1=1", str(compiled))

    def test_audit_context_records_on_success_using_shared_connection(self):
        self.service._db_profile = "test"
        shared_conn = MagicMock()

        with patch(
            "backend.app.services.operation_log_service.database_transaction"
        ) as tx, patch(
            "backend.app.services.operation_log_service.active_transaction_connection",
            return_value=shared_conn,
        ), patch.object(
            self.service,
            "record_required_audit",
            return_value=True,
        ) as record:
            tx.return_value.__enter__.return_value = MagicMock()
            tx.return_value.__exit__.return_value = None
            with self.service.audit(
                module_name="test",
                operation_type="CREATE",
                operation_object="item",
            ) as audit:
                audit.after = {"value": "committed"}
            record.assert_called_once()
            self.assertIs(record.call_args.kwargs["connection"], shared_conn)

    def test_audit_context_raises_when_no_shared_connection_was_used(self):
        self.service._db_profile = "test"
        with patch(
            "backend.app.services.operation_log_service.database_transaction"
        ) as tx, patch(
            "backend.app.services.operation_log_service.active_transaction_connection",
            return_value=None,
        ):
            tx.return_value.__enter__.return_value = MagicMock()
            tx.return_value.__exit__.return_value = None
            with self.assertRaises(AuditLogError), self.service.audit(
                module_name="test",
                operation_type="CREATE",
                operation_object="item",
            ):
                pass


@skip_without_postgres_integration()
class OperationLogPostgresIntegrationTests(unittest.TestCase):
    def test_placeholder_documents_required_env(self):
        """Real transaction/sequence/concurrency checks require an isolated PG test DB.

        Configure TEST_DATABASE_PROFILE + TEST_DATABASE_CONFIG_PATH to enable.
        This placeholder ensures the skip gate is present in the default suite.
        """
        self.assertTrue(True)


if __name__ == "__main__":
    unittest.main()
