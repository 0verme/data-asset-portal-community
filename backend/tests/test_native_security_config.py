"""Native security/session configuration tests after Flask runtime retirement."""

# pyright: reportMissingImports=false

from __future__ import annotations

import os
import unittest

from backend.app.settings import (
    get_int_env_from_compatible,
    get_runtime_config,
    get_runtime_debug,
    get_session_cookie_config,
    get_session_secret,
)


class NativeSecurityConfigTests(unittest.TestCase):
    _CONFIG_KEYS = (
        "APP_DEBUG",
        "APP_SECRET_KEY",
        "APP_ENV",
        "APP_CORS_ORIGINS",
        "APP_MAX_CONTENT_LENGTH_MB",
        "FLASK_DEBUG",
        "FLASK_SECRET_KEY",
        "FLASK_ENV",
        "FLASK_CORS_ORIGINS",
        "FLASK_MAX_CONTENT_LENGTH_MB",
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

    def test_debug_defaults_to_false_and_parses_explicit_true_values(self):
        self.assertFalse(get_runtime_debug())
        for value in ("false", "0", "False", "  FALSE  ", "unexpected"):
            with self.subTest(value=value):
                os.environ["FLASK_DEBUG"] = value
                self.assertFalse(get_runtime_debug())
        for value in ("true", " TRUE ", "YeS", "on", "1"):
            with self.subTest(value=value):
                os.environ["FLASK_DEBUG"] = value
                self.assertTrue(get_runtime_debug())

    def test_app_names_prefer_legacy_names_and_legacy_fallback_works(self):
        os.environ["FLASK_SECRET_KEY"] = "legacy-secret"
        self.assertEqual("legacy-secret", get_session_secret())
        os.environ["APP_SECRET_KEY"] = "preferred-secret"
        self.assertEqual("preferred-secret", get_session_secret())
        os.environ["FLASK_ENV"] = "development"
        os.environ["APP_ENV"] = "production"
        self.assertTrue(get_session_cookie_config()["SESSION_COOKIE_SECURE"])

    def test_blank_app_values_fall_back_to_legacy(self):
        os.environ["APP_SECRET_KEY"] = ""
        os.environ["FLASK_SECRET_KEY"] = "legacy-secret"
        self.assertEqual("legacy-secret", get_session_secret())
        os.environ["APP_ENV"] = "   "
        os.environ["FLASK_ENV"] = "development"
        self.assertFalse(get_session_cookie_config()["SESSION_COOKIE_SECURE"])
        os.environ["APP_DEBUG"] = ""
        os.environ["FLASK_DEBUG"] = "true"
        self.assertTrue(get_runtime_debug())
        os.environ["APP_CORS_ORIGINS"] = ""
        os.environ["FLASK_CORS_ORIGINS"] = "https://legacy.example.com"
        self.assertEqual(
            ["https://legacy.example.com"],
            get_runtime_config()["CORS_ORIGINS"],
        )

    def test_max_content_length_precedence_and_invalid_bounds(self):
        self.assertEqual(
            16,
            get_int_env_from_compatible(
                "APP_MAX_CONTENT_LENGTH_MB", "FLASK_MAX_CONTENT_LENGTH_MB", 16, minimum=1, maximum=512
            ),
        )
        os.environ["FLASK_MAX_CONTENT_LENGTH_MB"] = "32"
        self.assertEqual(
            32,
            get_int_env_from_compatible(
                "APP_MAX_CONTENT_LENGTH_MB", "FLASK_MAX_CONTENT_LENGTH_MB", 16, minimum=1, maximum=512
            ),
        )
        os.environ["APP_MAX_CONTENT_LENGTH_MB"] = "64"
        self.assertEqual(
            64,
            get_int_env_from_compatible(
                "APP_MAX_CONTENT_LENGTH_MB", "FLASK_MAX_CONTENT_LENGTH_MB", 16, minimum=1, maximum=512
            ),
        )
        # Invalid APP wins the name selection, then falls back to the default (not legacy).
        os.environ["APP_MAX_CONTENT_LENGTH_MB"] = "abc"
        self.assertEqual(
            16,
            get_int_env_from_compatible(
                "APP_MAX_CONTENT_LENGTH_MB", "FLASK_MAX_CONTENT_LENGTH_MB", 16, minimum=1, maximum=512
            ),
        )
        for invalid in ("0", "-1", "513"):
            with self.subTest(value=invalid):
                os.environ["APP_MAX_CONTENT_LENGTH_MB"] = invalid
                self.assertEqual(
                    16,
                    get_int_env_from_compatible(
                        "APP_MAX_CONTENT_LENGTH_MB",
                        "FLASK_MAX_CONTENT_LENGTH_MB",
                        16,
                        minimum=1,
                        maximum=512,
                    ),
                )
        # Whitespace-only APP is treated as absent and falls back to legacy.
        os.environ["APP_MAX_CONTENT_LENGTH_MB"] = " "
        self.assertEqual(
            32,
            get_int_env_from_compatible(
                "APP_MAX_CONTENT_LENGTH_MB", "FLASK_MAX_CONTENT_LENGTH_MB", 16, minimum=1, maximum=512
            ),
        )

    def test_app_debug_false_wins_over_legacy_true_in_production(self):
        os.environ["APP_SECRET_KEY"] = "test-only-provided-secret"
        os.environ["APP_ENV"] = "production"
        os.environ["APP_DEBUG"] = "false"
        os.environ["FLASK_DEBUG"] = "true"
        self.assertFalse(get_runtime_debug())
        config = get_runtime_config()
        self.assertTrue(config["SESSION_COOKIE_SECURE"])

    def test_missing_or_blank_secret_fails_without_leaking_value(self):
        with self.assertRaisesRegex(RuntimeError, "APP_SECRET_KEY"):
            get_session_secret()
        secret_value = "not-a-valid-secret-to-display"
        for value in ("", "   "):
            with self.subTest(value=repr(value)):
                os.environ["FLASK_SECRET_KEY"] = value
                with self.assertRaises(RuntimeError) as error:
                    get_session_secret()
                self.assertNotIn(secret_value, str(error.exception))

    def test_native_cookie_defaults_are_safe(self):
        os.environ["FLASK_SECRET_KEY"] = "test-only-provided-secret"
        self.assertEqual("test-only-provided-secret", get_session_secret())
        self.assertEqual(
            {
                "SESSION_COOKIE_HTTPONLY": True,
                "SESSION_COOKIE_SAMESITE": "Lax",
                "SESSION_COOKIE_SECURE": True,
            },
            get_session_cookie_config(),
        )
        os.environ["FLASK_ENV"] = "development"
        self.assertFalse(get_session_cookie_config()["SESSION_COOKIE_SECURE"])

    def test_cors_and_security_headers_are_runtime_configured(self):
        os.environ["FLASK_SECRET_KEY"] = "test-only-provided-secret"
        os.environ["FLASK_CORS_ORIGINS"] = (
            "  https://portal.example.com, ,https://admin.example.com  "
        )
        config = get_runtime_config()
        self.assertEqual(
            ["https://portal.example.com", "https://admin.example.com"],
            config["CORS_ORIGINS"],
        )
        self.assertEqual(
            "nosniff", config["SECURITY_HEADERS"]["X-Content-Type-Options"]
        )
        self.assertEqual("SAMEORIGIN", config["SECURITY_HEADERS"]["X-Frame-Options"])


if __name__ == "__main__":
    unittest.main()
