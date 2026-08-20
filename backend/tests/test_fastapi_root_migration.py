"""Flask/FastAPI parity tests for the P4 Root module migration."""

from __future__ import annotations

import os
import unittest
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from backend.app import create_app
from backend.app.application import Identity
from backend.app.core.capabilities import resolve_capabilities
from backend.app.fastapi_app import create_fastapi_app
from backend.app.services.root_service import RootNotFoundError


ROOT = {"abbr": "cust", "en": "customer", "cn": "客户", "cat": "主体", "desc": "demo"}


class FastApiRootMigrationTests(unittest.TestCase):
    def setUp(self):
        self._old_secret = os.environ.get("FLASK_SECRET_KEY")
        os.environ["FLASK_SECRET_KEY"] = "test-fastapi-root"
        self.addCleanup(self._restore_secret)
        self.capabilities = resolve_capabilities(edition="community")

    def _restore_secret(self):
        if self._old_secret is None:
            os.environ.pop("FLASK_SECRET_KEY", None)
        else:
            os.environ["FLASK_SECRET_KEY"] = self._old_secret

    def _apps(self, service, *, identity=None):
        flask_app = create_app(capabilities=self.capabilities)
        flask_app.config.update(TESTING=True)
        service_patch = patch("backend.app.routes.root.root_service", service)
        service_patch.start()
        self.addCleanup(service_patch.stop)
        fastapi_app = create_fastapi_app(
            capabilities=self.capabilities,
            identity_resolver=lambda _request: identity,
            root_service_instance=service,
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

    def test_list_categories_and_detail_have_parity(self):
        service = MagicMock()
        service.get_roots.return_value = [ROOT]
        service.get_root_categories.return_value = [{"name": "主体", "count": 1}]
        service.get_root_detail.return_value = ROOT
        flask_app, fastapi_app = self._apps(service)
        flask_client = flask_app.test_client()
        fastapi_client = TestClient(fastapi_app)

        self.assertEqual(
            flask_client.get("/api/roots?keyword=cust").get_json(),
            fastapi_client.get("/api/roots?keyword=cust").json(),
        )
        self.assertEqual(
            flask_client.get("/api/roots/categories").get_json(),
            fastapi_client.get("/api/roots/categories").json(),
        )
        self.assertEqual(
            flask_client.get("/api/roots/cust").get_json(),
            fastapi_client.get("/api/roots/cust").json(),
        )

    def test_authenticated_create_preserves_body_and_response(self):
        service = MagicMock()
        service.create_root.return_value = ROOT
        flask_app, fastapi_app = self._apps(
            service, identity=Identity("maintainer", "tester", "Tester")
        )
        body = ROOT.copy()
        flask_response = self._login_as_maintainer(flask_app).post("/api/roots", json=body)
        fastapi_response = TestClient(fastapi_app).post("/api/roots", json=body)
        self.assertEqual(201, flask_response.status_code)
        self.assertEqual(flask_response.get_json(), fastapi_response.json())
        service.create_root.assert_called_with(body)

    def test_auth_and_not_found_error_parity(self):
        service = MagicMock()
        service.get_root_detail.side_effect = RootNotFoundError("missing")
        flask_app, fastapi_app = self._apps(service)
        flask_response = flask_app.test_client().get("/api/roots/missing")
        fastapi_client = TestClient(fastapi_app)
        fastapi_response = fastapi_client.get("/api/roots/missing")
        self.assertEqual(flask_response.status_code, fastapi_response.status_code)
        self.assertEqual(flask_response.get_json(), fastapi_response.json())
        self.assertEqual(
            flask_app.test_client().post("/api/roots", json={}).get_json(),
            fastapi_client.post("/api/roots", json={}).json(),
        )
        self.assertEqual(404, fastapi_client.get("/api/reports").status_code)


if __name__ == "__main__":
    unittest.main()
