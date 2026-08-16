import os
import unittest
from unittest.mock import patch

from backend.app import create_app
from backend.app.auth import SESSION_KEY
from backend.app.routes.report import (
    ReportAlreadyExistsError,
    ReportNotFoundError,
    ReportValidationError,
)


class ReportRouteTestCase(unittest.TestCase):
    def setUp(self):
        self._original_secret_key = os.getenv("FLASK_SECRET_KEY")
        self.addCleanup(self._restore_secret_key)
        os.environ["FLASK_SECRET_KEY"] = "test-only-report-route-secret"
        self.app = create_app()
        self.app.config.update(TESTING=True)
        self.client = self.app.test_client()

    def _restore_secret_key(self):
        if self._original_secret_key is None:
            os.environ.pop("FLASK_SECRET_KEY", None)
        else:
            os.environ["FLASK_SECRET_KEY"] = self._original_secret_key

    def _login_admin(self):
        with self.client.session_transaction() as session:
            session[SESSION_KEY] = {
                "role": "admin",
                "user": "tester",
                "name": "Test Admin",
            }

    @patch("backend.app.routes.report.report_service.get_reports")
    def test_get_reports_returns_items(self, mock_get_reports):
        mock_get_reports.return_value = [
            {
                "code": "RPT_PAY_DAILY",
                "name": "支付交易日报",
                "status": "enabled",
                "relatedTableCount": 2,
                "relatedIndicatorCount": 2,
            }
        ]

        response = self.client.get("/api/reports?type=经营分析&ownerDept=运营管理部")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["items"][0]["code"], "RPT_PAY_DAILY")
        mock_get_reports.assert_called_once_with(
            keyword=None,
            report_type="经营分析",
            domain=None,
            status=None,
            owner_dept="运营管理部",
        )

    @patch("backend.app.routes.report.report_service.get_report_detail")
    def test_get_report_detail_not_found(self, mock_get_report_detail):
        mock_get_report_detail.side_effect = ReportNotFoundError("RPT_MISSING")

        response = self.client.get("/api/reports/RPT_MISSING")

        self.assertEqual(response.status_code, 404)
        payload = response.get_json()
        self.assertEqual(payload["error"]["code"], "REPORT_NOT_FOUND")

    def test_create_report_requires_admin_login(self):
        response = self.client.post("/api/reports", json={"code": "RPT_PAY_DAILY"})

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.get_json()["error"]["code"], "UNAUTHORIZED")

    @patch("backend.app.routes.report.report_service.create_report")
    def test_create_report_returns_created_data_when_logged_in(self, mock_create_report):
        self._login_admin()
        mock_create_report.return_value = {
            "code": "RPT_PAY_DAILY",
            "name": "支付交易日报",
            "status": "enabled",
        }

        response = self.client.post(
            "/api/reports",
            json={
                "code": "RPT_PAY_DAILY",
                "name": "支付交易日报",
                "type": "经营分析",
                "status": "enabled",
                "ownerDept": "运营管理部",
                "ownerName": "张薇",
                "relatedTables": [],
                "relatedIndicators": [],
            },
        )

        self.assertEqual(response.status_code, 201)
        payload = response.get_json()
        self.assertEqual(payload["data"]["code"], "RPT_PAY_DAILY")
        mock_create_report.assert_called_once()

    @patch("backend.app.routes.report.report_service.create_report")
    def test_create_report_returns_422_for_validation_error(self, mock_create_report):
        self._login_admin()
        mock_create_report.side_effect = ReportValidationError(
            [{"field": "ownerName", "message": "ownerName is required"}]
        )

        response = self.client.post("/api/reports", json={})

        self.assertEqual(response.status_code, 422)
        payload = response.get_json()
        self.assertEqual(payload["error"]["code"], "REPORT_VALIDATION_FAILED")
        self.assertEqual(payload["error"]["details"][0]["field"], "ownerName")

    @patch("backend.app.routes.report.report_service.update_report")
    def test_update_report_returns_409_for_duplicate_code(self, mock_update_report):
        self._login_admin()
        mock_update_report.side_effect = ReportAlreadyExistsError("RPT_PAY_DAILY")

        response = self.client.put(
            "/api/reports/RPT_LOAN_WEEKLY",
            json={
                "code": "RPT_PAY_DAILY",
                "name": "支付交易日报",
                "type": "经营分析",
                "status": "enabled",
                "ownerDept": "运营管理部",
                "ownerName": "张薇",
                "relatedTables": [],
                "relatedIndicators": [],
            },
        )

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.get_json()["error"]["code"], "REPORT_ALREADY_EXISTS")

    @patch("backend.app.routes.report.report_service.delete_report")
    def test_delete_report_returns_success_when_logged_in(self, mock_delete_report):
        self._login_admin()

        response = self.client.delete("/api/reports/RPT_PAY_DAILY")

        self.assertEqual(response.status_code, 200)
        self.assertIn("message", response.get_json())
        mock_delete_report.assert_called_once_with("RPT_PAY_DAILY")


if __name__ == "__main__":
    unittest.main()
