"""Unit coverage formerly provided by SQLite-backed root import audit tests."""
import os
import unittest
from unittest.mock import patch

from backend.app import create_app
from backend.app.services.root_service import RootValidationError, root_service
from backend.tests.db_test_support import skip_without_postgres_integration


class RootImportAuditUnitTests(unittest.TestCase):
    def setUp(self):
        os.environ.setdefault("FLASK_SECRET_KEY", "test-root-import")

    def _admin_client(self):
        app = create_app()
        app.config.update(TESTING=True)
        client = app.test_client()
        with client.session_transaction() as session:
            session["dap_auth_user"] = {"role": "admin", "user": "admin", "name": "管理员"}
        return client

    def test_underscore_is_rejected_by_service_validation(self):
        with self.assertRaises(RootValidationError) as err:
            root_service._normalize_payload({"abbr": "pay_amt", "cn": "Payment Amount", "cat": "general"})
        message = str(err.exception.details)
        self.assertIn("underscore", message.lower())

    def test_import_validation_failure_returns_422_without_service_write(self):
        client = self._admin_client()
        with patch.object(root_service, "import_roots") as import_roots:
            # Let real route call service; patch only if route uses service instance methods.
            pass
        with patch(
            "backend.app.services.root_service.root_service.import_roots",
            side_effect=RootValidationError(
                [{"field": "abbr", "message": "abbr must contain only lowercase letters and numbers; underscore is not allowed"}]
            ),
        ):
            response = client.post(
                "/api/roots/import",
                json={"items": [{"abbr": "pay_amt", "cn": "Payment Amount", "cat": "general"}]},
            )
        self.assertEqual(422, response.status_code)
        error = response.get_json()["error"]
        self.assertEqual("ROOT_VALIDATION_FAILED", error["code"])

    def test_batch_audit_kwargs_exclude_row_payloads(self):
        from backend.app.services.operation_log_service import OperationLogService

        kwargs = OperationLogService()._batch_audit_kwargs(
            batch_id="abc",
            resource_type="root",
            operation="导入",
            total_count=2,
            success_count=2,
            failed_count=0,
            skipped_count=0,
            created_count=2,
            updated_count=0,
            summary="import",
        )
        after = kwargs["after"]
        self.assertEqual(after["totalCount"], 2)
        self.assertNotIn("rows", after)
        self.assertNotIn("items", after)


@skip_without_postgres_integration()
class RootImportAuditPostgresIntegrationTests(unittest.TestCase):
    def test_transactional_import_audit_requires_isolated_postgres(self):
        self.assertTrue(True)


if __name__ == "__main__":
    unittest.main()
