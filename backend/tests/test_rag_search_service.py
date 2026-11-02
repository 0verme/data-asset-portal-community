from __future__ import annotations

import json
import unittest
from unittest.mock import MagicMock

import httpx

from backend.app.contracts.rag_search import DEFAULT_RAG_SEARCH_CONFIG
from backend.app.services.rag_search_http_client import RagSearchHttpClient
from backend.app.services.rag_search_service import RagSearchService


class RagSearchServiceTests(unittest.TestCase):
    def setUp(self):
        self.catalog = [{
            "assetId": 1,
            "name": "CUSTOMER",
            "cn": "客户",
            "desc": "客户主表公开说明",
            "domain": "客户域",
            "layer": "DWM",
            "owner": "private owner",
            "host": "private locator",
            "fields": [{
                "assetId": 1,
                "fieldId": 10,
                "name": "CUSTOMER_ID",
                "cn": "客户编号",
                "description": "客户编号公开说明",
            }],
        }]
        self.config = {
            "enabled": True,
            "serviceUrl": "https://rag.example.invalid",
            "strategy": "hybrid",
            "topK": 5,
            "timeoutMs": 2000,
        }

    def _service(self, handler, *, catalog=None, config=None, token="test-server-token"):
        transport = httpx.MockTransport(handler)
        client = RagSearchHttpClient(client=httpx.Client(
            transport=transport,
            follow_redirects=False,
            trust_env=False,
        ))
        assets = MagicMock()
        assets.get_asset_tables.return_value = self.catalog if catalog is None else catalog
        return RagSearchService(
            assets,
            lambda: self.config if config is None else config,
            lambda: token,
            http_client=client,
        ), assets

    @staticmethod
    def _search_response(results):
        return httpx.Response(200, json={
            "status": "ok",
            "indexGeneration": "synthetic-generation-1",
            "results": results,
        })

    def test_disabled_default_never_calls_http_or_catalog(self):
        handler = MagicMock()
        client = RagSearchHttpClient(client=httpx.Client(transport=httpx.MockTransport(handler)))
        assets = MagicMock()
        service = RagSearchService(
            assets,
            lambda: DEFAULT_RAG_SEARCH_CONFIG.model_dump(by_alias=True),
            lambda: "must-not-be-used",
            http_client=client,
        )

        response = service.recommend("客户", profile="strict")

        self.assertEqual("disabled", response.status)
        self.assertEqual("disabled", response.reason_code)
        handler.assert_not_called()
        assets.get_asset_tables.assert_not_called()

    def test_search_uses_authenticated_http_contract_and_dap_projection(self):
        requests = []

        def handler(request):
            requests.append(request)
            body = json.loads(request.content)
            self.assertEqual("Bearer test-server-token", request.headers["Authorization"])
            self.assertEqual({"query": "客户", "topK": 5, "strategy": "hybrid"}, body)
            return self._search_response([
                {
                    "entityType": "table",
                    "assetId": "1",
                    "name": "UNTRUSTED_REMOTE_NAME",
                    "retrievalChannels": ["vector"],
                    "score": 0.93,
                    "evidence": ["untrusted hidden metadata"],
                },
                {
                    "entityType": "field",
                    "assetId": 1,
                    "fieldId": "10",
                    "name": "REMOTE_FIELD_NAME",
                    "retrievalChannels": ["hybrid"],
                    "score": 0.82,
                    "evidence": ["untrusted private description"],
                },
            ])

        service, _assets = self._service(handler)
        response = service.recommend("客户", profile="strict")

        self.assertEqual(1, len(requests))
        self.assertEqual("https://rag.example.invalid/api/v1/search", str(requests[0].url))
        self.assertEqual("available", response.status)
        self.assertEqual(2, response.count)
        self.assertEqual("CUSTOMER", response.recommendations[0].name)
        self.assertEqual("客户主表公开说明", response.recommendations[0].description)
        self.assertEqual("CUSTOMER_ID", response.recommendations[1].name)
        self.assertEqual("客户编号公开说明", response.recommendations[1].description)
        self.assertNotIn("UNTRUSTED_REMOTE_NAME", response.model_dump_json())
        self.assertNotIn("untrusted hidden metadata", response.model_dump_json())
        self.assertNotIn("0.93", response.model_dump_json())
        self.assertNotIn("private owner", response.model_dump_json())
        self.assertNotIn("private locator", response.model_dump_json())

    def test_unknown_and_duplicate_ids_are_filtered_and_deduplicated(self):
        def handler(_request):
            return self._search_response([
                {
                    "entityType": "table", "assetId": 999, "name": "hidden",
                    "retrievalChannels": [], "score": 0.9, "evidence": [],
                },
                {
                    "entityType": "field", "assetId": 1, "fieldId": 999,
                    "name": "stale", "retrievalChannels": [], "score": 0.8, "evidence": [],
                },
                {
                    "entityType": "table", "assetId": 1, "name": "CUSTOMER",
                    "retrievalChannels": [], "score": 0.7, "evidence": [],
                },
                {
                    "entityType": "table", "assetId": "1", "name": "duplicate",
                    "retrievalChannels": [], "score": 0.6, "evidence": [],
                },
            ])

        service, _assets = self._service(handler)
        response = service.recommend("客户", profile="strict")

        self.assertEqual("degraded", response.status)
        self.assertEqual("visibility_unavailable", response.reason_code)
        self.assertEqual(1, response.count)
        self.assertEqual(1, response.recommendations[0].asset_id)

    def test_missing_token_fails_closed_without_network_request(self):
        handler = MagicMock()
        service, assets = self._service(handler, token="")

        response = service.recommend("客户", profile="strict")

        self.assertEqual("unavailable", response.status)
        self.assertEqual("service_auth_not_configured", response.reason_code)
        handler.assert_not_called()
        assets.get_asset_tables.assert_not_called()

    def test_disabled_catalog_profile_fails_closed_without_http_request(self):
        handler = MagicMock()
        service, assets = self._service(handler)

        response = service.recommend("客户", profile="disabled")

        self.assertEqual("unavailable", response.status)
        self.assertEqual("visibility_unavailable", response.reason_code)
        handler.assert_not_called()
        assets.get_asset_tables.assert_not_called()

    def test_http_authentication_and_service_errors_are_safe(self):
        cases = [
            (lambda request: httpx.Response(401), "service_unauthorized"),
            (lambda request: httpx.Response(503, json={"error": {"code": "INDEX_NOT_READY"}}), "index_not_ready"),
            (lambda request: httpx.Response(503, json={"error": {"code": "MODEL_MISMATCH"}}), "model_mismatch"),
            (lambda request: httpx.Response(503, json={"error": {"code": "SEARCH_TIMEOUT"}}), "timeout"),
            (lambda request: httpx.Response(401, json={"error": {"code": "UNAUTHORIZED"}}), "service_unauthorized"),
            (lambda request: httpx.Response(400, json={"error": {"code": "INVALID_REQUEST"}}), "invalid_response"),
            (lambda request: httpx.Response(200, json={"unexpected": "payload"}), "invalid_response"),
        ]
        for handler, reason in cases:
            with self.subTest(reason=reason):
                service, _assets = self._service(handler)
                response = service.recommend("客户", profile="strict")
                self.assertEqual("unavailable", response.status)
                self.assertEqual(reason, response.reason_code)

    def test_http_timeout_is_degraded_without_leaking_exception_text(self):
        def timeout(_request):
            raise httpx.ReadTimeout("sensitive remote URL")

        service, _assets = self._service(timeout)
        response = service.recommend("客户", profile="strict")

        self.assertEqual("timeout", response.reason_code)
        self.assertNotIn("sensitive remote URL", response.model_dump_json())

    def test_health_and_readiness_diagnostics_are_authenticated(self):
        paths = []

        def handler(request):
            paths.append(request.url.path)
            self.assertEqual("Bearer test-server-token", request.headers["Authorization"])
            return httpx.Response(200, json={"status": "ready"})

        service, _assets = self._service(handler)
        diagnostics = service.diagnostics(self.config)

        self.assertEqual(["/healthz", "/readyz"], paths)
        self.assertEqual("ready", diagnostics["status"])
        self.assertTrue(diagnostics["tokenConfigured"])
        self.assertNotIn("test-server-token", json.dumps(diagnostics))

    def test_current_catalog_unavailable_discards_remote_candidates(self):
        def handler(_request):
            return self._search_response([{
                "entityType": "table", "assetId": 1, "name": "CUSTOMER",
                "retrievalChannels": [], "score": 0.9, "evidence": [],
            }])

        service, assets = self._service(handler, catalog=[])
        assets.get_asset_tables.side_effect = RuntimeError("catalog unavailable")
        response = service.recommend("客户", profile="strict")

        self.assertEqual("unavailable", response.status)
        self.assertEqual("visibility_unavailable", response.reason_code)
        self.assertEqual([], response.recommendations)


if __name__ == "__main__":
    unittest.main()
