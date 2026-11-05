from __future__ import annotations

import os
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import MagicMock, patch

from backend.app.application import Identity
from backend.app.authorization.core import AuthorizationService
from backend.app.contracts.ai_ask import AiAskProgressStep, AiAskResponse
from backend.app.core.capabilities import resolve_capabilities
from backend.app.fastapi_app import create_fastapi_app
from backend.app.services.ai_ask_service import AIAskCancelled
from backend.app.services.ai_ask_admission import AIAskAdmissionController
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

    def _client(self, *, service=None, execution=None, identity=_DEFAULT_IDENTITY, search=None, rag=None, authorization=None, assets=None, field_mapping=None):
        search_provider = search or MagicMock()
        search_provider.search.return_value = {
            "query": "legacy", "scope": "all", "groups": [], "total": 0,
        }
        return TestClient(create_fastapi_app(
            capabilities=resolve_capabilities(),
            identity_resolver=lambda _request: self.identity if identity is _DEFAULT_IDENTITY else identity,
            ai_ask_service_instance=service or StubAIAskService(),
            ai_ask_execution_service_instance=execution,
            search_provider_instance=search_provider,
            rag_search_service_instance=rag or MagicMock(),
            assets_service_instance=assets,
            field_mapping_service_instance=field_mapping,
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

    def test_blocked_ai_worker_does_not_block_ordinary_search_api(self):
        import threading

        service = StubAIAskService()
        started = threading.Event()
        release = threading.Event()

        class BlockingExecutionService:
            def ask(self, *_args, **_kwargs):
                started.set()
                release.wait(5)
                return service.response

        assets = MagicMock()
        assets.get_asset_tables.return_value = []
        field_mapping = MagicMock()
        field_mapping.get_source_systems.return_value = []
        client, search = self._client(
            service=service,
            execution=BlockingExecutionService(),
            assets=assets,
            field_mapping=field_mapping,
        )
        controller = AIAskAdmissionController(max_concurrent=1, max_queued=0)
        with patch("backend.app.fastapi.routers.ai_ask.ai_ask_admission", controller):
            with ThreadPoolExecutor(max_workers=1) as executor:
                pending = executor.submit(
                    client.post,
                    "/api/ai/ask/stream",
                    json={"query": "并发合成问答"},
                )
                self.assertTrue(started.wait(2), "AI worker should have entered the blocking fixture")
                self.assertEqual((1, 0), controller.snapshot())
                ordinary_response = client.get("/api/search?q=ordinary")
                asset_response = client.get("/api/assets/tables")
                field_mapping_response = client.get("/api/field-mappings/source-systems")
                self.assertEqual(200, ordinary_response.status_code)
                self.assertEqual(200, asset_response.status_code)
                self.assertEqual(200, field_mapping_response.status_code)
                release.set()
                stream_response = pending.result(timeout=5)

        self.assertEqual(1, stream_response.text.count("event: answer\n"))
        search.search.assert_called_once_with("ordinary", scope="all", limit="5", profile="internal")
        assets.get_asset_tables.assert_called_once()
        field_mapping.get_source_systems.assert_called_once()
        self.assertEqual((0, 0), controller.snapshot())

    def test_default_app_composition_runs_stream_through_the_isolated_worker_seam(self):
        import threading

        service = StubAIAskService()
        workers = []

        class StubProcessWorker:
            def __init__(self, *, mode, payload, profile, request_id="", **_kwargs):
                self.mode = mode
                self.payload = payload
                self.profile = profile
                self.request_id = request_id
                self.timeout_seconds = 2
                self.database_timeout_seconds = 1
                self.cancel_event = threading.Event()
                self.running = False
                self.messages = [
                    ("event", "answer", {
                        "request_id": request_id,
                        "step_id": "answer",
                        "timestamp": "2026-01-01T00:00:00.000Z",
                        "message": "已返回合成答案。",
                        "data": {"response": service.response.model_dump(by_alias=True)},
                    }),
                    ("result", service.response.model_dump(by_alias=True)),
                    ("__end__", None),
                ] if mode == "stream" else [
                    ("result", service.response.model_dump(by_alias=True)),
                    ("__end__", None),
                ]
                workers.append(self)

            def start(self):
                self.running = True

            def get_message(self, _timeout=0.1):
                return self.messages.pop(0) if self.messages else None

            def has_timed_out(self):
                return False

            def is_alive(self):
                return self.running

            def join_after_completion(self):
                self.running = False
                return True

            def cancel_and_stop(self):
                self.running = False
                return True

        app = create_fastapi_app(
            capabilities=resolve_capabilities(),
            identity_resolver=lambda _request: None,
            authorization_service_instance=AuthorizationService(),
            openapi_enabled=True,
        )
        client = TestClient(app)
        with patch("backend.app.fastapi.routers.ai_ask.AIAskProcessWorker", StubProcessWorker):
            response = client.post("/api/ai/ask/stream", json={"query": "默认隔离路径合成问题"})
            json_response = client.post("/api/ai/ask", json={"query": "默认隔离 JSON 问题"})

        self.assertEqual(200, response.status_code)
        self.assertEqual(200, json_response.status_code)
        self.assertEqual(["stream", "progress"], [worker.mode for worker in workers])
        self.assertTrue(all(worker.profile == "internal" for worker in workers))
        self.assertEqual(1, response.text.count("event: answer\n"))
        self.assertEqual(1, response.text.count("event: done\n"))
        self.assertIn('"status":"completed"', response.text)
        self.assertEqual("answered", json_response.json()["status"])

    def test_ai_overload_is_explicit_and_does_not_block_ordinary_search(self):
        service = StubAIAskService()
        client, search = self._client(service=service)
        controller = AIAskAdmissionController(max_concurrent=1, max_queued=0)
        active = controller.reserve()

        with patch("backend.app.fastapi.routers.ai_ask.ai_ask_admission", controller):
            json_response = client.post("/api/ai/ask", json={"query": "合成问答"})
            stream_response = client.post("/api/ai/ask/stream", json={"query": "合成流式问答"})
            ordinary_response = client.get("/api/search?q=ordinary")

        active.release()
        self.assertEqual(200, json_response.status_code)
        self.assertEqual("generation_unavailable", json_response.json()["status"])
        self.assertEqual("llm_busy", json_response.json()["reasonCode"])
        self.assertEqual(1, stream_response.text.count("event: answer\n"))
        self.assertEqual(1, stream_response.text.count("event: done\n"))
        self.assertIn('"reasonCode":"llm_busy"', stream_response.text)
        self.assertEqual(200, ordinary_response.status_code)
        search.search.assert_called_once_with("ordinary", scope="all", limit="5", profile="internal")
        self.assertEqual([], service.calls)

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
        self.assertIn("/api/ai/ask/stream", schema["paths"])
        self.assertIn("/api/ai/status", schema["paths"])

    def test_execution_stream_emits_real_steps_answer_and_terminal_status_with_request_id(self):
        service = StubAIAskService()

        class StubExecutionService:
            def __init__(self):
                self.calls = []

            def ask(self, payload, *, profile, request_id, event_callback, cancel_event=None):
                self.calls.append((payload, profile, request_id))
                event_callback("step_start", {
                    "request_id": request_id,
                    "step_id": "planning",
                    "timestamp": "2026-01-01T00:00:00.000Z",
                    "message": "正在分析合成问题。",
                    "data": {"query": payload.query},
                })
                event_callback("step_complete", {
                    "request_id": request_id,
                    "step_id": "planning",
                    "timestamp": "2026-01-01T00:00:00.001Z",
                    "message": "已完成查询规划。",
                    "data": {"planningMode": "structured_llm", "queries": [payload.query]},
                })
                event_callback("answer", {
                    "request_id": request_id,
                    "step_id": "answer",
                    "timestamp": "2026-01-01T00:00:00.002Z",
                    "message": "已生成答案。",
                    "data": {"response": service.response.model_dump(by_alias=True)},
                })
                return service.response

        execution = StubExecutionService()
        client, _search = self._client(service=service, execution=execution)

        response = client.post("/api/ai/ask/stream", json={"query": "合成目录问题"})

        self.assertEqual(200, response.status_code)
        self.assertIn("text/event-stream", response.headers["content-type"])
        self.assertIn("event: step_start\n", response.text)
        self.assertIn("event: step_complete\n", response.text)
        self.assertIn("event: answer\n", response.text)
        self.assertEqual(1, response.text.count("event: answer\n"))
        self.assertEqual(1, response.text.count("event: done\n"))
        self.assertIn("event: done\n", response.text)
        self.assertIn('"status":"completed"', response.text)
        self.assertIn("发现已校验的目录候选。", response.text)
        self.assertNotIn("apiKey", response.text)
        self.assertNotIn("token", response.text.lower())
        self.assertEqual(1, len(execution.calls))
        self.assertEqual("internal", execution.calls[0][1])
        self.assertEqual(32, len(execution.calls[0][2]))
        self.assertEqual(execution.calls[0][2], response.text.split('"request_id":"', 1)[1][:32])

    def test_execution_stream_compatibility_and_exception_paths_emit_only_one_answer(self):
        service = StubAIAskService()
        client, _search = self._client(service=service, execution=service)
        compatible = client.post("/api/ai/ask/stream", json={"query": "兼容目录问题"})
        self.assertEqual(1, compatible.text.count("event: answer\n"))
        self.assertEqual(1, compatible.text.count("event: done\n"))
        self.assertIn('"status":"completed"', compatible.text)

        class BrokenExecutionService:
            def ask(self, *_args, **_kwargs):
                raise RuntimeError("private provider details")

        client, _search = self._client(service=service, execution=BrokenExecutionService())
        failed = client.post("/api/ai/ask/stream", json={"query": "异常目录问题"})
        self.assertEqual(1, failed.text.count("event: answer\n"))
        self.assertEqual(1, failed.text.count("event: done\n"))
        self.assertIn('"status":"failed"', failed.text)
        self.assertNotIn("private provider details", failed.text)

    def test_execution_stream_cancellation_is_terminal_without_an_answer(self):
        service = StubAIAskService()

        class CancelledExecutionService:
            def ask(self, *_args, **_kwargs):
                raise AIAskCancelled("request_cancelled")

        client, _search = self._client(service=service, execution=CancelledExecutionService())
        response = client.post("/api/ai/ask/stream", json={"query": "取消目录问题"})

        self.assertEqual(200, response.status_code)
        self.assertEqual(0, response.text.count("event: answer\n"))
        self.assertEqual(1, response.text.count("event: done\n"))
        self.assertIn('"status":"cancelled"', response.text)

    def test_metadata_count_stream_is_successful_and_emits_one_answer(self):
        response_contract = AiAskResponse(
            status="metadata_count_answered",
            answer="当前 DAP 目录中共有 0 张数据表。",
            metadataCount={
                "metric": "table_count",
                "value": 0,
                "filters": {"domain": None, "layer": None},
                "source": "dap_catalog",
                "complete": True,
                "catalogProfile": "strict",
                "sourceLink": "/data-warehouse",
            },
            retrievalStatus="not_run",
            generationStatus="not_run",
        )
        service = StubAIAskService(response=response_contract)

        class MetadataCountExecutionService:
            def ask(self, payload, *, profile, request_id, event_callback, cancel_event=None):
                event_callback("step_start", {
                    "request_id": request_id,
                    "step_id": "metadata-count",
                    "timestamp": "2026-01-01T00:00:00.000Z",
                    "message": "正在执行精确目录 COUNT。",
                    "data": {"intent": "metadata_count"},
                })
                event_callback("step_complete", {
                    "request_id": request_id,
                    "step_id": "metadata-count",
                    "timestamp": "2026-01-01T00:00:00.001Z",
                    "message": "DAP 目录精确 COUNT 已完成。",
                    "data": {"intent": "metadata_count", "tableCount": 0},
                })
                event_callback("answer", {
                    "request_id": request_id,
                    "step_id": "answer",
                    "timestamp": "2026-01-01T00:00:00.002Z",
                    "message": "已返回精确目录统计。",
                    "data": {"response": response_contract.model_dump(by_alias=True)},
                })
                return response_contract

        client, _search = self._client(service=service, execution=MetadataCountExecutionService())
        response = client.post("/api/ai/ask/stream", json={"query": "共有多少张表？"})

        self.assertEqual(200, response.status_code)
        self.assertEqual(1, response.text.count("event: answer\n"))
        self.assertIn('"status":"completed"', response.text)
        self.assertIn('"metadataCount":{"metric":"table_count","value":0', response.text)

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
