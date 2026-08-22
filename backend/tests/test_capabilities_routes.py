"""Native FastAPI capability endpoint tests."""

# pyright: reportMissingImports=false

from __future__ import annotations

import os
import unittest

from backend.app.core.capabilities import resolve_capabilities
from backend.app.fastapi_app import create_fastapi_app
from fastapi.testclient import TestClient


class CapabilitiesRouteTests(unittest.TestCase):
    def setUp(self):
        self._original_env = {
            key: os.getenv(key)
            for key in (
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
        os.environ["FLASK_ENV"] = "production"
        os.environ["ASSET_MODULE_STRICT"] = "0"
        os.environ.pop("ASSET_DB_PROFILE", None)
        os.environ.pop("ASSET_DB_CONFIG_PATH", None)

    def _restore_env(self):
        for key, value in self._original_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    @staticmethod
    def _client(caps):
        app = create_fastapi_app(
            capabilities=caps,
            identity_resolver=lambda _request: None,
        )
        return TestClient(app)

    def test_capabilities_all_enabled_by_default(self):
        caps = resolve_capabilities(enabled=None, disabled=[], strict=False)
        response = self._client(caps).get("/api/capabilities")
        self.assertEqual(200, response.status_code)
        payload = response.json()
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
        response = self._client(caps).get("/api/capabilities")
        self.assertEqual(200, response.status_code)
        by_code = {m["code"]: m for m in response.json()["modules"]}
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
        response = self._client(caps).get("/api/capabilities")
        self.assertEqual(200, response.status_code)
        text = response.text
        self.assertNotIn("password", text.lower())
        self.assertNotIn("jdbc", text.lower())


if __name__ == "__main__":
    unittest.main()
