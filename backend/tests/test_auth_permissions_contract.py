"""P4 authentication response and existing-session refresh tests."""

# pyright: reportMissingImports=false

from __future__ import annotations

import os
import unittest
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from backend.app.authorization.core import AuthorizationService, AuthorizationSubject
from backend.app.fastapi.auth import get_native_session_identity
from backend.app.fastapi_app import create_fastapi_app
from backend.app.services.auth_service import AuthService


class AuthPermissionsContractTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(
            os.environ,
            {
                "FLASK_ENV": "development",
                "FLASK_SECRET_KEY": "p4-auth-contract-test-secret",
                "AUTH_SESSION_DAYS": "14",
            },
            clear=False,
        )
        self.environment.start()
        self.addCleanup(self.environment.stop)

        self.subject = AuthorizationSubject("alice", "admin")
        self.permission_set = {"indicator:write", "operation_log:read"}
        repository = MagicMock()
        repository.get_subject.side_effect = lambda _identity: self.subject
        repository.get_permissions.side_effect = lambda _role: self.permission_set
        self.authorization = AuthorizationService(repository)
        self.auth_service = MagicMock(spec=AuthService)
        self.auth_service.authenticate.return_value = {
            "role": "admin",
            "user": "alice",
            "name": "Alice",
        }
        self.operation_logs = MagicMock()
        self.client = TestClient(
            create_fastapi_app(
                identity_resolver=get_native_session_identity,
                authorization_service_instance=self.authorization,
                auth_service_instance=self.auth_service,
                operation_log_service_instance=self.operation_logs,
            )
        )

    def test_login_and_me_return_sorted_current_permissions(self):
        login = self.client.post(
            "/api/auth/login",
            json={"username": "alice", "password": "correct"},
        )
        self.assertEqual(200, login.status_code)
        self.assertEqual(
            ["indicator:write", "operation_log:read"],
            login.json()["data"]["permissions"],
        )
        self.assertEqual(
            login.json()["data"]["permissions"],
            self.client.get("/api/auth/me").json()["data"]["permissions"],
        )

    def test_role_change_and_revocation_refresh_an_existing_cookie(self):
        self.assertEqual(
            200,
            self.client.post(
                "/api/auth/login",
                json={"username": "alice", "password": "correct"},
            ).status_code,
        )

        self.subject = AuthorizationSubject("alice", "maintainer")
        self.permission_set = {"indicator:read"}
        changed = self.client.get("/api/auth/me")
        self.assertEqual(200, changed.status_code)
        self.assertEqual("maintainer", changed.json()["data"]["role"])
        self.assertEqual(["indicator:read"], changed.json()["data"]["permissions"])

        self.permission_set.clear()
        revoked = self.client.get("/api/auth/me")
        self.assertEqual([], revoked.json()["data"]["permissions"])

        self.subject = AuthorizationSubject("alice", "maintainer", user_enabled=False)
        disabled = self.client.get("/api/auth/me")
        self.assertEqual(401, disabled.status_code)

    def test_custom_role_is_returned_without_admin_upgrade(self):
        self.auth_service.authenticate.return_value = {
            "role": "indicator-maintainer",
            "user": "alice",
            "name": "Alice",
        }
        self.subject = AuthorizationSubject("alice", "indicator-maintainer")
        self.permission_set = {"indicator:read", "operation_log:read"}

        login = self.client.post(
            "/api/auth/login",
            json={"username": "alice", "password": "correct"},
        )
        self.assertEqual(200, login.status_code)
        self.assertEqual("indicator-maintainer", login.json()["data"]["role"])
        self.assertEqual(
            ["indicator:read", "operation_log:read"],
            login.json()["data"]["permissions"],
        )


if __name__ == "__main__":
    unittest.main()
