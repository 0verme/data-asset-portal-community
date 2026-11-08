from __future__ import annotations

import json
import threading
import unittest
from copy import deepcopy

from backend.app.contracts.ai_ask import AiAskRequest
from backend.app.contracts.rag_search import (
    RagRecommendation,
    RagRecommendationsResponse,
    RagRelatedTable,
)
from backend.app.services.ai_ask_execution_service import AIAskExecutionService
from backend.app.services.ai_ask_service import AIAskCancelled, AIAskService
from backend.app.services.ai_llm_provider import LLMProviderError


TABLE_7 = RagRecommendation(
    assetId=7,
    assetType="table",
    name="INDEX_TABLE_7",
    displayName="索引表 7",
    description="仅为 RAG 索引摘要",
)
FIELD_7 = RagRecommendation(
    assetId=7,
    fieldId=11,
    assetType="field",
    name="INDEX_FIELD_11",
    displayName="索引字段 11",
    description="索引摘要字段说明",
    relatedTable=RagRelatedTable(assetId=7, name="INDEX_TABLE_7"),
)
TABLE_8 = RagRecommendation(
    assetId=8,
    assetType="table",
    name="INDEX_TABLE_8",
    displayName="索引表 8",
    description="索引摘要",
)


def search_response(query: str, items=(), *, status="available", reason=None):
    return RagRecommendationsResponse(
        query=query,
        status=status,
        recommendations=list(items),
        count=len(items),
        reasonCode=reason,
    )


class StubLLMProvider:
    def __init__(self, *, plan=None, answer=None, planning_error=None, answer_error=None):
        self.plan = plan or {
            "queryType": "natural_language",
            "keyConcepts": ["合成概念", "合成字段"],
            "queries": ["合成概念字段", "字段含义"],
            "supplementalQuery": "目录字段说明",
        }
        self.answer = answer or {
            "questionType": "field_explanation",
            "claims": [{"assetId": 7, "fieldId": 11, "relevance": "direct"}],
        }
        self.planning_error = planning_error
        self.answer_error = answer_error
        self.calls = []

    def is_enabled(self):
        return True

    def complete_json(self, *, system_prompt, user_payload, cancel_event=None):
        self.calls.append((system_prompt, user_payload))
        if "检索查询规划器" in system_prompt:
            if self.planning_error:
                raise self.planning_error
            return json.dumps(self.plan, ensure_ascii=False)
        if self.answer_error:
            raise self.answer_error
        return json.dumps(self.answer, ensure_ascii=False)


class StubRagService:
    def __init__(self, responses=None):
        self.responses = responses or {}
        self.calls = []
        self.configured = True

    def is_configured(self):
        return self.configured

    def recommend(
        self,
        query,
        *,
        profile,
        top_k=None,
        cancel_event=None,
        search_id=None,
        execution_callback=None,
    ):
        self.calls.append((query, profile, top_k, search_id))
        if execution_callback is not None:
            execution_callback("start", {
                "searchId": search_id,
                "query": query,
                "startedAt": "2026-01-01T00:00:00.000Z",
                "retrievalMode": "auto",
                "requestCount": 1,
            })
        response = self.responses.get(query, search_response(query))
        if execution_callback is not None:
            hits = []
            for rank, recommendation in enumerate(response.recommendations, start=1):
                hits.append({
                    "rank": rank,
                    "assetId": recommendation.asset_id,
                    "fieldId": recommendation.field_id,
                    "entityType": recommendation.asset_type,
                    "name": recommendation.name,
                    "retrievalChannels": ["vector" if rank == 1 else "bm25"],
                    "matchedTerms": [f"真实命中词 {query}"],
                })
            execution_callback("complete", {
                "searchId": search_id,
                "query": query,
                "startedAt": "2026-01-01T00:00:00.000Z",
                "finishedAt": "2026-01-01T00:00:00.015Z",
                "durationMs": 15,
                "retrievalMode": "auto",
                "requestedMode": "auto",
                "effectiveMode": "hybrid",
                "channelsUsed": ["vector", "bm25"],
                "resultCount": response.count,
                "verifiedCount": response.count,
                "hits": hits,
                "status": response.status,
                "errorCode": response.reason_code,
                "requestCount": 1,
            })
        return response


class StubReportCountService:
    def __init__(self, value=4):
        self.value = value
        self.calls = 0

    def count_reports(self):
        self.calls += 1
        return self.value


class StubAssetsService:
    def __init__(self, *, missing_field=False, fail_ids=(), count_error=False):
        self.calls = []
        self.batch_calls = []
        self.count_calls = []
        self.fail_ids = set(fail_ids)
        self.count_error = count_error
        fields_7 = [{
            "assetId": 7,
            "fieldId": 11 if not missing_field else 999,
            "name": "AUTHORITATIVE_FIELD_11",
            "cn": "权威字段中文名",
            "description": "从 DAP 资产明细按稳定 ID 读取的字段说明。",
            "type": "DECIMAL(12,2)",
            "nullable": False,
            "pk": False,
            "part": False,
        }]
        self.details = {
            7: {
                "assetId": 7,
                "name": "AUTHORITATIVE_TABLE_7",
                "cn": "权威表中文名",
                "desc": "DAP 权威表说明",
                "domain": "合成主题域",
                "layer": "DWS",
                "fields": fields_7,
            },
            8: {
                "assetId": 8,
                "name": "AUTHORITATIVE_TABLE_8",
                "cn": "权威表 8",
                "desc": "DAP 权威说明",
                "domain": "合成主题域",
                "layer": "DWS",
                "fields": [],
            },
        }

    def get_asset_detail_by_id(self, asset_id):
        self.calls.append(asset_id)
        if asset_id in self.fail_ids or asset_id not in self.details:
            raise RuntimeError("private data source error")
        return self.details[asset_id]

    def get_rag_candidate_catalog(self, asset_ids, field_ids_by_asset=None):
        self.batch_calls.append((list(asset_ids), {
            asset_id: set(field_ids)
            for asset_id, field_ids in (field_ids_by_asset or {}).items()
        }))
        result = []
        for asset_id in asset_ids:
            if asset_id in self.fail_ids or asset_id not in self.details:
                continue
            detail = deepcopy(self.details[asset_id])
            allowed_fields = set((field_ids_by_asset or {}).get(asset_id, set()))
            detail["fields"] = [
                field for field in detail.get("fields", [])
                if field.get("fieldId") in allowed_fields
            ]
            result.append(detail)
        return result

    def get_asset_count_filter_catalog(self):
        return {
            "domains": [{"code": "SYNTH", "name": "合成主题域"}],
            "layers": [{"code": "MART", "name": "数据集市层"}],
        }

    def count_asset_tables(self, **filters):
        self.count_calls.append(filters)
        if self.count_error:
            raise RuntimeError("synthetic catalog count failure")
        return 73


class AIAskExecutionServiceTests(unittest.TestCase):
    def _service(self, *, plan=None, answer=None, planning_error=None, answer_error=None, responses=None, assets=None, reports=None):
        rag = StubRagService(responses)
        provider = StubLLMProvider(
            plan=plan, answer=answer, planning_error=planning_error, answer_error=answer_error
        )
        base = AIAskService(rag, provider, reports_service=reports)
        assets_service = assets or StubAssetsService()
        return AIAskExecutionService(base, assets_service), rag, provider, assets_service

    def test_natural_language_plan_runs_multiple_real_queries_fuses_duplicates_and_reads_by_id(self):
        plan = {
            "queryType": "natural_language",
            "keyConcepts": ["合成概念", "合成字段"],
            "queries": ["合成概念字段", "字段含义"],
            "supplementalQuery": "不得在首轮命中时执行",
        }
        responses = {
            "合成概念字段": search_response("合成概念字段", [FIELD_7]),
            "字段含义": search_response("字段含义", [FIELD_7, TABLE_8]),
            "这个合成字段在哪个表？": search_response("这个合成字段在哪个表？", [TABLE_7]),
        }
        service, rag, llm, assets = self._service(plan=plan, responses=responses)
        events = []

        response = service.ask(
            AiAskRequest(query="这个合成字段在哪个表？"),
            profile="strict",
            request_id="request-test-1",
            event_callback=lambda event, data: events.append((event, data)),
        )

        self.assertEqual("answered", response.status)
        self.assertEqual([(7, 11)], [(item.asset_id, item.field_id) for item in response.citations])
        self.assertIn("AUTHORITATIVE_TABLE_7", response.answer)
        self.assertIn("AUTHORITATIVE_FIELD_11", response.answer)
        self.assertNotIn("INDEX_FIELD_11", response.answer)
        self.assertEqual(3, len(rag.calls))
        self.assertEqual(3, len({call[3] for call in rag.calls}))
        self.assertEqual([([7, 8], {7: {11}})], assets.batch_calls)
        self.assertEqual(2, len(llm.calls))  # one structured plan + one answer selection
        answer_payload = llm.calls[-1][1]
        self.assertEqual("AUTHORITATIVE_FIELD_11", answer_payload["candidates"][0]["fieldName"])
        self.assertNotIn("matchedTerms", json.dumps(answer_payload))

        planning = next(data for event, data in events if event == "step_complete" and data["step_id"] == "planning")
        self.assertEqual(3, len(planning["data"]["queries"]))
        search_starts = [data for event, data in events if event == "step_start" and data["step_id"].startswith("search-")]
        self.assertEqual(3, len(search_starts))
        asset_starts = [
            data for event, data in events
            if event == "step_start" and data["step_id"].startswith("asset-")
        ]
        self.assertEqual(2, len(asset_starts))
        self.assertTrue(all(item["data"]["phase"] == "database" for item in asset_starts))
        self.assertTrue(all(item["data"]["databaseCallCount"] == 2 for item in asset_starts))
        self.assertEqual(3, len({item["data"]["searchId"] for item in search_starts}))
        search_completes = [data for event, data in events if event == "step_complete" and data["step_id"].startswith("search-")]
        self.assertTrue(all(item["data"]["effectiveMode"] == "hybrid" for item in search_completes))
        self.assertTrue(any(event == "step_complete" and data["step_id"] == "merge" and data["data"]["fusionMethod"] == "reciprocal_rank_fusion" for event, data in events))
        self.assertTrue(any(event == "step_complete" and data["step_id"] == "field-7-11" for event, data in events))
        answer_event = next(data for event, data in events if event == "answer")
        self.assertEqual("request-test-1", answer_event["request_id"])

    def test_metadata_count_short_circuits_planner_rag_and_model_with_exact_count_evidence(self):
        service, rag, llm, assets = self._service()
        events = []

        response = service.ask(
            AiAskRequest(query="合成主题域集市有几张表？"),
            profile="strict",
            request_id="metadata-count",
            event_callback=lambda event, data: events.append((event, data)),
        )

        self.assertEqual("metadata_count_answered", response.status)
        self.assertEqual(73, response.metadata_count.value)
        self.assertEqual([{
            "domain_code": "SYNTH",
            "domain_name": "合成主题域",
            "layer_code": "MART",
            "layer_name": "数据集市层",
        }], assets.count_calls)
        self.assertEqual([], rag.calls)
        self.assertEqual([], llm.calls)
        self.assertEqual(
            [("step_start", "metadata-count"), ("step_complete", "metadata-count"), ("answer", "answer")],
            [(event, data["step_id"]) for event, data in events],
        )
        count_event = events[1][1]
        self.assertEqual(73, count_event["data"]["tableCount"])
        self.assertNotIn("planning", [data["step_id"] for event, data in events])
        self.assertNotIn("rag-round-1", [data["step_id"] for event, data in events])

    def test_report_count_short_circuits_planner_rag_and_emits_report_count_sse_contract(self):
        reports = StubReportCountService(value=0)
        service, rag, llm, _assets = self._service(reports=reports)
        events = []

        response = service.ask(
            AiAskRequest(query="有多少份报表？"),
            profile="strict",
            request_id="report-count",
            event_callback=lambda event, data: events.append((event, data)),
        )

        self.assertEqual("metadata_count_answered", response.status)
        self.assertEqual("report_count", response.metadata_count.metric)
        self.assertEqual(0, response.metadata_count.value)
        self.assertEqual("/report-assets", response.metadata_count.source_link)
        self.assertEqual(1, reports.calls)
        self.assertEqual([], rag.calls)
        self.assertEqual([], llm.calls)
        count_event = next(
            data for event, data in events
            if event == "step_complete" and data["step_id"] == "metadata-count"
        )
        self.assertEqual("report_count", count_event["data"]["intent"])
        self.assertEqual(0, count_event["data"]["reportCount"])
        self.assertNotIn("tableCount", count_event["data"])
        self.assertEqual("report_count", events[0][1]["data"]["intent"])

    def test_metadata_count_ambiguity_failure_and_cancellation_never_call_rag_or_model(self):
        service, rag, llm, assets = self._service()
        ambiguous_events = []
        ambiguous = service.ask(
            AiAskRequest(query="未知主题域有几张表？"),
            profile="strict",
            request_id="ambiguous-count",
            event_callback=lambda event, data: ambiguous_events.append((event, data)),
        )
        self.assertEqual("ambiguous_scope", ambiguous.status)
        self.assertIsNone(ambiguous.metadata_count)
        self.assertEqual([], assets.count_calls)
        self.assertTrue(any(event == "step_error" and data["step_id"] == "metadata-count" for event, data in ambiguous_events))

        failed_assets = StubAssetsService(count_error=True)
        failed_service, failed_rag, failed_llm, _assets = self._service(assets=failed_assets)
        unavailable = failed_service.ask(
            AiAskRequest(query="共有多少张数据表？"), profile="strict", request_id="count-failed"
        )
        self.assertEqual("metadata_count_unavailable", unavailable.status)
        self.assertIsNone(unavailable.metadata_count)
        self.assertEqual(1, len(failed_assets.count_calls))
        self.assertEqual([], failed_rag.calls)
        self.assertEqual([], failed_llm.calls)

        cancel_event = threading.Event()
        cancel_event.set()
        cancelled_events = []
        with self.assertRaises(AIAskCancelled):
            service.ask(
                AiAskRequest(query="共有多少张数据表？"),
                profile="strict",
                request_id="count-cancelled",
                event_callback=lambda event, data: cancelled_events.append((event, data)),
                cancel_event=cancel_event,
            )
        self.assertFalse(any(event == "answer" for event, _data in cancelled_events))
        self.assertEqual([], rag.calls)
        self.assertEqual([], llm.calls)

    def test_exact_identifier_uses_a_single_precise_search_without_planner_call(self):
        responses = {"CUSTOMER_ID": search_response("CUSTOMER_ID", [FIELD_7])}
        service, rag, llm, _assets = self._service(
            plan={"queryType": "exact_identifier", "keyConcepts": [], "queries": [], "supplementalQuery": None},
            responses=responses,
        )

        response = service.ask(AiAskRequest(query="CUSTOMER_ID"), profile="strict", request_id="exact")

        self.assertEqual("answered", response.status)
        self.assertEqual(["CUSTOMER_ID"], [call[0] for call in rag.calls])
        self.assertEqual(1, len(llm.calls))
        self.assertEqual("AUTHORITATIVE_FIELD_11", response.candidates[0].field_name)

    def test_invalid_or_unavailable_planning_explicitly_falls_back_to_raw_question(self):
        service, rag, llm, _assets = self._service(
            planning_error=LLMProviderError("llm_timeout"),
            responses={"混合中文 FIELD_CODE 问题": search_response("混合中文 FIELD_CODE 问题", [FIELD_7])},
        )
        events = []

        response = service.ask(
            AiAskRequest(query="混合中文 FIELD_CODE 问题"),
            profile="strict",
            request_id="fallback",
            event_callback=lambda event, data: events.append((event, data)),
        )

        self.assertEqual("answered", response.status)
        self.assertEqual(["混合中文 FIELD_CODE 问题"], [call[0] for call in rag.calls])
        planning = next(data for event, data in events if event == "step_complete" and data["step_id"] == "planning")
        self.assertEqual("raw_query_fallback", planning["data"]["planningMode"])
        self.assertEqual("llm_timeout", planning["data"]["fallbackReason"])
        self.assertEqual(2, len(llm.calls))

    def test_quota_failure_codes_survive_the_execution_stream_contract(self):
        for reason in ("llm_daily_quota_exceeded", "llm_quota_unavailable"):
            with self.subTest(reason=reason):
                service, _rag, _llm, _assets = self._service(
                    answer_error=LLMProviderError(reason),
                    responses={"CUSTOMER_ID": search_response("CUSTOMER_ID", [FIELD_7])},
                )
                response = service.ask(
                    AiAskRequest(query="CUSTOMER_ID"), profile="strict", request_id=f"quota-{reason}"
                )
                self.assertEqual("generation_unavailable", response.status)
                self.assertEqual(reason, response.reason_code)
                if reason == "llm_daily_quota_exceeded":
                    self.assertEqual("今日 AI 问答额度已用完，请明日再试。", response.answer)
                elif reason == "llm_quota_unavailable":
                    self.assertEqual("每日 AI 问答额度服务暂不可用，请稍后重试。", response.answer)

    def test_supplemental_search_runs_once_only_after_zero_authorized_first_round_hits(self):
        plan = {
            "queryType": "natural_language",
            "keyConcepts": ["概念"],
            "queries": ["概念甲", "概念乙"],
            "supplementalQuery": "概念丙",
        }
        responses = {
            "概念甲": search_response("概念甲"),
            "概念乙": search_response("概念乙"),
            "问题在哪个资产？": search_response("问题在哪个资产？"),
            "概念丙": search_response("概念丙", [FIELD_7]),
        }
        service, rag, _llm, _assets = self._service(plan=plan, responses=responses)
        events = []

        response = service.ask(
            AiAskRequest(query="问题在哪个资产？"),
            profile="strict",
            request_id="supplement",
            event_callback=lambda event, data: events.append((event, data)),
        )

        self.assertEqual("answered", response.status)
        self.assertCountEqual(
            ["概念甲", "概念乙", "问题在哪个资产？", "概念丙"],
            [call[0] for call in rag.calls],
        )
        self.assertEqual(4, len({call[3] for call in rag.calls}))
        round_one_complete = next(
            index for index, (event, data) in enumerate(events)
            if event == "step_complete" and data["step_id"] == "rag-round-1"
        )
        round_two_start = next(
            index for index, (event, data) in enumerate(events)
            if event == "step_start" and data["step_id"] == "rag-round-2"
        )
        self.assertLess(round_one_complete, round_two_start)
        round_two = next(data for event, data in events if event == "step_start" and data["step_id"] == "rag-round-2")
        self.assertEqual(1, round_two["data"]["maxRequests"])

    def test_partial_query_failure_keeps_verified_evidence_and_marks_degraded(self):
        plan = {
            "queryType": "natural_language",
            "keyConcepts": ["概念"],
            "queries": ["失败查询", "成功查询"],
            "supplementalQuery": None,
        }
        responses = {
            "失败查询": search_response("失败查询", status="unavailable", reason="timeout"),
            "成功查询": search_response("成功查询", [FIELD_7]),
            "用户问题": search_response("用户问题"),
        }
        service, _rag, _llm, _assets = self._service(plan=plan, responses=responses)

        response = service.ask(AiAskRequest(query="用户问题"), profile="strict", request_id="partial")

        self.assertEqual("partial_answer", response.status)
        self.assertEqual("degraded", response.retrieval_status)
        self.assertEqual([(7, 11)], [(item.asset_id, item.field_id) for item in response.citations])
        self.assertTrue(response.results_truncated)

    def test_related_only_selection_is_partial_without_claiming_results_were_truncated(self):
        plan = {
            "queryType": "natural_language",
            "keyConcepts": ["相关字段"],
            "queries": ["相关字段查询"],
            "supplementalQuery": None,
        }
        service, _rag, _llm, _assets = self._service(
            plan=plan,
            answer={
                "questionType": "general",
                "claims": [{"assetId": 7, "fieldId": 11, "relevance": "related"}],
            },
            responses={
                "相关字段查询": search_response("相关字段查询", [FIELD_7]),
                "这个功能可能使用哪个字段？": search_response("这个功能可能使用哪个字段？"),
            },
        )

        response = service.ask(
            AiAskRequest(query="这个功能可能使用哪个字段？"),
            profile="strict",
            request_id="related-only",
        )

        self.assertEqual("partial_answer", response.status)
        self.assertFalse(response.results_truncated)
        self.assertEqual("available", response.retrieval_status)
        self.assertEqual("related", response.candidates[0].relevance)
        self.assertEqual([(7, 11)], [(item.asset_id, item.field_id) for item in response.citations])

    def test_field_with_wrong_parent_or_missing_detail_never_becomes_evidence(self):
        service, _rag, llm, _assets = self._service(
            plan={
                "queryType": "natural_language",
                "keyConcepts": ["字段"],
                "queries": ["字段查询"],
                "supplementalQuery": None,
            },
            responses={"字段查询": search_response("字段查询", [FIELD_7]), "未知字段问题": search_response("未知字段问题")},
            assets=StubAssetsService(missing_field=True),
        )
        events = []

        response = service.ask(
            AiAskRequest(query="未知字段问题"), profile="strict", request_id="missing-field",
            event_callback=lambda event, data: events.append((event, data)),
        )

        self.assertEqual("retrieval_unavailable", response.status)
        self.assertEqual("asset_verification_unavailable", response.reason_code)
        self.assertEqual([], response.citations)
        self.assertEqual(1, len(llm.calls))  # planner only; no unsupported answer call
        self.assertTrue(any(event == "step_error" and data["step_id"] == "field-7-11" for event, data in events))

    def test_real_search_start_event_is_delivered_before_blocking_retrieval_finishes(self):
        started = threading.Event()
        release = threading.Event()
        query_started = []

        class BlockingRag(StubRagService):
            def recommend(inner_self, query, **kwargs):
                callback = kwargs.get("execution_callback")
                search_id = kwargs.get("search_id")
                if callback:
                    callback("start", {"searchId": search_id, "query": query, "requestCount": 1})
                    query_started.append(query)
                    started.set()
                    release.wait(2)
                    callback("complete", {
                        "searchId": search_id,
                        "query": query,
                        "requestCount": 1,
                        "resultCount": 0,
                        "verifiedCount": 0,
                        "hits": [],
                        "status": "available",
                        "effectiveMode": "auto",
                        "channelsUsed": [],
                    })
                return search_response(query)

        rag = BlockingRag()
        provider = StubLLMProvider(plan={
            "queryType": "natural_language", "keyConcepts": ["问题"],
            "queries": ["规划查询"], "supplementalQuery": None,
        })
        assets = StubAssetsService()
        service = AIAskExecutionService(AIAskService(rag, provider), assets)
        events = []
        thread = threading.Thread(target=lambda: service.ask(
            AiAskRequest(query="等待检索结束的问题"), profile="strict", request_id="live",
            event_callback=lambda event, data: events.append((event, data)),
        ))
        thread.start()
        try:
            self.assertTrue(started.wait(1), "HTTP search must start");
            self.assertTrue(any(event == "step_start" and data["step_id"].startswith("search-") for event, data in events))
            self.assertTrue(thread.is_alive(), "RAG request must still be blocked when start event arrives")
        finally:
            release.set()
            thread.join(2)
        self.assertFalse(thread.is_alive())
        self.assertTrue(query_started)

    def test_cancellation_during_live_rag_search_stops_before_answer_generation(self):
        started = threading.Event()
        release = threading.Event()
        cancel_event = threading.Event()

        class WaitingRag(StubRagService):
            def recommend(inner_self, query, **kwargs):
                callback = kwargs.get("execution_callback")
                if callback:
                    callback("start", {
                        "searchId": kwargs.get("search_id"),
                        "query": query,
                        "requestCount": 1,
                    })
                started.set()
                release.wait(1)
                return search_response(query, status="unavailable", reason="service_unavailable")

        rag = WaitingRag()
        llm = StubLLMProvider(plan={
            "queryType": "natural_language", "keyConcepts": ["问题"],
            "queries": ["取消前查询"], "supplementalQuery": None,
        })
        assets = StubAssetsService()
        service = AIAskExecutionService(AIAskService(rag, llm), assets)
        events = []
        outcome = []

        def run():
            try:
                service.ask(
                    AiAskRequest(query="取消中的问题"),
                    profile="strict",
                    request_id="cancel-live",
                    event_callback=lambda event, data: events.append((event, data)),
                    cancel_event=cancel_event,
                )
            except Exception as error:
                outcome.append(error)

        thread = threading.Thread(target=run)
        thread.start()
        try:
            self.assertTrue(started.wait(1), "a real RAG search should start")
            cancel_event.set()
            release.set()
        finally:
            cancel_event.set()
            release.set()
            thread.join(2)

        self.assertFalse(thread.is_alive())
        self.assertEqual(1, len(outcome))
        self.assertIsInstance(outcome[0], AIAskCancelled)
        self.assertEqual(1, len(llm.calls))  # planner only; no answer generation
        self.assertEqual([], assets.batch_calls)
        self.assertFalse(any(event == "answer" for event, _data in events))

    def test_search_count_and_planning_query_count_are_bounded(self):
        plan = {
            "queryType": "complex",
            "keyConcepts": ["一", "二"],
            "queries": ["查询一", "查询二", "查询三"],
            "supplementalQuery": "补充查询",
        }
        responses = {query: search_response(query) for query in ["查询一", "查询二", "查询三", "边界原问题", "补充查询"]}
        service, rag, _llm, _assets = self._service(plan=plan, responses=responses)

        service.ask(AiAskRequest(query="边界原问题"), profile="strict", request_id="bounds")

        self.assertEqual(4, len(rag.calls))
        self.assertLessEqual(len(rag.calls), 4)
        self.assertLessEqual(len({call[3] for call in rag.calls}), 4)


if __name__ == "__main__":
    unittest.main()
