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
                "FLASK_ENV": "development",
                "FLASK_SECRET_KEY": "native-boundary-test",
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
        paths = {route.path for route in app.routes}
        for path in (
            "/api/upstreams/systems",
            "/api/push/systems",
            "/api/reports",
            "/api/manual-code-tables",
            "/api/lineage/bootstrap",
        ):
            self.assertIn(path, paths)

    def test_unrelated_wait_db_routes_remain_unregistered(self):
        app = create_fastapi_app(
            capabilities=self.capabilities,
            identity_resolver=lambda _request: None,
        )
        paths = {route.path for route in app.routes}
        self.assertNotIn("/api/indicator-path/tree", paths)
        self.assertNotIn("/api/common-codes/categories", paths)


if __name__ == "__main__":
    unittest.main()
