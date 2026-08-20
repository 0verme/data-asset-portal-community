# Copyright 2025 Jearhe
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""P0 security / production hardening regression tests (Issue #16).

Verifies behaviour, not implementation:
  * production configuration fail-fast (debug must stay off)
  * request-body ceiling -> uniform JSON 413
  * uniform JSON shape for framework HTTP errors (405 etc.)
  * security response headers
  * proxy / forwarded-header trust boundary (default: ignored)
  * data-source error sanitization (no internal paths / credentials leaked)
  * dependency security-version floor (Flask / Werkzeug / Flask-Cors)
"""

from __future__ import annotations

import io
import os
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.app import create_app
from backend.app.settings import get_trust_proxy_headers
from backend.app.services.indicator_service import IndicatorService

# pyright: reportMissingImports=false

BACKEND = Path(__file__).resolve().parents[1]
REQUIREMENTS = BACKEND / "requirements.txt"

_SECRET = "p0-security-hardening-test-secret"


def _make_app(extra_env: dict | None = None):
    env = {"FLASK_SECRET_KEY": _SECRET}
    env.update(extra_env or {})
    with patch.dict(os.environ, env):
        return create_app()


class ProductionConfigFailFastTests(unittest.TestCase):
    def test_production_rejects_debug_true(self):
        with self.assertRaises(RuntimeError) as ctx:
            _make_app({"FLASK_ENV": "production", "FLASK_DEBUG": "true"})
        self.assertIn("FLASK_DEBUG", str(ctx.exception))

    def test_development_allows_debug_true(self):
        app = _make_app({"FLASK_ENV": "development", "FLASK_DEBUG": "true"})
        self.assertTrue(app.config["SECRET_KEY"])

    def test_production_with_debug_false_starts(self):
        app = _make_app({"FLASK_ENV": "production", "FLASK_DEBUG": "false"})
        self.assertTrue(app.config["SESSION_COOKIE_SECURE"])


class RequestBoundaryAndErrorShapeTests(unittest.TestCase):
    def test_oversized_body_returns_uniform_json_413(self):
        app = _make_app()
        client = app.test_client()
        big = io.BytesIO(b"x" * (app.config["MAX_CONTENT_LENGTH"] + 1024))
        response = client.post(
            "/api/auth/login",
            data=big,
            content_type="application/json",
            headers={"Content-Type": "application/json"},
        )
        self.assertEqual(413, response.status_code)
        body = response.get_json()
        self.assertIn("error", body)
        self.assertEqual("HTTP_413", body["error"]["code"])
        self.assertEqual("请求体过大", body["error"]["message"])

    def test_method_not_allowed_returns_uniform_json(self):
        app = _make_app()
        response = app.test_client().post("/api/auth/me")  # GET-only route
        self.assertEqual(405, response.status_code)
        body = response.get_json()
        self.assertIn("error", body)
        self.assertEqual("HTTP_405", body["error"]["code"])

    def test_error_shape_matches_404_convention(self):
        app = _make_app()
        body = app.test_client().get("/api/auth/me").get_json()
        self.assertIn("error", body)
        self.assertIn("code", body["error"])
        self.assertIn("message", body["error"])


class SecurityHeaderTests(unittest.TestCase):
    def test_security_headers_on_responses(self):
        app = _make_app()
        response = app.test_client().get("/api/auth/me")
        self.assertEqual("nosniff", response.headers.get("X-Content-Type-Options"))
        self.assertEqual("SAMEORIGIN", response.headers.get("X-Frame-Options"))
        self.assertEqual(
            "strict-origin-when-cross-origin", response.headers.get("Referrer-Policy")
        )


class ProxyTrustBoundaryTests(unittest.TestCase):
    def test_proxy_headers_not_trusted_by_default(self):
        self.assertFalse(get_trust_proxy_headers())

    def test_proxy_headers_opt_in(self):
        with patch.dict(os.environ, {"ASSET_TRUST_PROXY_HEADERS": "true"}):
            self.assertTrue(get_trust_proxy_headers())

    def test_audit_ip_ignores_forged_xff_by_default(self):
        from backend.app.services.operation_log_service import operation_log_service

        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("ASSET_TRUST_PROXY_HEADERS", None)
            from flask import Flask
            app = Flask(__name__)
            app.secret_key = _SECRET
            with app.test_request_context(
                "/api/x",
                headers={"X-Forwarded-For": "203.0.113.66", "User-Agent": "ua"},
                environ_base={"REMOTE_ADDR": "198.51.100.7"},
            ):
                ip = operation_log_service._request_context()["ipAddress"]
                self.assertEqual("198.51.100.7", ip)

    def test_audit_ip_uses_xff_when_trust_configured(self):
        from backend.app.services.operation_log_service import operation_log_service

        with patch.dict(os.environ, {"ASSET_TRUST_PROXY_HEADERS": "true"}):
            from flask import Flask
            app = Flask(__name__)
            app.secret_key = _SECRET
            with app.test_request_context(
                "/api/x",
                headers={"X-Forwarded-For": "203.0.113.66, 198.51.100.1", "User-Agent": "ua"},
                environ_base={"REMOTE_ADDR": "127.0.0.1"},
            ):
                ip = operation_log_service._request_context()["ipAddress"]
                self.assertEqual("203.0.113.66", ip)


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
        from backend.app.services.auth_service import AuthError, auth_service

        def _boom(profile, sql):
            raise RuntimeError("connect failed host=198.51.100.66 password=topsecret")

        with patch("backend.app.services.auth_service.load_db_profiles", return_value={"primary": {"type": "postgres"}}), \
                patch("backend.app.services.auth_service.fetch_all", side_effect=_boom), \
                self.assertRaises(AuthError) as ctx:
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

    def test_flask_is_at_or_above_security_floor(self):
        version = self._parse_requirements()["flask"]
        parts = [int(p) for p in version.split(".")]
        self.assertGreaterEqual(parts[:3], [3, 1, 3])

    @staticmethod
    def _version_parts(version):
        return [int(part) for part in (version or "").split(".")]

    def test_werkzeug_is_pinned_at_security_floor(self):
        version = self._parse_requirements().get("werkzeug")
        self.assertIsNotNone(version, "Werkzeug must be explicitly pinned")
        parts = self._version_parts(version)
        self.assertGreaterEqual(parts[:3], [3, 1, 8])

    def test_flask_cors_is_at_or_above_security_floor(self):
        version = self._parse_requirements()["flask-cors"]
        parts = [int(p) for p in version.split(".")]
        self.assertGreaterEqual(parts[:3], [6, 0, 0])


if __name__ == "__main__":
    unittest.main()
