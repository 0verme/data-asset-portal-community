"""Regression tests for DAP's synthetic, provisional HTTP contract."""

from __future__ import annotations

import unittest

from pydantic import ValidationError

from backend.app.contracts.rag_search import (
    DEFAULT_RAG_SEARCH_CONFIG,
    RagHttpSearchRequest,
    RagHttpSearchResponse,
    RagRecommendationsResponse,
    RagSearchConfig,
    RagSearchConfigUpdate,
    RagSearchConfigView,
)


class RagRecommendationsContractTests(unittest.TestCase):
    def test_disabled_by_default_has_no_local_index_or_model_configuration(self):
        defaults = DEFAULT_RAG_SEARCH_CONFIG
        self.assertFalse(defaults.enabled)
        self.assertEqual("", defaults.service_url)
        self.assertEqual("auto", defaults.strategy)
        self.assertEqual(5, defaults.top_k)
        payload = defaults.model_dump(by_alias=True)
        self.assertNotIn("indexPath", payload)
        self.assertNotIn("modelPath", payload)
        self.assertNotIn("serviceToken", payload)

    def test_same_host_http_and_cross_host_https_urls_are_valid(self):
        local = RagSearchConfig(enabled=True, serviceUrl="http://localhost")
        local_ip = RagSearchConfig(enabled=True, serviceUrl="http://127.0.0.1")
        remote = RagSearchConfig(enabled=True, serviceUrl="https://rag.example.invalid")
        self.assertEqual("http://localhost", local.service_url)
        self.assertEqual("http://127.0.0.1", local_ip.service_url)
        self.assertEqual("https://rag.example.invalid", remote.service_url)

    def test_url_rejects_remote_http_credentials_query_and_path(self):
        invalid = [
            "http://rag.example.invalid",
            "https://user:password@rag.example.invalid",
            "https://rag.example.invalid?token=secret",
            "https://rag.example.invalid/search",
        ]
        for url in invalid:
            with self.subTest(url=url), self.assertRaises(ValidationError):
                RagSearchConfig(enabled=True, serviceUrl=url)

    def test_enabled_config_requires_service_url_and_bounded_policy(self):
        with self.assertRaises(ValidationError):
            RagSearchConfig(enabled=True)
        with self.assertRaises(ValidationError):
            RagSearchConfig(enabled=True, serviceUrl="https://rag.example.invalid", topK=21)
        with self.assertRaises(ValidationError):
            RagSearchConfig(enabled=True, serviceUrl="https://rag.example.invalid", timeoutMs=10001)

    def test_browser_config_view_exposes_only_token_configured_boolean(self):
        view = RagSearchConfigView(
            enabled=True,
            serviceUrl="https://rag.example.invalid",
            tokenConfigured=True,
        )
        payload = view.model_dump(by_alias=True)
        self.assertTrue(payload["tokenConfigured"])
        self.assertNotIn("token", payload)
        self.assertNotIn("serviceToken", payload)
        self.assertNotIn("authorization", payload)

    def test_admin_payload_rejects_browser_supplied_secret(self):
        for key in ("token", "serviceToken", "authToken", "authorization"):
            with self.subTest(key=key), self.assertRaises(ValidationError):
                RagSearchConfigUpdate.model_validate({key: "must-not-enter-browser-payload"})

    def test_outbound_request_aliases_and_retrieval_strategy_are_explicit(self):
        request = RagHttpSearchRequest(query="客户", topK=7, strategy="hybrid")
        self.assertEqual(
            {"query": "客户", "topK": 7, "strategy": "hybrid"},
            request.model_dump(by_alias=True),
        )
        with self.assertRaises(ValidationError):
            RagHttpSearchRequest(query="客户", topK=100, strategy="hybrid")

    def test_synthetic_http_response_contract_is_bounded_and_requires_field_identity(self):
        response = RagHttpSearchResponse.model_validate({
            "status": "ok",
            "indexGeneration": "synthetic-generation",
            "results": [{
                "entityType": "field",
                "assetId": "42",
                "fieldId": 99,
                "name": "REMOTE_NAME",
                "retrievalChannels": ["vector"],
                "score": 0.91,
                "evidence": ["synthetic evidence"],
            }],
        })
        self.assertEqual("synthetic-generation", response.index_generation)
        self.assertEqual(99, response.results[0].field_id)
        with self.assertRaises(ValidationError):
            RagHttpSearchResponse.model_validate({
                "status": "ok",
                "indexGeneration": "synthetic-generation",
                "results": [{
                    "entityType": "field",
                    "assetId": 42,
                    "name": "REMOTE_NAME",
                    "retrievalChannels": [],
                    "score": 0.5,
                    "evidence": [],
                }],
            })
        with self.assertRaises(ValidationError):
            RagHttpSearchResponse.model_validate({
                "status": "ok",
                "indexGeneration": "synthetic-generation",
                "results": [],
                "privateDebug": "must be rejected",
            })

    def test_public_response_never_contains_remote_score_or_unverified_name(self):
        response = RagRecommendationsResponse(
            query="金额",
            status="available",
            count=1,
            recommendations=[{
                "assetId": 42,
                "fieldId": 99,
                "assetType": "field",
                "name": "DAP_CANONICAL_FIELD",
                "relatedTable": {"assetId": 42, "name": "DAP_CANONICAL_TABLE"},
                "evidence": ["已通过当前共享目录校验"],
            }],
        )
        payload = response.model_dump(by_alias=True)
        self.assertEqual("DAP_CANONICAL_FIELD", payload["recommendations"][0]["name"])
        self.assertNotIn("score", payload["recommendations"][0])
        self.assertNotIn("indexGeneration", payload)

    def test_public_response_requires_count_consistency_and_safe_disabled_state(self):
        with self.assertRaises(ValidationError):
            RagRecommendationsResponse(
                query="金额", status="available", recommendations=[], count=1
            )
        with self.assertRaises(ValidationError):
            RagRecommendationsResponse(
                query="金额",
                status="unavailable",
                recommendations=[{
                    "assetId": 1,
                    "assetType": "table",
                    "name": "T",
                }],
                count=1,
                reasonCode="service_unavailable",
            )


if __name__ == "__main__":
    unittest.main()
