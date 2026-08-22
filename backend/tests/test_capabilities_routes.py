"""Native FastAPI capability endpoint tests."""

# pyright: reportMissingImports=false

from __future__ import annotations

import unittest

from backend.app.core.capabilities import resolve_capabilities
from backend.app.core.modules import list_module_codes
from backend.app.fastapi_app import create_fastapi_app
from fastapi.testclient import TestClient


class CapabilitiesRouteTests(unittest.TestCase):
    @staticmethod
    def _client(caps):
        app = create_fastapi_app(
            capabilities=caps,
            identity_resolver=lambda _request: None,
        )
        return TestClient(app)

    def test_capabilities_are_complete_without_edition_field(self):
        response = self._client(resolve_capabilities()).get("/api/capabilities")
        self.assertEqual(200, response.status_code)
        payload = response.json()
        self.assertNotIn("edition", payload)
        enabled = {item["code"] for item in payload["modules"] if item["enabled"]}
        self.assertEqual(set(list_module_codes()), enabled)

    def test_capabilities_do_not_require_business_tables(self):
        payload = self._client(resolve_capabilities()).get("/api/capabilities").json()
        text = str(payload).lower()
        self.assertNotIn("password", text)
        self.assertNotIn("jdbc", text)


if __name__ == "__main__":
    unittest.main()
