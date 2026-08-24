"""Native application security/session configuration tests."""

# pyright: reportMissingImports=false

from __future__ import annotations

import os
import unittest

from backend.app.settings import (
    get_int_env,
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

    def test_debug_defaults_to_false_and_parses_explicit_app_values(self):
        self.assertFalse(get_runtime_debug())
        for value in ("false", "0", "False", "  FALSE  ", "unexpected"):
            with self.subTest(value=value):
                os.environ["APP_DEBUG"] = value
                self.assertFalse(get_runtime_debug())
        for value in ("true", " TRUE ", "YeS", "on", "1"):
            with self.subTest(value=value):
                os.environ["APP_DEBUG"] = value
                self.assertTrue(get_runtime_debug())

    def test_legacy_flask_names_are_not_runtime_configuration(self):
        os.environ["FLASK_SECRET_KEY"] = "legacy-secret"
        os.environ["FLASK_ENV"] = "development"
        os.environ["FLASK_DEBUG"] = "true"
        os.environ["FLASK_CORS_ORIGINS"] = "https://legacy.example.com"
        os.environ["FLASK_MAX_CONTENT_LENGTH_MB"] = "32"

        with self.assertRaisesRegex(RuntimeError, "APP_SECRET_KEY"):
            get_session_secret()
        self.assertFalse(get_runtime_debug())
        self.assertTrue(get_session_cookie_config()["SESSION_COOKIE_SECURE"])

        os.environ["APP_SECRET_KEY"] = "native-secret"
        config = get_runtime_config()
        self.assertTrue(config["SESSION_COOKIE_SECURE"])
        self.assertEqual([], config["CORS_ORIGINS"])
        self.assertEqual(16 * 1024 * 1024, config["MAX_CONTENT_LENGTH"])

    def test_native_names_are_used_and_blank_values_use_native_defaults(self):
        os.environ["APP_SECRET_KEY"] = "native-secret"
        os.environ["APP_ENV"] = "development"
        os.environ["APP_DEBUG"] = "true"
        os.environ["APP_CORS_ORIGINS"] = (
            "  https://portal.example.com, ,https://admin.example.com  "
        )
        os.environ["APP_MAX_CONTENT_LENGTH_MB"] = "32"

        self.assertEqual("native-secret", get_session_secret())
        self.assertFalse(get_session_cookie_config()["SESSION_COOKIE_SECURE"])
        config = get_runtime_config()
        self.assertEqual(
            ["https://portal.example.com", "https://admin.example.com"],
            config["CORS_ORIGINS"],
        )
        self.assertEqual(32 * 1024 * 1024, config["MAX_CONTENT_LENGTH"])

        os.environ["APP_ENV"] = "   "
        os.environ["APP_DEBUG"] = "   "
        os.environ["APP_CORS_ORIGINS"] = "   "
        os.environ["APP_MAX_CONTENT_LENGTH_MB"] = "   "
        self.assertTrue(get_session_cookie_config()["SESSION_COOKIE_SECURE"])
        self.assertFalse(get_runtime_debug())
        self.assertEqual([], get_runtime_config()["CORS_ORIGINS"])
        self.assertEqual(16 * 1024 * 1024, get_runtime_config()["MAX_CONTENT_LENGTH"])

    def test_invalid_max_content_length_uses_safe_default(self):
        for value in ("abc", "0", "-1", "513"):
            with self.subTest(value=value):
                os.environ["APP_MAX_CONTENT_LENGTH_MB"] = value
                self.assertEqual(
                    16,
                    get_int_env(
                        "APP_MAX_CONTENT_LENGTH_MB", 16, minimum=1, maximum=512
                    ),
                )

    def test_app_debug_true_is_rejected_in_production(self):
        os.environ["APP_SECRET_KEY"] = "native-secret"
        os.environ["APP_ENV"] = "production"
        os.environ["APP_DEBUG"] = "true"
        with self.assertRaisesRegex(RuntimeError, "APP_DEBUG"):
            get_runtime_config()

    def test_missing_or_blank_secret_fails_without_leaking_value(self):
        with self.assertRaisesRegex(RuntimeError, "APP_SECRET_KEY"):
            get_session_secret()
        secret_value = "not-a-valid-secret-to-display"
        for value in ("", "   "):
            with self.subTest(value=repr(value)):
                os.environ["APP_SECRET_KEY"] = value
                with self.assertRaises(RuntimeError) as error:
                    get_session_secret()
                self.assertNotIn(secret_value, str(error.exception))

    def test_native_cookie_defaults_are_safe(self):
        os.environ["APP_SECRET_KEY"] = "native-secret"
        self.assertEqual(
            {
                "SESSION_COOKIE_HTTPONLY": True,
                "SESSION_COOKIE_SAMESITE": "Lax",
                "SESSION_COOKIE_SECURE": True,
            },
            get_session_cookie_config(),
        )
        os.environ["APP_ENV"] = "development"
        self.assertFalse(get_session_cookie_config()["SESSION_COOKIE_SECURE"])


if __name__ == "__main__":
    unittest.main()
