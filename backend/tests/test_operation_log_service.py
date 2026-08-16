import unittest
from unittest.mock import MagicMock, patch

from backend.app.services.operation_log_service import AuditLogError, OperationLogService
from backend.tests.db_test_support import skip_without_postgres_integration


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
            with self.assertRaises(AuditLogError):
                with self.service.audit(
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
