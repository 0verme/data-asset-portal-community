"""Flask/FastAPI parity tests for the P4 Lineage module migration."""
from __future__ import annotations

import os
import unittest
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from backend.app import create_app
from backend.app.core.capabilities import resolve_capabilities
from backend.app.fastapi_app import create_fastapi_app
from backend.app.services.lineage import LineageDataSourceError


class FastApiLineageMigrationTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(
            os.environ,
            {
                "FLASK_ENV": "development",
                "LINEAGE_DB_PROFILE": "",
                "FLASK_SECRET_KEY": "test-fastapi-lineage",
            },
            clear=False,
        )
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.capabilities = resolve_capabilities(edition="community")

    def apps(self, service=None, capabilities=None):
        capabilities = capabilities or self.capabilities
        flask_app = create_app(capabilities=capabilities)
        flask_app.config.update(TESTING=True)
        fastapi_app = create_fastapi_app(
            capabilities=capabilities,
            lineage_service_instance=service,
        )
        return flask_app, fastapi_app

    def test_read_endpoints_preserve_response_shape_and_status(self):
        flask_app, fastapi_app = self.apps()
        flask_client = flask_app.test_client()
        fastapi_client = TestClient(fastapi_app)
        requests = (
            ("get", "/api/lineage/bootstrap", None),
            ("get", "/api/lineage/assets?name=member", None),
            ("get", "/api/lineage/subgraph?rootId=table:dwf:DWF_MEMBER_PROFILE&depth=1&view=table", None),
            ("get", "/api/lineage/initial-view?direction=downstream&depth=1&maxNodes=100&view=table", None),
            ("get", "/api/lineage/assets?name=missing", None),
            ("get", "/api/lineage/subgraph?rootId=table:missing:UNKNOWN", None),
            ("get", "/api/lineage/subgraph?direction=sideways", None),
        )
        for method, path, body in requests:
            with self.subTest(path=path):
                flask_response = getattr(flask_client, method)(path)
                fastapi_response = getattr(fastapi_client, method)(path)
                self.assertEqual(flask_response.status_code, fastapi_response.status_code)
                self.assertEqual(flask_response.get_json(), fastapi_response.json())

    def test_service_error_mapping_matches_flask(self):
        service = MagicMock()
        service.get_bootstrap.side_effect = LineageDataSourceError("lineage unavailable")
        flask_app, fastapi_app = self.apps(service)
        with patch(
            "backend.app.routes.lineage.get_bootstrap",
            side_effect=LineageDataSourceError("lineage unavailable"),
        ):
            flask_response = flask_app.test_client().get("/api/lineage/bootstrap")
        fastapi_response = TestClient(fastapi_app).get("/api/lineage/bootstrap")
        self.assertEqual(flask_response.status_code, 503)
        self.assertEqual(flask_response.status_code, fastapi_response.status_code)
        self.assertEqual(flask_response.get_json(), fastapi_response.json())

    def test_capability_gate_keeps_lineage_disabled_in_both_adapters(self):
        capabilities = resolve_capabilities(enabled=["dwm"], edition="community")
        flask_app, fastapi_app = self.apps(capabilities=capabilities)
        self.assertEqual(
            404,
            flask_app.test_client().get("/api/lineage/bootstrap").status_code,
        )
        self.assertEqual(
            404,
            TestClient(fastapi_app).get("/api/lineage/bootstrap").status_code,
        )


if __name__ == "__main__":
    unittest.main()
