"""Flask/FastAPI parity tests for the P4 Manual Code Table migration."""

from __future__ import annotations

import os
import unittest
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from backend.app import create_app
from backend.app.application import Identity
from backend.app.core.capabilities import resolve_capabilities
from backend.app.fastapi_app import create_fastapi_app
from backend.app.services.manual_code_table_service import ManualCodeTableNotFoundError


TABLE = {
    "id": "1",
    "tableCode": "STATUS_CODE",
    "tableName": "Status",
    "style": "status",
    "owner": "tester",
    "status": "active",
    "remark": "demo",
    "createdBy": "tester",
    "createdAt": "2026-08-20",
    "updatedBy": "tester",
    "updatedAt": "2026-08-20",
}


class FastApiCodeTableMigrationTests(unittest.TestCase):
    def setUp(self):
        self._old_secret = os.environ.get("FLASK_SECRET_KEY")
        os.environ["FLASK_SECRET_KEY"] = "test-fastapi-code-table"
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
        service_patch = patch("backend.app.routes.manual_code_table.manual_code_table_service", service)
        service_patch.start()
        self.addCleanup(service_patch.stop)
        fastapi_app = create_fastapi_app(
            capabilities=capabilities,
            identity_resolver=lambda _request: identity,
            manual_code_table_service_instance=service,
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

    def test_list_detail_and_export_have_parity(self):
        service = MagicMock()
        service.get_tables.return_value = [TABLE]
        service.get_table.return_value = TABLE
        flask_app, fastapi_app = self._apps(service)
        flask_client = flask_app.test_client()
        fastapi_client = TestClient(fastapi_app)

        self.assertEqual(
            flask_client.get("/api/manual-code-tables?style=status").get_json(),
            fastapi_client.get("/api/manual-code-tables?style=status").json(),
        )
        self.assertEqual(
            flask_client.get("/api/manual-code-tables/1").get_json(),
            fastapi_client.get("/api/manual-code-tables/1").json(),
        )
        flask_csv = flask_client.get("/api/manual-code-tables/export")
        fastapi_csv = fastapi_client.get("/api/manual-code-tables/export")
        self.assertEqual(flask_csv.status_code, fastapi_csv.status_code)
        self.assertEqual(flask_csv.data, fastapi_csv.content)

    def test_authenticated_create_preserves_body_and_response(self):
        service = MagicMock()
        service.create_table.return_value = TABLE
        flask_app, fastapi_app = self._apps(
            service, identity=Identity("maintainer", "tester", "Tester")
        )
        body = {
            "tableCode": "STATUS_CODE",
            "tableName": "Status",
            "style": "status",
            "owner": "tester",
            "status": "active",
            "remark": "demo",
        }
        flask_response = self._login_as_maintainer(flask_app).post(
            "/api/manual-code-tables", json=body
        )
        fastapi_response = TestClient(fastapi_app).post(
            "/api/manual-code-tables", json=body
        )
        self.assertEqual(201, flask_response.status_code)
        self.assertEqual(flask_response.get_json(), fastapi_response.json())
        service.create_table.assert_called_with(body)

    def test_auth_not_found_and_community_boundary(self):
        service = MagicMock()
        service.get_table.side_effect = ManualCodeTableNotFoundError("missing")
        flask_app, fastapi_app = self._apps(service)
        flask_response = flask_app.test_client().get("/api/manual-code-tables/missing")
        fastapi_client = TestClient(fastapi_app)
        fastapi_response = fastapi_client.get("/api/manual-code-tables/missing")
        self.assertEqual(flask_response.status_code, fastapi_response.status_code)
        self.assertEqual(flask_response.get_json(), fastapi_response.json())
        self.assertEqual(
            flask_app.test_client().post("/api/manual-code-tables", json={}).get_json(),
            fastapi_client.post("/api/manual-code-tables", json={}).json(),
        )
        community_app = create_fastapi_app(capabilities=self.community_capabilities)
        self.assertEqual(404, TestClient(community_app).get("/api/manual-code-tables").status_code)


if __name__ == "__main__":
    unittest.main()
