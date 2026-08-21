"""Flask/FastAPI parity tests for System Management and Operation Log."""
from __future__ import annotations

import os
import unittest
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from backend.app import create_app
from backend.app.application import Identity
from backend.app.core.capabilities import resolve_capabilities
from backend.app.fastapi_app import create_fastapi_app
from backend.app.services.operation_log_service import OperationLogNotFoundError
from backend.app.services.system_management_service import SystemValidationError


USERS = [{"username": "alice", "role": "admin", "status": "enabled"}]
MENUS = [
    {"code": "portal", "status": "enabled", "adminOnly": False},
    {"code": "system", "status": "enabled", "adminOnly": True},
    {"code": "hidden", "status": "disabled", "adminOnly": False},
]


class FastApiSystemManagementMigrationTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(
            os.environ,
            {"FLASK_SECRET_KEY": "test-fastapi-system-management"},
            clear=False,
        )
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.capabilities = resolve_capabilities(edition="community")

    def apps(self, system_service, operation_service, identity=None, capabilities=None):
        capabilities = capabilities or self.capabilities
        flask_app = create_app(capabilities=capabilities)
        flask_app.config.update(TESTING=True)
        fastapi_app = create_fastapi_app(
            capabilities=capabilities,
            identity_resolver=lambda _request: identity,
            system_management_service_instance=system_service,
            operation_log_service_instance=operation_service,
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

    def test_admin_user_and_dictionary_flows_preserve_parity(self):
        service = MagicMock()
        service.get_users.return_value = USERS
        service.create_user.return_value = USERS[0]
        service.get_param_dicts.return_value = [{"id": "1", "categoryCode": "STATUS"}]
        operation_service = MagicMock()
        with patch(
            "backend.app.routes.system_management.system_management_service", service
        ):
            flask_app, fastapi_app = self.apps(
                service, operation_service, Identity("admin", "tester", "Tester")
            )
            flask_client = self.flask_client(flask_app, "admin")
            fastapi_client = TestClient(fastapi_app)
            pairs = (
                ("get", "/api/system/users", None),
                ("post", "/api/system/users", {"username": "alice"}),
                ("get", "/api/system/param-dicts?categoryCode=STATUS", None),
            )
            for method, path, body in pairs:
                with self.subTest(path=path):
                    if method == "get":
                        flask_response = getattr(flask_client, method)(path)
                        fastapi_response = getattr(fastapi_client, method)(path)
                    else:
                        flask_response = getattr(flask_client, method)(path, json=body)
                        fastapi_response = getattr(fastapi_client, method)(path, json=body)
                    self.assertEqual(flask_response.status_code, fastapi_response.status_code)
                    self.assertEqual(flask_response.get_json(), fastapi_response.json())

    def test_admin_gate_and_validation_error_preserve_parity(self):
        service = MagicMock()
        service.create_user.side_effect = SystemValidationError(
            "User validation failed", [{"field": "username", "message": "required"}]
        )
        operation_service = MagicMock()
        with patch(
            "backend.app.routes.system_management.system_management_service", service
        ):
            flask_app, fastapi_app = self.apps(
                service, operation_service, Identity("admin", "tester", "Tester")
            )
            flask_response = self.flask_client(flask_app, "admin").post(
                "/api/system/users", json={}
            )
            fastapi_response = TestClient(fastapi_app).post(
                "/api/system/users", json={}
            )
            self.assertEqual(flask_response.status_code, 422)
            self.assertEqual(flask_response.status_code, fastapi_response.status_code)
            self.assertEqual(flask_response.get_json(), fastapi_response.json())

        unauthenticated_flask, unauthenticated_fastapi = self.apps(
            MagicMock(), MagicMock()
        )
        flask_response = self.flask_client(unauthenticated_flask).get("/api/system/users")
        fastapi_response = TestClient(unauthenticated_fastapi).get("/api/system/users")
        self.assertEqual(flask_response.status_code, fastapi_response.status_code)
        self.assertEqual(flask_response.get_json(), fastapi_response.json())

    def test_menu_visibility_and_operation_log_parity(self):
        service = MagicMock()
        service.get_menus.return_value = MENUS
        operation_service = MagicMock()
        operation_service.get_logs.return_value = {"items": [], "total": 0}
        operation_service.get_log_detail.return_value = {"id": 1, "moduleName": "system"}
        with patch(
            "backend.app.routes.system_management.system_management_service", service
        ), patch(
            "backend.app.routes.operation_log.operation_log_service", operation_service
        ):
            flask_app, fastapi_app = self.apps(
                service, operation_service, Identity("maintainer", "tester", "Tester")
            )
            flask_client = self.flask_client(flask_app, "maintainer")
            fastapi_client = TestClient(fastapi_app)
            for path in (
                "/api/system/menus",
                "/api/operation-logs?module=system&page=1&pageSize=20",
                "/api/operation-logs/1",
            ):
                with self.subTest(path=path):
                    flask_response = flask_client.get(path)
                    fastapi_response = fastapi_client.get(path)
                    self.assertEqual(flask_response.status_code, fastapi_response.status_code)
                    self.assertEqual(flask_response.get_json(), fastapi_response.json())

    def test_operation_log_error_and_system_capability_gate_preserve_parity(self):
        service = MagicMock()
        operation_service = MagicMock()
        operation_service.get_log_detail.side_effect = OperationLogNotFoundError("missing")
        with patch(
            "backend.app.routes.operation_log.operation_log_service", operation_service
        ):
            flask_app, fastapi_app = self.apps(
                service, operation_service, Identity("maintainer", "tester", "Tester")
            )
            flask_response = self.flask_client(flask_app, "maintainer").get(
                "/api/operation-logs/missing"
            )
            fastapi_response = TestClient(fastapi_app).get(
                "/api/operation-logs/missing"
            )
            self.assertEqual(flask_response.status_code, 404)
            self.assertEqual(flask_response.status_code, fastapi_response.status_code)
            self.assertEqual(flask_response.get_json(), fastapi_response.json())

        capabilities = resolve_capabilities(enabled=["dwm"], edition="community")
        flask_app, fastapi_app = self.apps(
            MagicMock(), MagicMock(), capabilities=capabilities
        )
        self.assertEqual(
            404, self.flask_client(flask_app, "admin").get("/api/system/users").status_code
        )
        self.assertEqual(
            404, TestClient(fastapi_app).get("/api/system/users").status_code
        )


if __name__ == "__main__":
    unittest.main()
