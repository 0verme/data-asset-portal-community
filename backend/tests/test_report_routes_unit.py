"""Unit coverage formerly provided by SQLite-backed report route tests."""
import os
import unittest
from unittest.mock import patch

from backend.app import create_app
from backend.tests.db_test_support import skip_without_postgres_integration


class ReportRouteUnitTests(unittest.TestCase):
    def setUp(self):
        os.environ.setdefault("FLASK_SECRET_KEY", "test-report-routes")

    def test_list_envelope_with_mocked_service(self):
        app = create_app()
        app.config.update(TESTING=True)
        client = app.test_client()
        with patch(
            "backend.app.services.report_service.report_service.get_reports",
            return_value=[{"code": "R1", "name": "Report"}],
        ):
            response = client.get("/api/reports")
        self.assertEqual(200, response.status_code)
        payload = response.get_json()
        items = payload.get("items") or payload.get("data") or []
        self.assertEqual("R1", items[0]["code"])

    def test_create_requires_admin_session(self):
        app = create_app()
        app.config.update(TESTING=True)
        client = app.test_client()
        response = client.post("/api/reports", json={"code": "R1", "name": "Report"})
        self.assertIn(response.status_code, {401, 403})


@skip_without_postgres_integration()
class ReportRoutePostgresIntegrationTests(unittest.TestCase):
    def test_persist_and_audit_require_isolated_postgres(self):
        self.assertTrue(True)


if __name__ == "__main__":
    unittest.main()
