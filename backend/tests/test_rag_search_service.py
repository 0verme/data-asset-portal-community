from __future__ import annotations

import json
import threading
import unittest
from unittest.mock import MagicMock

import httpx

from backend.app.contracts.rag_search import DEFAULT_RAG_SEARCH_CONFIG
from backend.app.services.rag_search_http_client import RagSearchHttpClient
from backend.app.services.rag_search_service import RagSearchService


class _BlockingResponseBody(httpx.SyncByteStream):
    def __init__(self):
        self.started = threading.Event()
        self.closed = threading.Event()

    def __iter__(self):
        self.started.set()
        if self.closed.wait(1):
            return
        yield b"not needed after cancellation"

    def close(self):
        self.closed.set()


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
            "password": "private database password",
            "token": "private service token",
            "cookie": "private browser cookie",
            "secret": "private signing secret",
            "authorization": "Bearer private auth token",
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
        source_catalog = self.catalog if catalog is None else catalog
        assets.get_asset_tables.return_value = source_catalog

        def load_candidates(asset_ids, field_ids_by_asset):
            result = []
            for item in source_catalog:
                asset_id = item.get("assetId")
                if asset_id not in asset_ids:
                    continue
                projected = dict(item)
                projected["fields"] = [
                    field for field in item.get("fields", [])
                    if field.get("fieldId") in field_ids_by_asset.get(asset_id, set())
                ]
                result.append(projected)
            return result

        assets.get_rag_candidate_catalog.side_effect = load_candidates
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
            "indexGeneration": "generation-1",
            "retrieval": {
                "requestedMode": "hybrid",
                "effectiveMode": "hybrid",
                "channelsUsed": ["vector", "bm25"],
                "degradationReason": None,
                "routeReason": None,
            },
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
            self.assertEqual({"query": "客户", "topK": 5}, body)
            return self._search_response([
                {
                    "entityType": "table",
                    "assetId": "1",
                    "name": "UNTRUSTED_REMOTE_NAME",
                    "retrievalChannels": ["vector"],
                    "score": 0.93,
                    "evidence": [{
                        "channel": "vector",
                        "rank": 1,
                        "rawScore": 0.82,
                        "matchedTerms": ["untrusted hidden metadata"],
                    }],
                },
                {
                    "entityType": "field",
                    "assetId": 1,
                    "fieldId": "10",
                    "name": "REMOTE_FIELD_NAME",
                    "retrievalChannels": ["hybrid"],
                    "score": 0.82,
                    "evidence": [{
                        "channel": "bm25",
                        "rank": 2,
                        "rawScore": 0.77,
                        "matchedTerms": ["untrusted private description"],
                    }],
                },
            ])

        service, assets = self._service(handler)
        response = service.recommend("客户", profile="strict")

        self.assertEqual(1, len(requests))
        self.assertEqual("https://rag.example.invalid/api/v1/search", str(requests[0].url))
        self.assertEqual("available", response.status)
        self.assertEqual(2, response.count)
        self.assertEqual([1], assets.get_rag_candidate_catalog.call_args.args[0])
        self.assertEqual({1: {10}}, assets.get_rag_candidate_catalog.call_args.args[1])
        assets.get_asset_tables.assert_not_called()
        self.assertEqual("CUSTOMER", response.recommendations[0].name)
        self.assertEqual("客户主表公开说明", response.recommendations[0].description)
        self.assertEqual("CUSTOMER_ID", response.recommendations[1].name)
        self.assertEqual("客户编号公开说明", response.recommendations[1].description)
        self.assertNotIn("UNTRUSTED_REMOTE_NAME", response.model_dump_json())
        self.assertNotIn("untrusted hidden metadata", response.model_dump_json())
        self.assertNotIn("untrusted private description", response.model_dump_json())
        self.assertNotIn("0.93", response.model_dump_json())
        self.assertNotIn("private owner", response.model_dump_json())
        self.assertNotIn("private locator", response.model_dump_json())
        self.assertNotIn("private database password", response.model_dump_json())
        self.assertNotIn("private service token", response.model_dump_json())
        self.assertNotIn("private browser cookie", response.model_dump_json())
        self.assertNotIn("private signing secret", response.model_dump_json())
        self.assertNotIn("Bearer private auth token", response.model_dump_json())

    def test_execution_observer_reports_only_actual_request_and_authorized_hit_evidence(self):
        sequence = []

        def handler(request):
            sequence.append("http_request")
            return self._search_response([{
                "entityType": "field",
                "assetId": 1,
                "fieldId": 10,
                "name": "UNTRUSTED_FIELD_NAME",
                "retrievalChannels": ["vector"],
                "score": 0.999,
                "evidence": [{
                    "channel": "bm25", "rank": 1, "rawScore": 7.3,
                    "matchedTerms": ["客户编号", "索引真实命中词"],
                }],
            }])

        service, _assets = self._service(handler)
        observations = []
        response = service.recommend(
            "客户编号",
            profile="strict",
            search_id="search-123",
            execution_callback=lambda event, data: (sequence.append(event), observations.append((event, data))),
        )

        self.assertEqual("available", response.status)
        self.assertEqual(
            ["start", "http_request", "catalog_start", "catalog_complete", "complete"],
            sequence,
        )
        self.assertEqual(
            ["start", "catalog_start", "catalog_complete", "complete"],
            [event for event, _data in observations],
        )
        started = observations[0][1]
        completed = next(data for event, data in observations if event == "complete")
        catalog_started = observations[1][1]
        self.assertEqual("database", catalog_started["phase"])
        self.assertEqual(2, completed["databaseCallCount"])
        self.assertEqual("search-123", started["searchId"])
        self.assertEqual(1, started["requestCount"])
        self.assertEqual("hybrid", completed["effectiveMode"])
        self.assertEqual(["vector", "bm25"], completed["channelsUsed"])
        self.assertEqual(1, completed["resultCount"])
        self.assertEqual(1, completed["verifiedCount"])
        self.assertEqual("客户编号", completed["hits"][0]["name"])
        self.assertNotIn("UNTRUSTED_FIELD_NAME", json.dumps(completed, ensure_ascii=False))
        self.assertEqual(["客户编号", "索引真实命中词"], completed["hits"][0]["matchedTerms"])
        serialized = json.dumps(completed, ensure_ascii=False)
        self.assertNotIn("UNTRUSTED_FIELD_NAME", serialized)
        self.assertNotIn("0.999", serialized)
        self.assertNotIn("7.3", serialized)

    def test_execution_observer_does_not_count_a_request_rejected_before_http_send(self):
        client = RagSearchHttpClient(
            client=httpx.Client(transport=httpx.MockTransport(lambda _request: httpx.Response(200))),
            max_concurrent_requests=0,
        )
        assets = MagicMock()
        assets.get_asset_tables.return_value = self.catalog
        service = RagSearchService(assets, lambda: self.config, lambda: "test-token", http_client=client)
        observations = []

        response = service.recommend(
            "客户",
            profile="strict",
            search_id="not-sent",
            execution_callback=lambda event, data: observations.append((event, data)),
        )

        self.assertEqual("busy", response.reason_code)
        self.assertEqual([], observations)
        assets.get_asset_tables.assert_not_called()

    def test_per_request_top_k_can_narrow_but_not_expand_admin_limit(self):
        request_limits = []

        def handler(request):
            request_limits.append(json.loads(request.content)["topK"])
            return self._search_response([
                {
                    "entityType": "table", "assetId": 1, "name": "CUSTOMER",
                    "retrievalChannels": [], "score": 0.9, "evidence": [],
                },
                {
                    "entityType": "field", "assetId": 1, "fieldId": 10, "name": "CUSTOMER_ID",
                    "retrievalChannels": [], "score": 0.8, "evidence": [],
                },
            ])

        service, _assets = self._service(handler)
        response = service.recommend("客户", profile="strict", top_k=1)

        self.assertEqual([1], request_limits)
        self.assertEqual(1, response.count)
        self.assertEqual(1, response.recommendations[0].asset_id)

    def test_bounded_list_expansion_respects_the_administrator_ceiling(self):
        request_limits = []

        def handler(request):
            request_limits.append(json.loads(request.content)["topK"])
            return self._search_response([{
                "entityType": "table", "assetId": 1, "name": "CUSTOMER",
                "retrievalChannels": [], "score": 0.9, "evidence": [],
            }])

        config = {**self.config, "topK": 20}
        service, _assets = self._service(handler, config=config)
        response = service.recommend("客户有哪些表和字段？", profile="strict", top_k=20)

        self.assertEqual([20], request_limits)
        self.assertEqual("available", response.status)
        self.assertEqual(1, response.count)

        limited_service, _assets = self._service(handler, config={**self.config, "topK": 6})
        limited_service.recommend("客户有哪些表和字段？", profile="strict", top_k=20)
        self.assertEqual([20, 6], request_limits)

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

    def test_field_id_must_match_its_current_parent_table(self):
        def handler(_request):
            return self._search_response([{
                "entityType": "field",
                "assetId": 2,
                "fieldId": 10,
                "name": "remote field",
                "retrievalChannels": ["vector"],
                "score": 0.9,
                "evidence": [],
            }])

        catalog = [
            self.catalog[0],
            {
                "assetId": 2,
                "name": "OTHER_TABLE",
                "cn": "其他表",
                "fields": [],
            },
        ]
        service, _assets = self._service(handler, catalog=catalog)

        response = service.recommend("客户", profile="internal")

        self.assertEqual("degraded", response.status)
        self.assertEqual("visibility_unavailable", response.reason_code)
        self.assertEqual([], response.recommendations)

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
            (lambda request: httpx.Response(503, json={"error": {"code": "SERVICE_BUSY"}}), "busy"),
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

    def test_cancellation_closes_the_active_rag_response(self):
        body = _BlockingResponseBody()
        service, _assets = self._service(lambda _request: httpx.Response(200, stream=body))
        cancel_event = threading.Event()
        responses = []

        thread = threading.Thread(
            target=lambda: responses.append(
                service.recommend("客户", profile="strict", cancel_event=cancel_event)
            )
        )
        thread.start()
        self.assertTrue(body.started.wait(1), "RAG request should be reading the active response")
        cancel_event.set()
        thread.join(1)

        self.assertFalse(thread.is_alive())
        self.assertTrue(body.closed.is_set())
        self.assertEqual(1, len(responses))
        self.assertEqual("unavailable", responses[0].status)
        self.assertEqual("service_unavailable", responses[0].reason_code)

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
        assets.get_rag_candidate_catalog.side_effect = RuntimeError("catalog unavailable")
        response = service.recommend("客户", profile="strict")

        self.assertEqual("unavailable", response.status)
        self.assertEqual("visibility_unavailable", response.reason_code)
        self.assertEqual([], response.recommendations)


if __name__ == "__main__":
    unittest.main()
