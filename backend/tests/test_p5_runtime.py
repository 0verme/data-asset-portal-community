"""Native FastAPI production runtime tests."""

# pyright: reportMissingImports=false

from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from backend.app.application import Identity, current_request_context
from backend.app.core.capabilities import resolve_capabilities
from backend.app.fastapi_app import create_fastapi_app
from fastapi.testclient import TestClient


class NativeFastApiRuntimeTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(
            os.environ,
            {
                "APP_ENV": "development",
                "APP_SECRET_KEY": "test-native-runtime",
                "LINEAGE_DB_PROFILE": "",
            },
            clear=False,
        )
        self.environment.start()
        self.addCleanup(self.environment.stop)
        from backend.asgi import create_native_app

        self.create_native_app = create_native_app
        self.capabilities = resolve_capabilities()

    def test_native_runtime_serves_health_and_repository_routes(self):
        runtime = self.create_native_app(capabilities=self.capabilities)
        client = TestClient(runtime)
        health = client.get("/healthz")
        self.assertEqual(200, health.status_code)
        self.assertEqual(
            {
                "status": "ok",
                "runtime": "fastapi",
                "fastapiPrimary": True,
            },
            health.json(),
        )
        self.assertEqual("nosniff", health.headers["X-Content-Type-Options"])

        migrated = client.get("/api/lineage/bootstrap")
        self.assertEqual(401, migrated.status_code)
        self.assertEqual("UNAUTHORIZED", migrated.json()["error"]["code"])
        capabilities = client.get("/api/capabilities")
        self.assertEqual(200, capabilities.status_code)
        self.assertNotIn("edition", capabilities.json())
        self.assertEqual(404, client.get("/api/common-codes/categories").status_code)

    def test_native_request_context_is_neutral(self):
        app = create_fastapi_app(
            capabilities=self.capabilities,
            identity_resolver=lambda _request: None,
        )

        @app.get("/__runtime-context-probe")
        def probe():
            context = current_request_context()
            return {
                "method": context.method if context else None,
                "path": context.path if context else None,
            }

        response = TestClient(app).get("/__runtime-context-probe")
        self.assertEqual(
            {"method": "GET", "path": "/__runtime-context-probe"},
            response.json(),
        )

    def test_native_runtime_route_surface_has_no_wait_db_or_private_paths(self):
        app = create_fastapi_app(
            capabilities=self.capabilities,
            identity_resolver=lambda _request: None,
        )
        paths = {route.path for route in app.routes}
        self.assertTrue(
            {
                "/api/auth/login",
                "/api/auth/me",
                "/api/auth/logout",
                "/api/capabilities",
                "/api/portal/stats",
                "/api/search",
                "/api/indicators",
                "/api/assets/tables",
            }.issubset(paths)
        )
        self.assertNotIn("/api/indicator-path/tree", paths)
        self.assertNotIn("/api/common-codes/categories", paths)
        self.assertIn("/api/push/systems", paths)

    def test_native_error_mapping_and_cors_security_headers(self):
        authenticated_application = create_fastapi_app(
            capabilities=self.capabilities,
            identity_resolver=lambda _request: Identity("admin", "admin", "Admin"),
        )
        runtime = self.create_native_app(
            capabilities=self.capabilities,
            fastapi_application=authenticated_application,
        )
        client = TestClient(runtime)
        validation = client.get("/api/lineage/subgraph?direction=sideways")
        self.assertEqual(422, validation.status_code)
        self.assertEqual("LINEAGE_VALIDATION_FAILED", validation.json()["error"]["code"])
        not_found = client.get("/api/lineage/subgraph?rootId=table:missing:UNKNOWN")
        self.assertEqual(404, not_found.status_code)
        self.assertEqual("LINEAGE_NOT_FOUND", not_found.json()["error"]["code"])
        unknown = client.get("/api/not-migrated")
        self.assertEqual(404, unknown.status_code)
        self.assertEqual("NOT_FOUND", unknown.json()["error"]["code"])

        with patch.dict(os.environ, {"APP_CORS_ORIGINS": "https://portal.example.com"}):
            cors_application = create_fastapi_app(
                capabilities=self.capabilities,
                identity_resolver=lambda _request: Identity("admin", "admin", "Admin"),
            )
            cors_runtime = self.create_native_app(
                capabilities=self.capabilities,
                fastapi_application=cors_application,
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

    def test_legacy_runtime_switch_and_dispatcher_are_gone(self):
        import backend.asgi as asgi

        self.assertFalse(hasattr(asgi, "RuntimeDispatcher"))
        self.assertFalse(hasattr(asgi, "FlaskRequestContextMiddleware"))
        self.assertFalse(hasattr(asgi, "create_runtime_app"))
        self.assertNotIn("BACKEND_RUNTIME", vars(asgi))


if __name__ == "__main__":
    unittest.main()
