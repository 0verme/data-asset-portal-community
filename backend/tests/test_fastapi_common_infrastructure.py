"""F3 parity and boundary tests for native common infrastructure routes."""

# pyright: reportMissingImports=false

from __future__ import annotations

import os
import unittest
from unittest.mock import MagicMock, patch

from backend.app import create_app
from backend.app.core.capabilities import resolve_capabilities
from backend.app.fastapi_app import create_fastapi_app
from backend.app.services.search_provider import SearchDataSourceError
from fastapi.testclient import TestClient


class FastApiCommonInfrastructureTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(
            os.environ,
            {
                "FLASK_ENV": "development",
                "FLASK_SECRET_KEY": "f3-common-infrastructure-test",
            },
            clear=False,
        )
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.capabilities = resolve_capabilities(edition="community")
        self.portal_service = MagicMock()
        self.search_provider = MagicMock()

    def apps(self):
        flask_app = create_app(capabilities=self.capabilities)
        flask_app.config.update(TESTING=True)
        fastapi_app = create_fastapi_app(
            capabilities=self.capabilities,
            identity_resolver=lambda _request: None,
            portal_service_instance=self.portal_service,
            search_provider_instance=self.search_provider,
        )
        return flask_app, fastapi_app

    def test_capabilities_portal_and_search_keep_flask_fastapi_parity(self):
        self.portal_service.get_stats.return_value = [
            {"key": "dwm", "label": "数据仓库", "value": 3}
        ]
        self.search_provider.search.return_value = {
            "query": "ORDER",
            "scope": "indicator",
            "groups": [],
            "total": 0,
        }
        with patch("backend.app.routes.portal.portal_service", self.portal_service), patch(
            "backend.app.routes.search.search_provider", self.search_provider
        ):
            flask_app, fastapi_app = self.apps()
            flask_client = flask_app.test_client()
            fastapi_client = TestClient(fastapi_app)

            pairs = (
                ("/api/capabilities", None),
                ("/api/portal/stats", None),
                ("/api/search?q=ORDER&type=indicator&limit=7", None),
            )
            for path, _body in pairs:
                with self.subTest(path=path):
                    flask_response = flask_client.get(path)
                    fastapi_response = fastapi_client.get(path)
                    self.assertEqual(flask_response.status_code, fastapi_response.status_code)
                    self.assertEqual(flask_response.get_json(), fastapi_response.json())

        self.assertEqual(2, self.search_provider.search.call_count)
        self.assertEqual(
            ("ORDER",), self.search_provider.search.call_args.args
        )
        self.assertEqual(
            {"scope": "indicator", "limit": "7"},
            self.search_provider.search.call_args.kwargs,
        )

    def test_portal_fatal_error_keeps_zero_filled_200_fallback(self):
        fallback = [{"key": "dwm", "label": "数据仓库", "value": 0}]
        self.portal_service.get_stats.side_effect = RuntimeError("temporary failure")
        self.portal_service.zero_stats.return_value = fallback
        with patch("backend.app.routes.portal.portal_service", self.portal_service):
            flask_app, fastapi_app = self.apps()
            flask_response = flask_app.test_client().get("/api/portal/stats")
            fastapi_response = TestClient(fastapi_app).get("/api/portal/stats")

        self.assertEqual(200, flask_response.status_code)
        self.assertEqual(200, fastapi_response.status_code)
        self.assertEqual(flask_response.get_json(), fastapi_response.json())

    def test_search_data_source_error_keeps_error_envelope(self):
        self.search_provider.search.side_effect = SearchDataSourceError("search down")
        with patch("backend.app.routes.search.search_provider", self.search_provider):
            flask_app, fastapi_app = self.apps()
            flask_response = flask_app.test_client().get("/api/search?q=ORDER")
            fastapi_response = TestClient(fastapi_app).get("/api/search?q=ORDER")

        self.assertEqual(500, flask_response.status_code)
        self.assertEqual(500, fastapi_response.status_code)
        self.assertEqual(flask_response.get_json(), fastapi_response.json())

    def test_common_code_remains_wait_db_and_is_not_native_route(self):
        from backend.asgi import create_runtime_app

        flask_app, fastapi_app = self.apps()
        response = TestClient(fastapi_app).get("/api/common-codes/categories")
        self.assertEqual(404, response.status_code)
        runtime = create_runtime_app(
            runtime_mode="fastapi",
            capabilities=self.capabilities,
            flask_application=flask_app,
            fastapi_application=fastapi_app,
        )
        self.assertNotIn("/api/common-codes", runtime.migrated_prefixes)


if __name__ == "__main__":
    unittest.main()
