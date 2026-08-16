import os
import unittest
from unittest.mock import patch

from backend.app import create_app
from backend.app.core.capabilities import resolve_capabilities, set_resolved_capabilities


class CapabilitiesRouteTests(unittest.TestCase):
    def setUp(self):
        self._original_env = {
            key: os.getenv(key)
            for key in (
                "FLASK_SECRET_KEY",
                "FLASK_ENV",
                "ASSET_MODULE_STRICT",
                "ASSET_ENABLED_MODULES",
                "ASSET_DISABLED_MODULES",
                "ASSET_EDITION",
                "ASSET_DB_PROFILE",
                "ASSET_DB_CONFIG_PATH",
            )
        }
        self.addCleanup(self._restore_env)
        self.addCleanup(lambda: set_resolved_capabilities(None))
        os.environ["FLASK_SECRET_KEY"] = "test-only-capabilities-secret"
        os.environ["FLASK_ENV"] = "production"
        os.environ["ASSET_MODULE_STRICT"] = "0"
        # Capabilities endpoint must not require a real database connection.
        os.environ.pop("ASSET_DB_PROFILE", None)
        os.environ.pop("ASSET_DB_CONFIG_PATH", None)

    def _restore_env(self):
        for key, value in self._original_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    def test_capabilities_all_enabled_by_default(self):
        caps = resolve_capabilities(enabled=None, disabled=[], strict=False)
        app = create_app(capabilities=caps)
        response = app.test_client().get("/api/capabilities")
        self.assertEqual(200, response.status_code)
        payload = response.get_json()
        self.assertEqual("private", payload["edition"])
        enabled = {m["code"] for m in payload["modules"] if m["enabled"]}
        self.assertIn("dwm", enabled)
        self.assertIn("push", enabled)
        self.assertIn("mapping", enabled)
        self.assertTrue(all(m["enabled"] for m in payload["modules"]))

    def test_capabilities_reflect_disabled_and_auto_depends(self):
        caps = resolve_capabilities(
            enabled=None,
            disabled=["upstream", "push"],
            edition="community-test",
            strict=False,
        )
        app = create_app(capabilities=caps)
        response = app.test_client().get("/api/capabilities")
        self.assertEqual(200, response.status_code)
        payload = response.get_json()
        by_code = {m["code"]: m for m in payload["modules"]}
        self.assertFalse(by_code["upstream"]["enabled"])
        self.assertTrue(by_code["mapping"]["enabled"])
        self.assertIsNone(by_code["mapping"]["reason"])
        self.assertFalse(by_code["push"]["enabled"])
        self.assertTrue(by_code["apiAsset"]["enabled"])
        self.assertIsNone(by_code["apiAsset"]["reason"])

    def test_capabilities_needs_no_business_tables(self):
        caps = resolve_capabilities(
            enabled=["portal", "dwm", "system"],
            disabled=[],
            strict=False,
        )
        app = create_app(capabilities=caps)
        response = app.test_client().get("/api/capabilities")
        self.assertEqual(200, response.status_code)
        text = response.get_data(as_text=True)
        self.assertNotIn("password", text.lower())
        self.assertNotIn("jdbc", text.lower())


if __name__ == "__main__":
    unittest.main()
