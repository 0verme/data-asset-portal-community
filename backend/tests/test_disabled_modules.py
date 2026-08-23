"""Positive contract: every repository module is registered by default."""

# pyright: reportMissingImports=false

from __future__ import annotations

import unittest
from unittest.mock import MagicMock

from backend.app.core.capabilities import resolve_capabilities
from backend.app.fastapi_app import create_fastapi_app
from backend.app.core.modules import list_module_codes

MODULE_PREFIXES = {
    "upstream": "/api/upstreams",
    "mapping": "/api/field-mappings",
    "push": "/api/push",
    "apiAsset": "/api/api-assets",
    "report": "/api/reports",
    "codeTable": "/api/manual-code-tables",
    "lineage": "/api/lineage",
    "indicator": "/api/indicators",
    "root": "/api/roots",
    "dwm": "/api/assets",
    "system": "/api/system",
}


class OpenRepositoryModuleTests(unittest.TestCase):
    def test_default_capability_map_contains_every_module(self):
        capabilities = resolve_capabilities()
        self.assertEqual(set(list_module_codes()), set(capabilities["enabled_codes"]))

    def test_default_fastapi_composition_registers_every_module_router(self):
        portal = MagicMock()
        search = MagicMock()
        app = create_fastapi_app(
            capabilities=resolve_capabilities(),
            identity_resolver=lambda _request: None,
            portal_service_instance=portal,
            search_provider_instance=search,
        )
        paths = {route.path for route in app.routes}
        for code, prefix in MODULE_PREFIXES.items():
            with self.subTest(code=code):
                self.assertTrue(
                    any(path == prefix or path.startswith(prefix + "/") for path in paths),
                    f"{code} router should be registered",
                )

    def test_capability_state_cannot_unregister_repository_module_routers(self):
        app = create_fastapi_app(
            capabilities={"modules": [], "enabled_codes": []},
            identity_resolver=lambda _request: None,
            portal_service_instance=MagicMock(),
            search_provider_instance=MagicMock(),
        )
        paths = {route.path for route in app.routes}
        for code, prefix in MODULE_PREFIXES.items():
            with self.subTest(code=code):
                self.assertTrue(
                    any(path == prefix or path.startswith(prefix + "/") for path in paths),
                    f"{code} router should not depend on capability state",
                )


if __name__ == "__main__":
    unittest.main()
