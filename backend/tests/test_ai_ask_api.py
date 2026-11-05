from __future__ import annotations

import os
import unittest
from unittest.mock import MagicMock, patch

from backend.app.application import Identity
from backend.app.authorization.core import AuthorizationService
from backend.app.contracts.ai_ask import AiAskProgressStep, AiAskResponse
from backend.app.core.capabilities import resolve_capabilities
from backend.app.fastapi_app import create_fastapi_app
from fastapi.testclient import TestClient

_DEFAULT_IDENTITY = object()


class StubAIAskService:
    def __init__(self, *, enabled=True, response=None):
        self._enabled = enabled
        self.response = response or AiAskResponse(
            status="answered",
            answer="发现已校验的目录候选。",
            citations=[{"assetId": 7, "fieldId": 11, "source": "dap_catalog"}],
            candidates=[{
                "assetId": 7,
                "fieldId": 11,
                "assetType": "field",
                "tableName": "ACCOUNT_BALANCE",
                "tableDisplayName": "账户余额表",
                "tableDescription": "余额说明",
                "fieldName": "BALANCE_AMT",
                "fieldDisplayName": "余额金额",
                "fieldDescription": "余额字段",
                "domain": "账户域",
                "layer": "DWS",
                "source": "dap_catalog",
                "matchReason": "由当前 DAP 目录校验",
                "relevance": "direct",
            }],
            retrievalStatus="available",
            generationStatus="completed",
        )
        self.calls = []

    def enabled(self):
        return self._enabled

    def ask(self, payload, *, profile, progress_callback=None, cancel_event=None):
        self.calls.append((payload, profile))
        if progress_callback is not None:
            progress_callback(AiAskProgressStep(id="analyzing", status="pending"))
            progress_callback(AiAskProgressStep(id="analyzing", status="running"))
            progress_callback(AiAskProgressStep(id="analyzing", status="completed", elapsedMs=1))
        return self.response


class AiAskApiTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, {
            "APP_ENV": "development",
            "APP_SECRET_KEY": "ai-ask-api-test-secret",
            "PUBLIC_CATALOG_PROFILE": "internal",
        }, clear=False)
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.identity = Identity("test-user", "admin", "测试管理员")

    def _client(self, *, service=None, identity=_DEFAULT_IDENTITY, search=None, rag=None, authorization=None):
        search_provider = search or MagicMock()
        search_provider.search.return_value = {
            "query": "legacy", "scope": "all", "groups": [], "total": 0,
        }
        return TestClient(create_fastapi_app(
            capabilities=resolve_capabilities(),
            identity_resolver=lambda _request: self.identity if identity is _DEFAULT_IDENTITY else identity,
            ai_ask_service_instance=service or StubAIAskService(),
            search_provider_instance=search_provider,
            rag_search_service_instance=rag or MagicMock(),
            authorization_service_instance=authorization or AuthorizationService(),
            openapi_enabled=True,
        )), search_provider

    def test_status_is_browser_safe_and_ask_uses_profile_and_stable_ids(self):
        service = StubAIAskService()
        client, _search = self._client(service=service)

        status = client.get("/api/ai/status")
        response = client.post("/api/ai/ask", json={
            "query": "  贷款余额在哪个表？  ", "scope": "all", "topK": 4,
        })

        self.assertEqual(200, status.status_code)
        self.assertEqual({"enabled": True}, status.json())
        self.assertNotIn("model", status.json())
        self.assertNotIn("baseUrl", status.json())
        self.assertNotIn("apiKey", status.json())
        self.assertEqual(200, response.status_code)
        self.assertEqual("answered", response.json()["status"])
        self.assertEqual({"assetId": 7, "fieldId": 11, "source": "dap_catalog"}, response.json()["citations"][0])
        request, profile = service.calls[0]
        self.assertEqual("贷款余额在哪个表？", request.query)
        self.assertEqual(4, request.top_k)
        self.assertEqual("internal", profile)

    def test_enabled_public_catalog_allows_anonymous_single_turn_metadata_ask(self):
        service = StubAIAskService()
        client, _search = self._client(service=service, identity=None)

        status = client.get("/api/ai/status")
        response = client.post("/api/ai/ask", json={"query": "合成元数据问题"})

        self.assertEqual(200, status.status_code)
        self.assertEqual({"enabled": True}, status.json())
        self.assertEqual(200, response.status_code)
        self.assertEqual("answered", response.json()["status"])
        self.assertEqual("internal", service.calls[0][1])

    def test_metadata_count_contract_is_returned_without_rag_citations_or_model_success(self):
        response_contract = AiAskResponse(
            status="metadata_count_answered",
            answer="当前 DAP 目录中，合成主题域、数据集市层共有 0 张数据表。",
            metadataCount={
                "metric": "table_count",
                "value": 0,
                "filters": {
                    "domain": {
                        "code": "SYNTH",
                        "displayName": "合成主题域",
                        "matchedAs": "catalog_value",
                        "inferred": False,
                    },
                    "layer": {
                        "code": "DM",
                        "displayName": "数据集市层",
                        "matchedAs": "catalog_alias",
                        "inferred": True,
                    },
                },
                "source": "dap_catalog",
                "complete": True,
                "catalogProfile": "strict",
                "sourceLink": "/data-warehouse?domain=%E5%90%88%E6%88%90%E4%B8%BB%E9%A2%98%E5%9F%9F&layer=DM",
            },
            retrievalStatus="not_run",
            generationStatus="not_run",
            reasonCode=None,
        )
        service = StubAIAskService(response=response_contract)
        with patch.dict(os.environ, {"PUBLIC_CATALOG_PROFILE": "strict"}, clear=False):
            client, _search = self._client(service=service, identity=None)
            response = client.post("/api/ai/ask", json={"query": "合成主题域集市有几张表？"})

        self.assertEqual(200, response.status_code)
        payload = response.json()
        self.assertEqual("metadata_count_answered", payload["status"])
        self.assertEqual(0, payload["metadataCount"]["value"])
        self.assertTrue(payload["metadataCount"]["complete"])
        self.assertEqual("strict", payload["metadataCount"]["catalogProfile"])
        self.assertEqual("not_run", payload["generationStatus"])
        self.assertEqual([], payload["citations"])
        self.assertEqual("strict", service.calls[0][1])

    def test_disabled_status_is_false_and_does_not_leak_configuration(self):
        client, _search = self._client(service=StubAIAskService(enabled=False))

        response = client.get("/api/ai/status")

        self.assertEqual(200, response.status_code)
        self.assertEqual({"enabled": False}, response.json())

    def test_request_validation_rejects_session_fields_invalid_scope_and_bounds(self):
        client, _search = self._client()
        invalid = [
            {"query": " "},
            {"query": "x", "scope": "field"},
            {"query": "x", "topK": 11},
            {"query": "x", "session_id": "not-supported"},
        ]
        for payload in invalid:
            with self.subTest(payload=payload):
                response = client.post("/api/ai/ask", json=payload)
                self.assertEqual(422, response.status_code)

    def test_public_catalog_disabled_requires_authentication(self):
        with patch.dict(os.environ, {"PUBLIC_CATALOG_PROFILE": "disabled"}, clear=False):
            client, _search = self._client(
                identity=None,
                authorization=AuthorizationService(),
            )
            status = client.get("/api/ai/status")
            ask = client.post("/api/ai/ask", json={"query": "测试"})

        self.assertEqual(401, status.status_code)
        self.assertEqual(401, ask.status_code)

    def test_traditional_search_route_remains_unchanged_and_documented(self):
        client, search = self._client()
        search.search.return_value = {
            "query": "legacy", "scope": "all", "groups": [], "total": 0,
        }

        result = client.get("/api/search?q=legacy")
        schema = client.get("/openapi.json").json()

        self.assertEqual(200, result.status_code)
        self.assertEqual("legacy", result.json()["query"])
        search.search.assert_called_once_with("legacy", scope="all", limit="5", profile="internal")
        self.assertIn("/api/ai/ask", schema["paths"])
        self.assertIn("/api/ai/ask/progress", schema["paths"])
        self.assertIn("/api/ai/status", schema["paths"])

    def test_progress_endpoint_emits_safe_sse_and_keeps_existing_json_api(self):
        service = StubAIAskService()
        client, _search = self._client(service=service)

        response = client.post("/api/ai/ask/progress", json={"query": "合成目录问题"})

        self.assertEqual(200, response.status_code)
        self.assertIn("text/event-stream", response.headers["content-type"])
        self.assertIn("event: progress\n", response.text)
        self.assertIn('"status":"running"', response.text)
        self.assertIn('"elapsedMs":1', response.text)
        self.assertIn("event: result\n", response.text)
        self.assertIn("发现已校验的目录候选。", response.text)
        self.assertNotIn("apiKey", response.text)
        self.assertEqual(1, len(service.calls))


if __name__ == "__main__":
    unittest.main()
