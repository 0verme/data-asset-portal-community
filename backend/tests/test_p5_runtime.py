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

    def test_runtime_dispatch_table_covers_all_community_migrated_prefixes(self):
        runtime = self.create_runtime_app(
            runtime_mode="fastapi", capabilities=self.capabilities
        )
        self.assertEqual(
            {
                "/api/indicators",
                "/api/assets",
                "/api/field-mappings",
                "/api/roots",
                "/api/api-assets",
                "/api/lineage",
                "/api/system",
                "/api/operation-logs",
            },
            runtime.migrated_prefixes,
        )

    def test_fastapi_error_mapping_and_cors_security_headers(self):
        runtime = self.create_runtime_app(
            runtime_mode="fastapi", capabilities=self.capabilities
        )
        client = TestClient(runtime)
        validation = client.get("/api/lineage/subgraph?direction=sideways")
        self.assertEqual(422, validation.status_code)
        self.assertEqual("LINEAGE_VALIDATION_FAILED", validation.json()["error"]["code"])
        not_found = client.get("/api/lineage/subgraph?rootId=table:missing:UNKNOWN")
        self.assertEqual(404, not_found.status_code)
        self.assertEqual("LINEAGE_NOT_FOUND", not_found.json()["error"]["code"])
        fallback_not_found = client.get("/api/not-migrated")
        self.assertEqual(404, fallback_not_found.status_code)
        self.assertEqual("NOT_FOUND", fallback_not_found.json()["error"]["code"])

        with patch.dict(os.environ, {"FLASK_CORS_ORIGINS": "https://portal.example.com"}):
            cors_runtime = self.create_runtime_app(
                runtime_mode="fastapi", capabilities=self.capabilities
            )
        preflight = TestClient(cors_runtime).options(
            "/api/lineage/bootstrap",
            headers={
                "Origin": "https://portal.example.com",
                "Access-Control-Request-Method": "GET",
            },
        )
        self.assertEqual(200, preflight.status_code)
        self.assertEqual(
            "https://portal.example.com",
            preflight.headers["access-control-allow-origin"],
        )

    def test_invalid_runtime_mode_fails_closed(self):
        with self.assertRaisesRegex(RuntimeError, "BACKEND_RUNTIME"):
            self.create_runtime_app(
                runtime_mode="unknown", capabilities=self.capabilities
            )


if __name__ == "__main__":
    unittest.main()
