"""Native FastAPI security and production-hardening regression tests."""

# pyright: reportMissingImports=false

from __future__ import annotations

import os
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.app.application import (
    RequestContext,
    request_context_scope,
    resolve_client_address,
)
from backend.app.core.capabilities import resolve_capabilities
from backend.app.services.auth_service import AuthError, auth_service
from backend.app.services.indicator_service import IndicatorService
from backend.app.services.operation_log_service import OperationLogService
from backend.app.settings import (
    get_runtime_config,
    get_runtime_debug,
    get_trust_proxy_headers,
)
from fastapi.testclient import TestClient

BACKEND = Path(__file__).resolve().parents[1]
REQUIREMENTS = BACKEND / "requirements.txt"


class NativeSecurityTestCase(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(
            os.environ,
            {
                "FLASK_ENV": "development",
                "FLASK_SECRET_KEY": "p0-native-security-test-secret",
            },
            clear=False,
        )
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.capabilities = resolve_capabilities(edition="community")

    def app(self):
        from backend.asgi import create_native_app

        return create_native_app(capabilities=self.capabilities)


class ProductionConfigTests(NativeSecurityTestCase):
    def test_production_rejects_debug_true(self):
        with (
            patch.dict(
                os.environ,
                {"FLASK_ENV": "production", "FLASK_DEBUG": "true"},
            ),
            self.assertRaisesRegex(RuntimeError, "FLASK_DEBUG"),
        ):
            get_runtime_config()

    def test_development_allows_debug_true(self):
        with patch.dict(
            os.environ,
            {"FLASK_ENV": "development", "FLASK_DEBUG": "true"},
        ):
            self.assertTrue(get_runtime_debug())
            self.assertFalse(get_runtime_config()["SESSION_COOKIE_SECURE"])


class RequestBoundaryAndErrorShapeTests(NativeSecurityTestCase):
    def test_oversized_body_returns_uniform_json_413(self):
        with patch.dict(os.environ, {"FLASK_MAX_CONTENT_LENGTH_MB": "1"}):
            response = TestClient(self.app()).post(
                "/api/auth/login",
                content=b"x" * (1024 * 1024 + 1),
                headers={"Content-Type": "application/json"},
            )
        self.assertEqual(413, response.status_code)
        self.assertEqual("HTTP_413", response.json()["error"]["code"])
        self.assertEqual("请求体过大", response.json()["error"]["message"])

    def test_method_not_allowed_returns_uniform_json(self):
        response = TestClient(self.app()).post("/api/auth/me")
        self.assertEqual(405, response.status_code)
        self.assertEqual("HTTP_405", response.json()["error"]["code"])

    def test_error_shape_matches_404_convention(self):
        response = TestClient(self.app()).get("/api/auth/not-found")
        self.assertEqual(404, response.status_code)
        self.assertEqual("NOT_FOUND", response.json()["error"]["code"])


class SecurityHeaderTests(NativeSecurityTestCase):
    def test_security_headers_on_responses(self):
        response = TestClient(self.app()).get("/api/auth/me")
        self.assertEqual("nosniff", response.headers.get("X-Content-Type-Options"))
        self.assertEqual("SAMEORIGIN", response.headers.get("X-Frame-Options"))
        self.assertEqual(
            "strict-origin-when-cross-origin",
            response.headers.get("Referrer-Policy"),
        )


class ProxyTrustBoundaryTests(NativeSecurityTestCase):
    def test_proxy_headers_not_trusted_by_default(self):
        self.assertFalse(get_trust_proxy_headers())
        self.assertEqual(
            "198.51.100.7",
            resolve_client_address(
                "198.51.100.7",
                {"X-Forwarded-For": "203.0.113.66"},
                trust_proxy_headers=False,
            ),
        )

    def test_proxy_headers_use_xff_when_trust_configured(self):
        with patch.dict(os.environ, {"ASSET_TRUST_PROXY_HEADERS": "true"}):
            self.assertTrue(get_trust_proxy_headers())
            self.assertEqual(
                "203.0.113.66",
                resolve_client_address(
                    "127.0.0.1",
                    {"X-Forwarded-For": "203.0.113.66, 198.51.100.1"},
                    trust_proxy_headers=True,
                ),
            )

    def test_operation_log_reads_native_proxy_context(self):
        service = OperationLogService()
        context = RequestContext(
            method="GET",
            path="/api/healthz",
            client_address="198.51.100.7",
            user_agent="native-security-test",
            elapsed_time_ms=2,
        )
        with request_context_scope(context):
            self.assertEqual("198.51.100.7", service._request_context()["ipAddress"])


class ErrorSanitizationTests(unittest.TestCase):
    _SENSITIVE = "[internal] /opt/data-asset-portal secret: password=topsecret host=198.51.100.66"

    def test_data_source_error_does_not_leak_internal_details(self):
        def _boom(profile, sql, params=None):
            raise RuntimeError(self._SENSITIVE)

        service = IndicatorService()
        message = ""
        with patch.object(service._db, "fetch_rows", side_effect=_boom):
            try:
                service._fetch_rows(object())
            except Exception as error:
                message = str(error)
            else:
                self.fail("expected a sanitized data-source error")
        self.assertNotIn("topsecret", message)
        self.assertNotIn("198.51.100.66", message)
        self.assertNotIn("/opt/data-asset-portal", message)

    def test_auth_data_source_error_is_sanitized(self):
        def _boom(profile, sql):
            raise RuntimeError("connect failed host=198.51.100.66 password=topsecret")

        with (
            patch(
                "backend.app.services.auth_service.load_db_profiles",
                return_value={"primary": {"type": "postgres"}},
            ),
            patch("backend.app.services.auth_service.fetch_all", side_effect=_boom),
            self.assertRaises(AuthError) as ctx,
        ):
            auth_service.authenticate("admin", "wrong")
        message = str(ctx.exception)
        self.assertNotIn("topsecret", message)
        self.assertNotIn("198.51.100.66", message)


class DependencySecurityVersionTests(unittest.TestCase):
    def _parse_requirements(self):
        result = {}
        for line in REQUIREMENTS.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "==" not in line:
                continue
            name, version = line.split("==", 1)
            result[name.lower()] = version.strip()
        return result

    def test_legacy_runtime_dependencies_are_removed(self):
        dependencies = self._parse_requirements()
        self.assertNotIn("flask", dependencies)
        self.assertNotIn("flask-cors", dependencies)

    def test_werkzeug_is_retained_for_password_hashing(self):
        version = self._parse_requirements().get("werkzeug")
        if version is None:
            self.fail("Werkzeug is required by AuthService password hashing")
        try:
            version_parts = [int(part) for part in version.split(".")][:3]
        except ValueError:
            self.fail("Werkzeug version must be numeric")
        self.assertGreaterEqual(version_parts, [3, 1, 8])


if __name__ == "__main__":
    unittest.main()
