"""F4 regression coverage for residual WAIT_DB and edition boundaries."""

# pyright: reportMissingImports=false

from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from backend.app.core.capabilities import resolve_capabilities
from backend.app.fastapi_app import create_fastapi_app
from fastapi.testclient import TestClient


class FastApiResidualBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(
            os.environ,
            {
                "FLASK_ENV": "development",
                "FLASK_SECRET_KEY": "f4-residual-boundary-test",
            },
            clear=False,
        )
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.capabilities = resolve_capabilities(edition="community")

    def test_community_residuals_are_classified_before_native_registration(self):
        self.assertTrue(self.capabilities["by_code"]["indicator"]["enabled"])
        self.assertFalse(self.capabilities["by_code"]["push"]["enabled"])
        self.assertFalse(self.capabilities["by_code"]["codeTable"]["enabled"])

        fastapi_app = create_fastapi_app(
            capabilities=self.capabilities,
            identity_resolver=lambda _request: None,
        )
        native_paths = {route.path for route in fastapi_app.routes}
        self.assertNotIn("/api/indicator-path/tree", native_paths)
        self.assertNotIn("/api/common-codes/categories", native_paths)
        self.assertNotIn("/api/push/systems", native_paths)

    def test_runtime_keeps_wait_db_and_private_residuals_out_of_fastapi(self):
        from backend.asgi import create_native_app

        fastapi_app = create_fastapi_app(
            capabilities=self.capabilities,
            identity_resolver=lambda _request: None,
        )
        runtime = create_native_app(
            capabilities=self.capabilities,
            fastapi_application=fastapi_app,
        )

        for path in (
            "/api/indicator-path/tree",
            "/api/common-codes/categories",
            "/api/push/systems",
        ):
            with self.subTest(path=path):
                self.assertEqual(404, TestClient(runtime).get(path).status_code)


if __name__ == "__main__":
    unittest.main()
