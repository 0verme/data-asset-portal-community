import os
import unittest

from backend.app import create_app
from backend.app.settings import get_flask_debug


class FlaskSecurityConfigTestCase(unittest.TestCase):
    _CONFIG_KEYS = (
        "FLASK_DEBUG",
        "FLASK_SECRET_KEY",
        "FLASK_ENV",
        "FLASK_CORS_ORIGINS",
    )

    def setUp(self):
        self._original_env = {key: os.getenv(key) for key in self._CONFIG_KEYS}
        self.addCleanup(self._restore_env)
        for key in self._CONFIG_KEYS:
            os.environ.pop(key, None)

    def _restore_env(self):
        for key, value in self._original_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    def _create_app_with_test_secret(self):
        os.environ["FLASK_SECRET_KEY"] = "test-only-flask-security-secret"
        return create_app()

    def test_debug_defaults_to_false_and_parses_explicit_true_values(self):
        self.assertFalse(get_flask_debug())

        for value in ("false", "0", "False", "  FALSE  ", "unexpected"):
            with self.subTest(value=value):
                os.environ["FLASK_DEBUG"] = value
                self.assertFalse(get_flask_debug())

        for value in ("true", " TRUE ", "YeS", "on", "1"):
            with self.subTest(value=value):
                os.environ["FLASK_DEBUG"] = value
                self.assertTrue(get_flask_debug())

    def test_missing_or_blank_secret_key_fails_without_leaking_its_value(self):
        with self.assertRaisesRegex(RuntimeError, "FLASK_SECRET_KEY"):
            create_app()

        secret_value = "not-a-valid-secret-to-display"
        for value in ("", "   "):
            with self.subTest(value=repr(value)):
                os.environ["FLASK_SECRET_KEY"] = value
                with self.assertRaises(RuntimeError) as error:
                    create_app()
                self.assertNotIn(secret_value, str(error.exception))

    def test_valid_secret_key_is_required_and_used_by_the_application(self):
        secret_value = "test-only-provided-secret"
        os.environ["FLASK_SECRET_KEY"] = secret_value

        app = create_app()

        self.assertEqual(secret_value, app.config["SECRET_KEY"])

    def test_cookie_defaults_are_safe_and_development_mode_is_explicit(self):
        app = self._create_app_with_test_secret()

        self.assertTrue(app.config["SESSION_COOKIE_HTTPONLY"])
        self.assertEqual("Lax", app.config["SESSION_COOKIE_SAMESITE"])
        self.assertTrue(app.config["SESSION_COOKIE_SECURE"])

        os.environ["FLASK_ENV"] = "development"
        development_app = self._create_app_with_test_secret()
        self.assertFalse(development_app.config["SESSION_COOKIE_SECURE"])

        os.environ["FLASK_ENV"] = "unexpected-environment"
        safe_fallback_app = self._create_app_with_test_secret()
        self.assertTrue(safe_fallback_app.config["SESSION_COOKIE_SECURE"])

    def test_cors_uses_exact_explicit_allowlist_and_supports_preflight(self):
        allowed_origin = "https://portal.example.com"
        os.environ["FLASK_CORS_ORIGINS"] = f"  {allowed_origin}, ,https://admin.example.com  "
        app = self._create_app_with_test_secret()
        client = app.test_client()

        allowed = client.get("/api/auth/me", headers={"Origin": allowed_origin})
        self.assertEqual(allowed_origin, allowed.headers.get("Access-Control-Allow-Origin"))
        self.assertEqual("true", allowed.headers.get("Access-Control-Allow-Credentials"))
        self.assertNotEqual("*", allowed.headers.get("Access-Control-Allow-Origin"))

        preflight = client.options(
            "/api/auth/login",
            headers={
                "Origin": allowed_origin,
                "Access-Control-Request-Method": "POST",
            },
        )
        self.assertEqual(allowed_origin, preflight.headers.get("Access-Control-Allow-Origin"))
        self.assertIn("POST", preflight.headers.get("Access-Control-Allow-Methods", ""))

        for origin in ("https://evil-example.com", "https://portal.example.com.evil.test"):
            with self.subTest(origin=origin):
                denied = client.get("/api/auth/me", headers={"Origin": origin})
                self.assertIsNone(denied.headers.get("Access-Control-Allow-Origin"))
                self.assertIsNone(denied.headers.get("Access-Control-Allow-Credentials"))

    def test_cors_is_disabled_when_no_allowlist_is_configured(self):
        app = self._create_app_with_test_secret()
        response = app.test_client().get(
            "/api/auth/me", headers={"Origin": "https://portal.example.com"}
        )

        self.assertIsNone(response.headers.get("Access-Control-Allow-Origin"))
        self.assertIsNone(response.headers.get("Access-Control-Allow-Credentials"))


if __name__ == "__main__":
    unittest.main()
