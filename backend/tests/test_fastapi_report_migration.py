"""Flask/FastAPI parity tests for the P4 Report module migration."""

from __future__ import annotations

import os
import unittest
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from backend.app import create_app
from backend.app.application import Identity
from backend.app.core.capabilities import resolve_capabilities
from backend.app.fastapi_app import create_fastapi_app
from backend.app.services.report_service import ReportNotFoundError


REPORT = {
    "code": "RPT_CUSTOMER",
    "name": "Customer Report",
    "alias": "customer",
    "type": "经营分析",
    "domain": "营销",
    "freq": "日",
    "statPeriod": "日",
    "statCaliber": "自然日",
    "dataDelay": "T+1",
    "status": "enabled",
    "ownerDept": "数据部",
    "ownerName": "tester",
    "maintainerName": "tester",
    "relatedTables": [],
    "relatedIndicators": [],
    "relatedTableCount": 0,
    "relatedIndicatorCount": 0,
    "remark": "demo",
    "updatedAt": "2026-08-20",
    "dateCaliber": "自然日",
    "dataTimeliness": "T+1",
    "statScope": "customer",
    "timeCaliber": "",
}


class FastApiReportMigrationTests(unittest.TestCase):
    def setUp(self):
        self._old_secret = os.environ.get("FLASK_SECRET_KEY")
        os.environ["FLASK_SECRET_KEY"] = "test-fastapi-report"
        self.addCleanup(self._restore_secret)
        self.private_capabilities = resolve_capabilities(edition="private")
        self.community_capabilities = resolve_capabilities(edition="community")

    def _restore_secret(self):
        if self._old_secret is None:
            os.environ.pop("FLASK_SECRET_KEY", None)
        else:
            os.environ["FLASK_SECRET_KEY"] = self._old_secret

    def _apps(self, service, *, identity=None, capabilities=None):
        capabilities = capabilities or self.private_capabilities
        flask_app = create_app(capabilities=capabilities)
        flask_app.config.update(TESTING=True)
        service_patch = patch("backend.app.routes.report.report_service", service)
        service_patch.start()
        self.addCleanup(service_patch.stop)
        fastapi_app = create_fastapi_app(
            capabilities=capabilities,
            identity_resolver=lambda _request: identity,
            report_service_instance=service,
        )
        return flask_app, fastapi_app

    @staticmethod
    def _login_as_maintainer(flask_app):
        client = flask_app.test_client()
        with client.session_transaction() as session:
            session["dap_auth_user"] = {
                "role": "maintainer",
                "user": "tester",
                "name": "Tester",
            }
        return client

    def test_list_and_detail_have_parity(self):
        service = MagicMock()
        service.get_reports.return_value = [REPORT]
        service.get_report_detail.return_value = REPORT
        flask_app, fastapi_app = self._apps(service)
        flask_client = flask_app.test_client()
        fastapi_client = TestClient(fastapi_app)

        self.assertEqual(
            flask_client.get("/api/reports?type=经营分析").get_json(),
            fastapi_client.get("/api/reports?type=经营分析").json(),
        )
        self.assertEqual(
            flask_client.get("/api/reports/RPT_CUSTOMER").get_json(),
            fastapi_client.get("/api/reports/RPT_CUSTOMER").json(),
        )

    def test_authenticated_create_preserves_body_and_response(self):
        service = MagicMock()
        service.create_report.return_value = REPORT
        flask_app, fastapi_app = self._apps(
            service, identity=Identity("maintainer", "tester", "Tester")
        )
        body = {
            "code": "RPT_CUSTOMER",
            "name": "Customer Report",
            "type": "经营分析",
            "statPeriod": "日",
            "statCaliber": "自然日",
            "status": "enabled",
            "ownerDept": "数据部",
            "ownerName": "tester",
            "relatedTables": [],
            "relatedIndicators": [],
        }
        flask_response = self._login_as_maintainer(flask_app).post("/api/reports", json=body)
        fastapi_response = TestClient(fastapi_app).post("/api/reports", json=body)
        self.assertEqual(201, flask_response.status_code)
        self.assertEqual(flask_response.get_json(), fastapi_response.json())
        service.create_report.assert_called_with(body)

    def test_auth_not_found_and_community_boundary(self):
        service = MagicMock()
        service.get_report_detail.side_effect = ReportNotFoundError("missing")
        flask_app, fastapi_app = self._apps(service)
        flask_response = flask_app.test_client().get("/api/reports/missing")
        fastapi_client = TestClient(fastapi_app)
        fastapi_response = fastapi_client.get("/api/reports/missing")
        self.assertEqual(flask_response.status_code, fastapi_response.status_code)
        self.assertEqual(flask_response.get_json(), fastapi_response.json())
        self.assertEqual(
            flask_app.test_client().post("/api/reports", json={}).get_json(),
            fastapi_client.post("/api/reports", json={}).json(),
        )
        community_app = create_fastapi_app(capabilities=self.community_capabilities)
        self.assertEqual(404, TestClient(community_app).get("/api/reports").status_code)


if __name__ == "__main__":
    unittest.main()
