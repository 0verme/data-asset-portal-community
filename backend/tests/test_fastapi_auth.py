"""Focused tests for the FastAPI-native signed-session adapter."""

# pyright: reportMissingImports=false

from __future__ import annotations

import os
import unittest
from unittest.mock import MagicMock, patch

from backend.app.application import (
    SESSION_PAYLOAD_KEY,
    SignedSessionCodec,
)
from backend.app.core.capabilities import resolve_capabilities
from backend.app.fastapi.auth import get_native_session_identity
from backend.app.fastapi_app import create_fastapi_app
from backend.app.services.auth_service import AuthService, AuthValidationError
from fastapi.testclient import TestClient


class FastApiNativeAuthTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(
            os.environ,
            {
                "FLASK_ENV": "development",
                "FLASK_SECRET_KEY": "f2-native-auth-test-secret",
                "AUTH_SESSION_DAYS": "14",
            },
            clear=False,
        )
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.capabilities = resolve_capabilities()
        self.auth_service = MagicMock(spec=AuthService)
        self.operation_logs = MagicMock()
        self.operation_logs.get_logs.return_value = {"items": [], "total": 0}
        self.system_service = MagicMock()
        self.system_service.get_users.return_value = []
        self.operation_logs.get_log_detail.return_value = {
            "id": 1,
            "moduleName": "system",
        }

    def app(self, user):
        self.auth_service.authenticate.return_value = user
        return create_fastapi_app(
            capabilities=self.capabilities,
            identity_resolver=get_native_session_identity,
            auth_service_instance=self.auth_service,
            operation_log_service_instance=self.operation_logs,
            system_management_service_instance=self.system_service,
        )

    def test_codec_round_trips_signed_session_payload(self):
        payload = {
            SESSION_PAYLOAD_KEY: {
                "role": "admin",
                "user": "alice",
                "name": "管理员",
            }
        }
        codec = SignedSessionCodec(
            "f2-native-auth-test-secret",
            max_age=14 * 24 * 60 * 60,
        )
        native_cookie = codec.encode(payload)

        self.assertEqual(3, len(native_cookie.split(".")))
        self.assertEqual(payload, codec.decode(native_cookie))

    def test_codec_rejects_tampering_and_expired_cookie(self):
        codec = SignedSessionCodec("f2-native-auth-test-secret", max_age=10)
        valid = codec.encode({SESSION_PAYLOAD_KEY: {"role": "admin"}})
        payload_part, timestamp_part, signature_part = valid.split(".")
        changed_signature = ("A" if signature_part[0] != "A" else "B") + signature_part[
            1:
        ]
        tampered = ".".join((payload_part, timestamp_part, changed_signature))
        self.assertIsNone(codec.decode(tampered))
        self.assertIsNone(codec.decode("not-a-signed-session"))

        with patch("itsdangerous.timed.time.time", return_value=1000):
            expired_candidate = codec.encode({SESSION_PAYLOAD_KEY: {"role": "admin"}})
        with patch("itsdangerous.timed.time.time", return_value=1011):
            self.assertIsNone(codec.decode(expired_candidate))

    def test_runtime_dispatches_auth_to_native_fastapi_route(self):
        from backend.asgi import create_native_app

        user = {"role": "admin", "user": "alice", "name": "Alice"}
        native_application = self.app(user)
        runtime = create_native_app(
            capabilities=self.capabilities,
            fastapi_application=native_application,
        )
        client = TestClient(runtime)
        login = client.post(
            "/api/auth/login",
            json={"username": "alice", "password": "correct"},
        )
        self.assertEqual(200, login.status_code)
        self.assertEqual(user, client.get("/api/auth/me").json()["data"])

    def test_native_login_me_logout_and_cookie_flags(self):
        user = {"role": "admin", "user": "alice", "name": "Alice"}
        client = TestClient(self.app(user))

        login = client.post(
            "/api/auth/login",
            json={"username": "alice", "password": "correct", "remember": True},
        )
        self.assertEqual(200, login.status_code)
        self.assertEqual(user, login.json()["data"])
        set_cookie = login.headers["set-cookie"]
        self.assertIn("session=", set_cookie)
        self.assertIn("HttpOnly", set_cookie)
        self.assertIn("samesite=lax", set_cookie.lower())
        self.assertNotIn("Secure", set_cookie)
        self.assertIn("expires=", set_cookie.lower())

        current = client.get("/api/auth/me")
        self.assertEqual(200, current.status_code)
        self.assertEqual(user, current.json()["data"])
        self.operation_logs.record_best_effort_audit.assert_called_once()

        logout = client.post("/api/auth/logout")
        self.assertEqual(200, logout.status_code)
        self.assertIn("session=", logout.headers["set-cookie"])
        self.assertIn("HttpOnly", logout.headers["set-cookie"])
        self.assertEqual(401, client.get("/api/auth/me").status_code)
        self.assertEqual(2, self.operation_logs.record_best_effort_audit.call_count)

    def test_invalid_and_forged_identity_behave_as_anonymous(self):
        client = TestClient(
            self.app({"role": "admin", "user": "alice", "name": "Alice"})
        )
        codec = SignedSessionCodec(
            "f2-native-auth-test-secret", max_age=14 * 24 * 60 * 60
        )
        forged = codec.encode(
            {
                SESSION_PAYLOAD_KEY: {
                    "role": "viewer",
                    "user": "alice",
                    "name": "Alice",
                }
            }
        )
        client.cookies.set("session", forged)
        self.assertEqual(401, client.get("/api/auth/me").status_code)

        client.cookies.set("session", "invalid.signature")
        self.assertEqual(401, client.get("/api/auth/me").status_code)

    def test_admin_and_maintainer_authorization_use_native_identity(self):
        maintainer_client = TestClient(
            self.app({"role": "maintainer", "user": "maintainer", "name": "Maintainer"})
        )
        self.assertEqual(
            200,
            maintainer_client.post(
                "/api/auth/login",
                json={"username": "maintainer", "password": "correct"},
            ).status_code,
        )
        self.assertEqual(200, maintainer_client.get("/api/operation-logs").status_code)
        self.assertEqual(403, maintainer_client.get("/api/system/users").status_code)

        admin_client = TestClient(
            self.app({"role": "admin", "user": "admin", "name": "Admin"})
        )
        self.assertEqual(
            200,
            admin_client.post(
                "/api/auth/login",
                json={"username": "admin", "password": "correct"},
            ).status_code,
        )
        self.assertEqual(200, admin_client.get("/api/system/users").status_code)

    def test_anonymous_login_error_preserves_error_envelope(self):
        self.auth_service.authenticate.side_effect = AuthValidationError(
            "账号或密码不正确，请重试。"
        )
        client = TestClient(
            self.app({"role": "admin", "user": "alice", "name": "Alice"})
        )
        response = client.post(
            "/api/auth/login",
            json={"username": "alice", "password": "wrong"},
        )
        self.assertEqual(401, response.status_code)
        self.assertEqual(
            {"code": "INVALID_CREDENTIALS", "message": "账号或密码不正确，请重试。"},
            response.json()["error"],
        )


if __name__ == "__main__":
    unittest.main()
