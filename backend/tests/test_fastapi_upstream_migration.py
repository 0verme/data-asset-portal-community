"""Flask/FastAPI parity tests for the P4 Upstream module migration."""
from __future__ import annotations

import os
import unittest
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from backend.app import create_app
from backend.app.application import Identity
from backend.app.core.capabilities import resolve_capabilities
from backend.app.fastapi_app import create_fastapi_app
from backend.app.services.upstream_service import UpstreamValidationError


SYSTEM = {
    "upstreamSystemId": 1,
    "id": "CRM",
    "abbr": "CRM",
    "name": "Customer system",
    "status": "enabled",
}


class FastApiUpstreamMigrationTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(
            os.environ, {"FLASK_SECRET_KEY": "test-fastapi-upstream"}, clear=False
        )
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.capabilities = resolve_capabilities(edition="private")

    def apps(self, service, identity=None, capabilities=None):
        capabilities = capabilities or self.capabilities
        flask_app = create_app(capabilities=capabilities)
        flask_app.config.update(TESTING=True)
        fastapi_app = create_fastapi_app(
            capabilities=capabilities,
            identity_resolver=lambda _request: identity,
            upstream_service_instance=service,
        )
        return flask_app, fastapi_app

    @staticmethod
    def flask_client(app, role=None):
        client = app.test_client()
        if role:
            with client.session_transaction() as session:
                session["dap_auth_user"] = {
                    "role": role,
                    "user": "tester",
                    "name": "Tester",
                }
        return client

    def test_list_detail_admin_detail_and_create_preserve_parity(self):
        service = MagicMock()
        service.get_systems.return_value = [SYSTEM]
        service.get_system_detail.return_value = SYSTEM
        service.get_system_admin_detail.return_value = {**SYSTEM, "host": "db"}
        service.create_system.return_value = SYSTEM
        with patch("backend.app.routes.upstream.upstream_service", service):
            flask_app, fastapi_app = self.apps(
                service, Identity("maintainer", "tester", "Tester")
            )
            flask_client = self.flask_client(flask_app, "maintainer")
            fastapi_client = TestClient(fastapi_app)
            requests = (
                ("get", "/api/upstreams/systems?dbType=postgres&page=1&pageSize=20", None),
                ("get", "/api/upstreams/systems/CRM", None),
                ("get", "/api/upstreams/systems/CRM/admin-detail", None),
                ("post", "/api/upstreams/systems", {"id": "CRM"}),
            )
            for method, path, body in requests:
                with self.subTest(path=path):
                    if method == "get":
                        flask_response = getattr(flask_client, method)(path)
                        fastapi_response = getattr(fastapi_client, method)(path)
                    else:
                        flask_response = getattr(flask_client, method)(path, json=body)
                        fastapi_response = getattr(fastapi_client, method)(path, json=body)
                    self.assertEqual(flask_response.status_code, fastapi_response.status_code)
                    self.assertEqual(flask_response.get_json(), fastapi_response.json())

    def test_validation_and_auth_behavior_preserve_parity(self):
        service = MagicMock()
        service.create_system.side_effect = UpstreamValidationError(
            [{"field": "id", "message": "required"}]
        )
        with patch("backend.app.routes.upstream.upstream_service", service):
            flask_app, fastapi_app = self.apps(
                service, Identity("maintainer", "tester", "Tester")
            )
            flask_response = self.flask_client(flask_app, "maintainer").post(
                "/api/upstreams/systems", json={}
            )
            fastapi_response = TestClient(fastapi_app).post(
                "/api/upstreams/systems", json={}
            )
            self.assertEqual(flask_response.status_code, 422)
            self.assertEqual(flask_response.status_code, fastapi_response.status_code)
            self.assertEqual(flask_response.get_json(), fastapi_response.json())

        unauthenticated_flask, unauthenticated_fastapi = self.apps(MagicMock())
        flask_response = self.flask_client(unauthenticated_flask).post(
            "/api/upstreams/systems", json={}
        )
        fastapi_response = TestClient(unauthenticated_fastapi).post(
            "/api/upstreams/systems", json={}
        )
        self.assertEqual(flask_response.status_code, fastapi_response.status_code)
        self.assertEqual(flask_response.get_json(), fastapi_response.json())

    def test_capability_gate_keeps_upstream_disabled_when_not_enabled(self):
        capabilities = resolve_capabilities(enabled=["dwm"], edition="private")
        flask_app, fastapi_app = self.apps(MagicMock(), capabilities=capabilities)
        self.assertEqual(
            404,
            self.flask_client(flask_app, "maintainer")
            .get("/api/upstreams/systems")
            .status_code,
        )
        self.assertEqual(
            404, TestClient(fastapi_app).get("/api/upstreams/systems").status_code
        )


if __name__ == "__main__":
    unittest.main()
