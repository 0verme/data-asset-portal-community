"""Regression coverage for the native route surface after boundary cleanup."""

# pyright: reportMissingImports=false

from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from backend.app.core.capabilities import resolve_capabilities
from backend.app.fastapi_app import create_fastapi_app


class FastApiRepositoryBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(
            os.environ,
            {
                "APP_ENV": "development",
                "APP_SECRET_KEY": "native-boundary-test",
            },
            clear=False,
        )
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.capabilities = resolve_capabilities()

    def test_all_repository_modules_are_available_before_external_readiness(self):
        app = create_fastapi_app(
            capabilities=self.capabilities,
            identity_resolver=lambda _request: None,
        )
        paths = set(app.openapi()["paths"])
        for path in (
            "/api/upstreams/systems",
            "/api/push/systems",
            "/api/reports",
            "/api/manual-code-tables",
            "/api/lineage/bootstrap",
        ):
            self.assertIn(path, paths)

    def test_indicator_path_route_is_migrated_without_restoring_common_codes(self):
        app = create_fastapi_app(
            capabilities=self.capabilities,
            identity_resolver=lambda _request: None,
        )
        paths = set(app.openapi()["paths"])
        self.assertIn("/api/indicator-path/tree", paths)
        self.assertNotIn("/api/common-codes/categories", paths)


if __name__ == "__main__":
    unittest.main()
