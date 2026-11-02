"""Native common infrastructure contract tests after Flask runtime retirement."""

# pyright: reportMissingImports=false

from __future__ import annotations

import os
import unittest
from unittest.mock import MagicMock, patch

from backend.app.application import Identity
from backend.app.authorization.core import AuthorizationService
from backend.app.core.capabilities import resolve_capabilities
from backend.app.contracts.rag_search import RagRecommendationsResponse
from backend.app.fastapi_app import create_fastapi_app
from backend.app.services.search_provider import SearchDataSourceError
from fastapi.testclient import TestClient


class FastApiCommonInfrastructureTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(
            os.environ,
            {
                "APP_ENV": "development",
                "APP_SECRET_KEY": "f7-common-infrastructure-test",
            },
            clear=False,
        )
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.capabilities = resolve_capabilities()
        self.portal_service = MagicMock()
        self.search_provider = MagicMock()
        self.hot_keyword_service = MagicMock()
        self.rag_search_service = MagicMock()
        self.rag_search_service.recommend.side_effect = lambda query, profile: RagRecommendationsResponse(
            query=query,
            status="disabled",
            recommendations=[],
            count=0,
            elapsedMs=0,
            reasonCode="disabled",
        )

    def app(self):
        return create_fastapi_app(
            capabilities=self.capabilities,
            identity_resolver=lambda _request: Identity("admin", "admin", "Admin"),
            portal_service_instance=self.portal_service,
            search_provider_instance=self.search_provider,
            search_hot_keyword_service_instance=self.hot_keyword_service,
            rag_search_service_instance=self.rag_search_service,
        )

    def test_capabilities_portal_and_search_contracts(self):
        self.portal_service.get_stats.return_value = [
            {"key": "dwm", "label": "数据仓库", "value": 3}
        ]
        self.search_provider.search.return_value = {
            "query": "ORDER",
            "scope": "indicator",
            "groups": [],
            "total": 0,
        }
        client = TestClient(self.app())
        self.assertEqual(200, client.get("/api/capabilities").status_code)
        self.assertEqual(
            {"items": self.portal_service.get_stats.return_value},
            client.get("/api/portal/stats").json(),
        )
        search = client.get("/api/search?q=ORDER&type=indicator&limit=7")
        self.assertEqual(200, search.status_code)
        self.assertEqual(self.search_provider.search.return_value, search.json())
        self.search_provider.search.assert_called_once_with(
            "ORDER", scope="indicator", limit="7", profile="internal"
        )

    def test_rag_recommendations_contract_is_optional_and_disabled_by_default(self):
        client = TestClient(self.app())

        response = client.get("/api/search/recommendations?q=合同金额")

        self.assertEqual(200, response.status_code)
        self.assertEqual(
            {
                "query": "合同金额",
                "status": "disabled",
                "recommendations": [],
                "count": 0,
                "elapsedMs": 0.0,
                "reasonCode": "disabled",
            },
            response.json(),
        )
        self.assertFalse(self.search_provider.search.called)
        self.rag_search_service.recommend.assert_called_once_with("合同金额", profile="internal")
        schema = client.get("/openapi.json").json()
        operation = schema["paths"]["/api/search/recommendations"]["get"]
        self.assertIn("RagRecommendationsResponse", str(operation["responses"]))

    def test_admin_rag_configuration_routes_use_the_protected_services(self):
        system = MagicMock()
        config = {
            "enabled": False,
            "serviceUrl": "",
            "strategy": "auto",
            "topK": 5,
            "timeoutMs": 2000,
        }
        public_config = {**config, "tokenConfigured": False}
        system.get_rag_search_config.return_value = config
        system.get_rag_search_config_public.return_value = public_config
        system.update_rag_search_config.return_value = public_config
        rag = MagicMock()
        rag.diagnostics.return_value = {
            "status": "disabled",
            "reasonCode": "disabled",
            "health": "unknown",
            "ready": False,
            "tokenConfigured": False,
        }
        client = TestClient(create_fastapi_app(
            identity_resolver=lambda _request: Identity("admin", "admin", "Admin"),
            system_management_service_instance=system,
            rag_search_service_instance=rag,
            authorization_service_instance=AuthorizationService(),
        ))

        read = client.get("/api/system/rag-search-config")
        self.assertEqual(200, read.status_code)
        self.assertEqual(public_config, read.json()["data"])

        diagnostics = client.get("/api/system/rag-search-config/diagnostics")
        self.assertEqual(200, diagnostics.status_code)
        self.assertEqual("disabled", diagnostics.json()["data"]["status"])
        rag.diagnostics.assert_called_once_with(config)

        update = client.put("/api/system/rag-search-config", json=config)
        self.assertEqual(200, update.status_code)
        self.assertEqual(public_config, update.json()["data"])
        system.update_rag_search_config.assert_called_once_with(config)

    def test_hot_keyword_route_returns_only_the_public_schema_and_is_documented(self):
        self.hot_keyword_service.get_hot_keywords.return_value = [
            {
                "id": 9,
                "keyword": "负责人",
                "category": "all",
                "sortOrder": 10,
                "enabled": "Y",
                "created_at": "not public",
            }
        ]
        client = TestClient(self.app())

        response = client.get("/api/search/hot-keywords")

        self.assertEqual(
            {
                "items": [
                    {
                        "id": 9,
                        "keyword": "负责人",
                        "category": "all",
                        "sortOrder": 10,
                    }
                ]
            },
            response.json(),
        )
        schema = client.get("/openapi.json").json()
        operation = schema["paths"]["/api/search/hot-keywords"]["get"]
        response_schema = operation["responses"]["200"]["content"]["application/json"]["schema"]
        self.assertEqual(
            "#/components/schemas/SearchHotKeywordsResponse",
            response_schema["$ref"],
        )
        self.hot_keyword_service.get_hot_keywords.assert_called_once_with()

    def test_hot_keyword_data_source_error_uses_the_standard_error_envelope(self):
        from backend.app.services.search_hot_keyword_service import (
            SearchHotKeywordDataSourceError,
        )

        self.hot_keyword_service.get_hot_keywords.side_effect = SearchHotKeywordDataSourceError(
            "database unavailable"
        )

        response = TestClient(self.app()).get("/api/search/hot-keywords")

        self.assertEqual(500, response.status_code)
        self.assertEqual(
            {
                "code": "SEARCH_HOT_KEYWORD_DATA_SOURCE_ERROR",
                "message": "database unavailable",
            },
            response.json()["error"],
        )

    def test_portal_fatal_error_reports_unavailable_without_fake_zero(self):
        self.portal_service.get_stats.side_effect = RuntimeError("temporary failure")
        response = TestClient(self.app()).get("/api/portal/stats")
        self.assertEqual(503, response.status_code)
        self.assertEqual("PORTAL_STATS_UNAVAILABLE", response.json()["error"]["code"])
        self.assertNotIn("items", response.json())
        self.assertNotIn("temporary failure", response.text)
        self.portal_service.zero_stats.assert_not_called()

    def test_search_data_source_error_keeps_error_envelope(self):
        self.search_provider.search.side_effect = SearchDataSourceError("search down")
        response = TestClient(self.app()).get("/api/search?q=ORDER")
        self.assertEqual(500, response.status_code)
        self.assertEqual(
            {"code": "SEARCH_DATA_SOURCE_ERROR", "message": "search down"},
            response.json()["error"],
        )

    def test_search_partial_failure_survives_public_projection(self):
        self.search_provider.search.return_value = {
            "query": "asset", "scope": "all", "groups": [], "total": 0,
            "partial": True, "failedGroups": ["asset"],
        }
        response = TestClient(self.app()).get("/api/search?q=asset")
        self.assertEqual(200, response.status_code)
        self.assertTrue(response.json()["partial"])
        self.assertEqual(["asset"], response.json()["failedGroups"])

    def test_rag_recommendations_reject_overlong_query(self):
        response = TestClient(self.app()).get(
            "/api/search/recommendations", params={"q": "x" * 501}
        )
        self.assertEqual(422, response.status_code)

    def test_common_code_remains_wait_db_and_is_not_native_route(self):
        response = TestClient(self.app()).get("/api/common-codes/categories")
        self.assertEqual(404, response.status_code)


if __name__ == "__main__":
    unittest.main()
