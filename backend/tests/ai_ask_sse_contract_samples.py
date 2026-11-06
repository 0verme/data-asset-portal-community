"""Deterministic, real-pipeline samples of the AI ask SSE event contract.

Every event payload produced here comes from production code:

* ``AIAskExecutionService.ask`` -> ``_ExecutionEvents.emit`` (planning, rag-round-*,
  merge, verification, asset-*, field-*, generating, answer)
* ``RagSearchService.recommend`` -> ``report_execution`` (search-*, catalog-*)
* ``build_done_data`` (the ``done`` terminal event used by the router)

Nothing is hand-written: the RAG layer is the real ``RagSearchService`` driven by
an ``httpx.MockTransport`` so the catalog/search payloads (``phase``,
``candidateAssetCount``, ``databaseCallCount``, ``stageTimings``,
``verifiedAssetCount``, ...) come from the same ``report_execution`` calls that
run in production.

Only genuinely non-deterministic values are normalised so the sample can be
committed and compared in CI: timestamps, wall-clock durations, and the random
per-search ids. Query execution order is forced so parallel searches cannot
interleave differently between runs.
"""

from __future__ import annotations

import json
import threading
from typing import Any

import httpx

from backend.app.contracts.ai_ask import AiAskRequest
from backend.app.services.ai_ask_execution_service import (
    AIAskExecutionService,
    build_done_data,
    done_status_for_result,
)
from backend.app.services.ai_ask_service import AIAskService
from backend.app.services.rag_search_http_client import RagSearchHttpClient
from backend.app.services.rag_search_service import RagSearchService

FIXED_TIMESTAMP = "2026-01-01T00:00:00.000Z"
FIXED_REQUEST_ID = "0123456789abcdef0123456789abcdef"

_TIMESTAMP_KEYS = frozenset({"timestamp", "startedAt", "finishedAt"})
_DURATION_KEYS = frozenset({"durationMs", "elapsedMs", "httpSearchMs", "catalogValidationMs"})

#: Authoritative DAP catalog used by the fake assets service.
CATALOG: list[dict[str, Any]] = [
    {
        "assetId": 7,
        "name": "DWS_LOAN_BALANCE",
        "cn": "贷款余额表",
        "desc": "按客户与账期汇总的贷款余额。",
        "domain": "信贷",
        "layer": "DWS",
        "fields": [
            {
                "assetId": 7,
                "fieldId": 11,
                "name": "BALANCE_AMT",
                "cn": "贷款余额",
                "description": "账期期末贷款余额。",
            },
            {
                "assetId": 7,
                "fieldId": 12,
                "name": "CUSTOMER_ID",
                "cn": "客户编号",
                "description": "客户唯一编号。",
            },
        ],
    },
    {
        "assetId": 8,
        "name": "DWD_LOAN_CONTRACT",
        "cn": "贷款合同表",
        "desc": "贷款合同主档。",
        "domain": "信贷",
        "layer": "DWD",
        "fields": [
            {
                "assetId": 8,
                "fieldId": 21,
                "name": "CONTRACT_NO",
                "cn": "合同编号",
                "description": "贷款合同编号。",
            },
        ],
    },
]


class _FakeAssetsService:
    """Minimal authoritative catalog reader with the real service surface."""

    def __init__(self, catalog: list[dict[str, Any]] | None = None) -> None:
        self.catalog = CATALOG if catalog is None else catalog
        self.calls: list[Any] = []

    def get_asset_tables(self) -> list[dict[str, Any]]:
        self.calls.append("get_asset_tables")
        return self.catalog

    def get_rag_candidate_catalog(
        self,
        asset_ids: list[int],
        field_ids_by_asset: dict[int, set[int]] | None = None,
    ) -> list[dict[str, Any]]:
        field_ids_by_asset = field_ids_by_asset or {}
        self.calls.append(("get_rag_candidate_catalog", list(asset_ids)))
        projected: list[dict[str, Any]] = []
        for item in self.catalog:
            if item["assetId"] not in asset_ids:
                continue
            entry = dict(item)
            entry["fields"] = [
                field
                for field in item.get("fields", [])
                if field.get("fieldId") in field_ids_by_asset.get(item["assetId"], set())
            ]
            projected.append(entry)
        return projected


class _FakeLlmProvider:
    """Structured planner + evidence-selection responses used by the real service."""

    def __init__(self, plan: dict[str, Any], answer: dict[str, Any]) -> None:
        self.plan = plan
        self.answer = answer
        self.calls: list[tuple[str, Any]] = []

    def is_enabled(self) -> bool:
        return True

    def complete_json(self, *, system_prompt, user_payload, cancel_event=None):
        self.calls.append((system_prompt, user_payload))
        if "检索查询规划器" in system_prompt:
            return json.dumps(self.plan, ensure_ascii=False)
        return json.dumps(self.answer, ensure_ascii=False)


class _OrderedRagService:
    """Serialize real RAG searches so the captured event order is deterministic."""

    def __init__(self, inner: RagSearchService, order: list[str]) -> None:
        self._inner = inner
        self._order = list(order)
        self._condition = threading.Condition()
        self._next = 0

    def is_configured(self) -> bool:
        return self._inner.is_configured()

    def recommend(self, query: str, **kwargs: Any):
        index = self._order.index(query)
        with self._condition:
            while self._next != index:
                self._condition.wait(timeout=30)
        try:
            return self._inner.recommend(query, **kwargs)
        finally:
            with self._condition:
                self._next += 1
                self._condition.notify_all()


def _search_hits(query: str, asset_ids: tuple[int, ...]) -> list[dict[str, Any]]:
    """Build RAG HTTP Search v1 hits for the requested authoritative assets."""
    if not asset_ids:
        return []
    candidates: list[dict[str, Any]] = [
        {"entityType": "table", "assetId": 7, "name": "REMOTE_TABLE_7"},
        {"entityType": "field", "assetId": 7, "fieldId": 11, "name": "REMOTE_FIELD_11"},
        {"entityType": "field", "assetId": 8, "fieldId": 21, "name": "REMOTE_FIELD_21"},
    ]
    hits: list[dict[str, Any]] = []
    rank = 0
    for candidate in candidates:
        if candidate["assetId"] not in asset_ids:
            continue
        rank += 1
        hits.append({
            **candidate,
            "retrievalChannels": ["vector", "bm25"] if rank == 1 else ["bm25"],
            "score": round(1.0 - rank / 10, 3),
            "evidence": [{
                "channel": "bm25",
                "rank": rank,
                "rawScore": round(1.0 - rank / 20, 3),
                "matchedTerms": [f"{query} 命中词{rank}"],
            }],
        })
    return hits


def _transport(hits_by_query: dict[str, tuple[int, ...]]) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        query = body["query"]
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
            "results": _search_hits(query, hits_by_query.get(query, ())),
        })

    return httpx.MockTransport(handler)


_CONFIG = {
    "enabled": True,
    "serviceUrl": "https://rag.example.invalid",
    "strategy": "hybrid",
    "topK": 5,
    "timeoutMs": 2000,
}


def _collect_search_ids(events: list[tuple[str, dict[str, Any]]]) -> dict[str, str]:
    found: dict[str, str] = {}
    for _event, payload in events:
        step_id = payload.get("step_id")
        if isinstance(step_id, str):
            for prefix in ("search-", "catalog-"):
                if step_id.startswith(prefix):
                    candidate = step_id[len(prefix):]
                    if candidate and candidate not in found:
                        found[candidate] = f"searchid{len(found) + 1:04d}"
        data = payload.get("data")
        if isinstance(data, dict) and isinstance(data.get("searchId"), str):
            candidate = data["searchId"]
            if candidate not in found:
                found[candidate] = f"searchid{len(found) + 1:04d}"
    return found


def _normalize(key: str, value: Any, search_ids: dict[str, str]) -> Any:
    if key in _TIMESTAMP_KEYS and isinstance(value, str):
        return FIXED_TIMESTAMP
    if key in _DURATION_KEYS and isinstance(value, (int, float)) and not isinstance(value, bool):
        return 1.0
    if key == "request_id" and isinstance(value, str):
        return FIXED_REQUEST_ID
    if isinstance(value, str):
        for raw, placeholder in search_ids.items():
            value = value.replace(raw, placeholder)
        return value
    if isinstance(value, list):
        return [_normalize(key, item, search_ids) for item in value]
    if isinstance(value, dict):
        return {inner: _normalize(inner, item, search_ids) for inner, item in value.items()}
    return value


def capture_scenario(
    name: str,
    query: str,
    *,
    plan: dict[str, Any],
    answer: dict[str, Any],
    hits_by_query: dict[str, tuple[int, ...]],
    search_order: list[str],
) -> dict[str, Any]:
    """Run the real pipeline once and return a normalized contract sample."""
    client = httpx.Client(
        transport=_transport(hits_by_query),
        follow_redirects=False,
        trust_env=False,
    )
    assets = _FakeAssetsService()
    rag = RagSearchService(
        assets,
        lambda: _CONFIG,
        lambda: "test-server-token",
        http_client=RagSearchHttpClient(client=client),
    )
    llm = _FakeLlmProvider(plan, answer)
    ordered_rag = _OrderedRagService(rag, search_order)
    service = AIAskExecutionService(
        AIAskService(ordered_rag, llm, assets_service=assets),
        assets,
    )

    events: list[tuple[str, dict[str, Any]]] = []
    lock = threading.Lock()

    def capture(event: str, payload: dict[str, Any]) -> None:
        with lock:
            events.append((event, payload))

    result = service.ask(
        AiAskRequest(query=query),
        profile="strict",
        request_id=FIXED_REQUEST_ID,
        event_callback=capture,
    )
    events.append((
        "done",
        {
            "request_id": FIXED_REQUEST_ID,
            "step_id": "done",
            "timestamp": FIXED_TIMESTAMP,
            "message": "问答执行完成。" if done_status_for_result(result) == "completed" else "问答执行失败。",
            "data": build_done_data(
                status=done_status_for_result(result),
                step_count=len({
                    payload.get("step_id")
                    for _event, payload in events
                    if payload.get("step_id") not in {None, "answer", "done"}
                }),
                reason_code=result.reason_code,
            ),
        },
    ))

    search_ids = _collect_search_ids(events)
    normalized = [
        {
            "event": event,
            "data": json.dumps(
                _normalize("", payload, search_ids),
                ensure_ascii=False,
                separators=(",", ":"),
            ),
        }
        for event, payload in events
    ]
    return {
        "name": name,
        "query": query,
        "responseStatus": result.status,
        "doneReasonCode": result.reason_code,
        "events": normalized,
    }


#: `123` — an identifier-shaped question that legitimately finds no evidence.
INSUFFICIENT_EVIDENCE = {
    "plan": {
        "queryType": "natural_language",
        "keyConcepts": ["123"],
        "queries": ["123"],
        "supplementalQuery": None,
    },
    "answer": {"questionType": "field_explanation", "claims": []},
    "hits_by_query": {"123": ()},
    "search_order": ["123"],
}

#: `贷款余额在哪个表？` — multi-query RAG plus catalog verification and generation.
MULTI_QUERY_RAG = {
    "plan": {
        "queryType": "natural_language",
        "keyConcepts": ["贷款余额", "数据表"],
        "queries": ["贷款余额表", "贷款余额字段"],
        "supplementalQuery": "贷款余额汇总表",
    },
    "answer": {
        "questionType": "asset_location",
        "claims": [
            {"assetId": 7, "fieldId": 11, "relevance": "direct"},
            {"assetId": 8, "fieldId": 21, "relevance": "related"},
        ],
    },
    "hits_by_query": {
        "贷款余额表": (7, 8),
        "贷款余额字段": (7, 8),
        "贷款余额在哪个表？": (7, 8),
    },
    "search_order": ["贷款余额表", "贷款余额字段", "贷款余额在哪个表？"],
}


def build_contract_samples() -> dict[str, Any]:
    """Return the full contract fixture payload."""
    return {
        "generatedBy": "backend/tests/test_ai_ask_sse_contract.py",
        "note": (
            "由真实 AIAskExecutionService + RagSearchService 生成；"
            "仅归一化时间戳、耗时与随机 searchId。请勿手改，"
            "运行 AI_ASK_SSE_FIXTURE_UPDATE=1 重新生成。"
        ),
        "scenarios": [
            capture_scenario("insufficient_evidence", "123", **INSUFFICIENT_EVIDENCE),
            capture_scenario("multi_query_rag", "贷款余额在哪个表？", **MULTI_QUERY_RAG),
        ],
    }
