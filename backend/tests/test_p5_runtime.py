"""P5 ASGI primary and Flask fallback runtime tests."""
from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.app import create_app
from backend.app.core.capabilities import resolve_capabilities


class P5RuntimeTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(
            os.environ,
            {
                "FLASK_ENV": "development",
                "FLASK_SECRET_KEY": "test-p5-runtime",
                "LINEAGE_DB_PROFILE": "",
                "BACKEND_RUNTIME": "fastapi",
            },
            clear=False,
        )
        self.environment.start()
        self.addCleanup(self.environment.stop)
        from backend.asgi import create_runtime_app

        self.create_runtime_app = create_runtime_app
        self.capabilities = resolve_capabilities(edition="community")

    def test_fastapi_primary_dispatches_migrated_routes_and_falls_back_for_common_routes(self):
        runtime = self.create_runtime_app(
            runtime_mode="fastapi", capabilities=self.capabilities
        )
        client = TestClient(runtime)
        health = client.get("/healthz")
        self.assertEqual(200, health.status_code)
        self.assertEqual("ok", health.json()["status"])
        self.assertTrue(health.json()["fastapiPrimary"])
        self.assertEqual("nosniff", health.headers["X-Content-Type-Options"])

        migrated = client.get("/api/lineage/bootstrap")
        self.assertEqual(200, migrated.status_code)
        self.assertIn("data", migrated.json())

        fallback = client.get("/api/capabilities")
        self.assertEqual(200, fallback.status_code)
        self.assertIn("edition", fallback.json())

    def test_flask_runtime_switch_is_immediate_and_health_reports_mode(self):
        runtime = self.create_runtime_app(
            runtime_mode="flask", capabilities=self.capabilities
        )
        client = TestClient(runtime)
        health = client.get("/healthz")
        self.assertEqual(200, health.status_code)
        self.assertEqual("flask", health.json()["runtime"])
        self.assertFalse(health.json()["fastapiPrimary"])
        response = client.get("/api/lineage/bootstrap")
        self.assertEqual(200, response.status_code)
        self.assertIn("data", response.json())

    def test_flask_session_identity_is_available_to_fastapi_primary(self):
        flask_application = create_app(capabilities=self.capabilities)
        fastapi_application = FastAPI()

        @fastapi_application.get("/api/system/users")
        def session_probe():
            from backend.app.auth import get_session_user

            return {"user": get_session_user()}

        runtime = self.create_runtime_app(
            runtime_mode="fastapi",
            capabilities=self.capabilities,
            flask_application=flask_application,
            fastapi_application=fastapi_application,
        )
        flask_client = flask_application.test_client()
        with flask_client.session_transaction() as session:
            session["dap_auth_user"] = {
                "role": "admin",
                "user": "tester",
                "name": "Tester",
            }
        cookie = flask_client.get_cookie("session")
        self.assertIsNotNone(cookie)
        fastapi_client = TestClient(runtime)
        fastapi_client.cookies.set("session", cookie.value)
        response = fastapi_client.get("/api/system/users")
        self.assertEqual(200, response.status_code)
        self.assertEqual("admin", response.json()["user"]["role"])

    def test_invalid_runtime_mode_fails_closed(self):
        with self.assertRaisesRegex(RuntimeError, "BACKEND_RUNTIME"):
            self.create_runtime_app(
                runtime_mode="unknown", capabilities=self.capabilities
            )


if __name__ == "__main__":
    unittest.main()
