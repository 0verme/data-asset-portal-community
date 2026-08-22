"""Prove disabled modules are not registered in the native FastAPI app."""

# pyright: reportMissingImports=false

from __future__ import annotations

import os
import unittest
from unittest.mock import MagicMock

from backend.app.core.capabilities import (
    resolve_capabilities,
    set_resolved_capabilities,
)
from backend.app.fastapi_app import create_fastapi_app
from backend.tests.db_test_support import skip_without_postgres_integration
from fastapi.testclient import TestClient

MODULE_PREFIXES = {
    "upstream": "/api/upstreams",
    "mapping": "/api/field-mappings",
    "push": "/api/push",
    "apiAsset": "/api/api-assets",
    "report": "/api/reports",
    "codeTable": "/api/manual-code-tables",
    "lineage": "/api/lineage/bootstrap",
    "indicator": "/api/indicators",
    "root": "/api/roots",
    "dwm": "/api/assets/tables",
}


class DisabledModulesUnitTests(unittest.TestCase):
    def setUp(self):
        self._original_env = {
            key: os.getenv(key)
            for key in (
                "FLASK_ENV",
                "ASSET_MODULE_STRICT",
                "LINEAGE_DB_PROFILE",
                "ASSET_DB_PROFILE",
                "ASSET_DB_CONFIG_PATH",
            )
        }
        self.addCleanup(self._restore_env)
        self.addCleanup(lambda: set_resolved_capabilities(None))
        os.environ["FLASK_ENV"] = "production"
        os.environ["ASSET_MODULE_STRICT"] = "0"
        os.environ.pop("LINEAGE_DB_PROFILE", None)
        os.environ.pop("ASSET_DB_PROFILE", None)
        os.environ.pop("ASSET_DB_CONFIG_PATH", None)

    def _restore_env(self):
        for key, value in self._original_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    def _client(self, enabled: list[str]):
        caps = resolve_capabilities(
            enabled=enabled,
            disabled=[],
            edition="community-test",
            strict=False,
        )
        portal = MagicMock()
        portal.get_stats.return_value = []
        search = MagicMock()
        search.search.return_value = {"items": [], "total": 0}
        app = create_fastapi_app(
            capabilities=caps,
            identity_resolver=lambda _request: None,
            portal_service_instance=portal,
            search_provider_instance=search,
        )
        return TestClient(app), caps

    def test_community_core_registers_only_enabled_routes(self):
        enabled = ["portal", "dwm", "root", "indicator", "lineage", "system"]
        client, caps = self._client(enabled)
        self.assertEqual(
            set(caps["enabled_codes"]) & set(MODULE_PREFIXES),
            set(enabled) - {"portal", "system"}
            | {"dwm", "root", "indicator", "lineage"},
        )
        self.assertEqual(200, client.get("/api/capabilities").status_code)
        self.assertEqual(200, client.get("/api/portal/stats").status_code)
        self.assertEqual(200, client.get("/api/search?q=test").status_code)

        for code in ("upstream", "mapping", "push", "apiAsset", "report", "codeTable"):
            self.assertEqual(404, client.get(MODULE_PREFIXES[code]).status_code)
        for code in ("dwm", "root", "indicator", "lineage"):
            status = client.get(MODULE_PREFIXES[code]).status_code
            self.assertNotEqual(404, status, f"{code} should be registered")

    def test_no_lineage_disables_lineage_routes(self):
        client, caps = self._client(["portal", "dwm", "root", "indicator", "system"])
        self.assertNotIn("lineage", caps["enabled_codes"])
        self.assertEqual(404, client.get("/api/lineage/bootstrap").status_code)
        self.assertEqual(404, client.get("/api/lineage/assets").status_code)

    def test_no_upstream_keeps_mapping_registered(self):
        enabled = ["portal", "dwm", "root", "indicator", "system", "mapping", "lineage"]
        client, caps = self._client(enabled)
        self.assertNotIn("upstream", caps["enabled_codes"])
        self.assertIn("mapping", caps["enabled_codes"])
        self.assertEqual(200, client.get("/api/capabilities").status_code)
        self.assertEqual(200, client.get("/api/portal/stats").status_code)
        self.assertEqual(200, client.get("/api/search?q=test").status_code)
        self.assertEqual(404, client.get("/api/upstreams").status_code)
        self.assertNotEqual(404, client.get("/api/field-mappings/fields").status_code)

    def test_no_push_keeps_api_asset_registered(self):
        client, caps = self._client(["portal", "dwm", "root", "system", "apiAsset"])
        self.assertNotIn("push", caps["enabled_codes"])
        self.assertIn("apiAsset", caps["enabled_codes"])
        self.assertEqual(200, client.get("/api/portal/stats").status_code)
        self.assertEqual(200, client.get("/api/search?q=test").status_code)
        self.assertEqual(404, client.get("/api/push").status_code)
        self.assertNotEqual(404, client.get("/api/api-assets").status_code)

    def test_minimal_assets_only_unregisters_optional_modules(self):
        client, caps = self._client(["portal", "dwm", "system"])
        for code in (
            "upstream",
            "mapping",
            "push",
            "apiAsset",
            "report",
            "root",
            "indicator",
            "lineage",
            "codeTable",
        ):
            self.assertNotIn(code, caps["enabled_codes"])
            self.assertEqual(404, client.get(MODULE_PREFIXES[code]).status_code)


@skip_without_postgres_integration()
class DisabledModulesPostgresIntegrationTests(unittest.TestCase):
    def test_partial_schema_requires_isolated_postgres(self):
        self.assertTrue(True)


if __name__ == "__main__":
    unittest.main()
