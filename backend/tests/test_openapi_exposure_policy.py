"""FastAPI OpenAPI/docs exposure policy tests."""

# pyright: reportMissingImports=false

from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from backend.app.fastapi_app import create_fastapi_app
from fastapi.testclient import TestClient


DOC_PATHS = ("/docs", "/redoc", "/openapi.json")


class OpenAPIExposurePolicyTests(unittest.TestCase):
    def app(
        self,
        *,
        app_env: str | None = None,
        legacy_env: str | None = None,
        openapi_enabled: bool | None = None,
    ):
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("APP_ENV", None)
            os.environ.pop("FLASK_ENV", None)
            if app_env is not None:
                os.environ["APP_ENV"] = app_env
            if legacy_env is not None:
                os.environ["FLASK_ENV"] = legacy_env
            return create_fastapi_app(
                identity_resolver=lambda _request: None,
                openapi_enabled=openapi_enabled,
            )

    def assert_doc_endpoints(self, app, expected_status: int):
        client = TestClient(app)
        for path in DOC_PATHS:
            with self.subTest(path=path):
                self.assertEqual(expected_status, client.get(path).status_code)

    def assert_schema_generation_available(self, app):
        schema = app.openapi()
        self.assertIn("openapi", schema)
        self.assertIn("info", schema)
        self.assertIn("paths", schema)
        self.assertIn("/api/capabilities", schema["paths"])

    def test_production_disables_all_http_docs_but_keeps_schema_generation(self):
        app = self.app(app_env="production")

        self.assert_doc_endpoints(app, 404)
        self.assert_schema_generation_available(app)

    def test_unset_environment_defaults_to_disabled(self):
        app = self.app()

        self.assert_doc_endpoints(app, 404)
        self.assert_schema_generation_available(app)

    def test_native_runtime_inherits_factory_policy(self):
        with patch.dict(
            os.environ,
            {
                "APP_ENV": "production",
                "APP_DEBUG": "false",
                "APP_SECRET_KEY": "openapi-policy-test-secret",
            },
            clear=False,
        ):
            os.environ.pop("FLASK_ENV", None)
            from backend.app.core.capabilities import resolve_capabilities
            from backend.asgi import create_native_app

            runtime = create_native_app(capabilities=resolve_capabilities())
            self.assert_doc_endpoints(runtime, 404)

    def test_development_exposes_all_fastapi_docs_endpoints(self):
        app = self.app(app_env="development")
        client = TestClient(app)

        self.assert_doc_endpoints(app, 200)
        schema_response = client.get("/openapi.json")
        self.assertEqual(200, schema_response.status_code)
        schema = schema_response.json()
        self.assertIn("openapi", schema)
        self.assertIn("info", schema)
        self.assertIn("paths", schema)

    def test_non_development_environment_remains_disabled(self):
        app = self.app(app_env="staging")

        self.assert_doc_endpoints(app, 404)
        self.assert_schema_generation_available(app)

    def test_legacy_environment_is_ignored(self):
        app = self.app(legacy_env="development")

        self.assert_doc_endpoints(app, 404)

    def test_factory_override_can_explicitly_enable_or_disable_docs(self):
        enabled_app = self.app(app_env="production", openapi_enabled=True)
        disabled_app = self.app(app_env="development", openapi_enabled=False)

        self.assert_doc_endpoints(enabled_app, 200)
        self.assert_doc_endpoints(disabled_app, 404)
        self.assert_schema_generation_available(disabled_app)


if __name__ == "__main__":
    unittest.main()
