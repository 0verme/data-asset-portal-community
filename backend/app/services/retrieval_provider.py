"""Small mode-aware retrieval boundary for the existing AI ask executor."""

from __future__ import annotations

import logging
import time
import uuid
from datetime import UTC, datetime
from typing import Any, Callable

from ..contracts.rag_search import (
    RagRecommendation,
    RagRecommendationsResponse,
    resolve_retrieval_mode,
)
from .rag_search_service import RagSearchService

LOGGER = logging.getLogger(__name__)
_MAX_LOCAL_CANDIDATES = 20
_MAX_LOCAL_FIELD_IDS = 20
_MAX_LOCAL_TABLE_IDS = 20
_MAX_LOCAL_TYPED_IDS_PER_TYPE = 3
_TYPED_LOCAL_ASSET_TYPES = ("report", "indicator", "api")


def _positive_id(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if 0 < value <= 2_147_483_647 else None
    if isinstance(value, str) and value.isdecimal():
        try:
            parsed = int(value)
        except ValueError:
            return None
        return parsed if 0 < parsed <= 2_147_483_647 else None
    return None


def _safe_text(value: Any, limit: int = 2000) -> str:
    if not isinstance(value, str):
        return ""
    return " ".join(value.split())[:limit]


def _timestamp() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class LocalSearchProvider:
    """Use the registered DAP search implementation, then verify its IDs.

    This provider never uses HTTP. It does not contain search SQL; search recall
    is performed by ``SearchProvider.search`` and authoritative metadata is
    loaded through the existing table/field candidate-catalog service.
    """

    def __init__(
        self,
        search_provider: Any,
        candidate_catalog_loader: Callable[..., list[dict[str, Any]]],
        *,
        detail_loaders: dict[str, Callable[[str], dict[str, Any]]] | None = None,
        detail_projectors: dict[str, Callable[[Any, str], Any]] | None = None,
    ) -> None:
        self._search_provider = search_provider
        self._candidate_catalog_loader = candidate_catalog_loader
        self._detail_loaders = dict(detail_loaders or {})
        self._detail_projectors = dict(detail_projectors or {})

    def is_configured(self) -> bool:
        # This is a configuration check, matching the existing External status
        # semantics. Actual database readiness is determined by the bounded
        # search/read in each ask; no network or full-catalog probe is done here.
        return callable(getattr(self._search_provider, "search", None)) and callable(
            self._candidate_catalog_loader
        )

    def load_candidate_catalog(self, *args, **kwargs):
        return self._candidate_catalog_loader(*args, **kwargs)

    def load_candidate_detail(self, asset_type: str, asset_id: str, *, profile: str) -> dict[str, Any]:
        loader = self._detail_loaders.get(asset_type)
        if asset_type not in _TYPED_LOCAL_ASSET_TYPES or not callable(loader):
            raise ValueError("unsupported_candidate_type")
        detail = loader(asset_id)
        projector = self._detail_projectors.get(asset_type)
        if callable(projector):
            detail = projector(detail, profile)
        if not isinstance(detail, dict):
            raise ValueError("invalid_candidate_detail")
        return detail

    def verify_candidate_detail(
        self,
        asset_type: str,
        asset_id: str,
        *,
        profile: str,
        match_evidence: list[str] | None = None,
    ) -> RagRecommendation | None:
        if asset_type not in _TYPED_LOCAL_ASSET_TYPES:
            raise ValueError("unsupported_candidate_type")
        return self._typed_recommendation(
            asset_type, asset_id, match_evidence or [], profile=profile
        )

    @staticmethod
    def _unavailable(query: str, reason: str, elapsed_ms: float) -> RagRecommendationsResponse:
        return RagRecommendationsResponse(
            query=query,
            status="unavailable",
            recommendations=[],
            count=0,
            elapsedMs=max(0.0, elapsed_ms),
            reasonCode=reason,
        )

    @staticmethod
    def _report(
        callback: Callable[[str, dict[str, Any]], None] | None,
        event: str,
        data: dict[str, Any],
    ) -> None:
        if callback is None:
            return
        try:
            callback(event, data)
        except Exception:
            # Progress reporting never changes retrieval behavior.
            return

    @staticmethod
    def _stable_code(value: Any) -> str:
        if isinstance(value, bool) or not isinstance(value, (str, int)):
            return ""
        code = str(value).strip()
        if not code or len(code) > 128 or any(ord(char) < 32 for char in code):
            return ""
        return code

    @staticmethod
    def _metadata_summary(parts: list[tuple[str, Any]], *, limit: int = 2000) -> str:
        values = []
        for label, raw_value in parts:
            text = _safe_text(raw_value, 500)
            if text:
                values.append(f"{label}：{text}")
        return _safe_text("；".join(values), limit)

    def _typed_recommendation(
        self,
        asset_type: str,
        hint_id: str,
        match_evidence: list[str],
        *,
        profile: str,
    ) -> RagRecommendation | None:
        detail = self.load_candidate_detail(asset_type, hint_id, profile=profile)
        identity_key = {"report": "code", "indicator": "id", "api": "code"}[asset_type]
        canonical_id = self._stable_code(detail.get(identity_key))
        if not canonical_id or canonical_id.casefold() != hint_id.casefold():
            return None
        display_name = _safe_text(detail.get("name"), 256) or canonical_id
        domain = ""
        if asset_type == "report":
            domain = _safe_text(detail.get("domain"), 256)
            description = self._metadata_summary([
                ("报表类型", detail.get("type")),
                ("主题域", detail.get("domain")),
                ("统计周期", detail.get("freq")),
                ("统计对象", detail.get("statObject")),
                ("用途", detail.get("purpose")),
                ("业务范围", detail.get("businessScopeTags")),
                ("统计口径", detail.get("statCaliber")),
                ("筛选条件", detail.get("filterCondition")),
            ])
        elif asset_type == "indicator":
            domain = _safe_text(detail.get("dimension"), 256)
            description = self._metadata_summary([
                ("业务含义", detail.get("meaning")),
                ("维度", detail.get("dimension")),
                ("口径", detail.get("caliber")),
                ("计算路径", detail.get("path")),
                ("聚合方式", detail.get("aggregation")),
            ])
        else:
            system = detail.get("system") if isinstance(detail.get("system"), dict) else {}
            params = detail.get("params") if isinstance(detail.get("params"), list) else []
            response_fields = detail.get("responseFields") if isinstance(detail.get("responseFields"), list) else []
            param_summary = ", ".join(
                _safe_text(param.get("name"), 96)
                for param in params[:8]
                if isinstance(param, dict) and _safe_text(param.get("name"), 96)
            )
            response_summary = ", ".join(
                _safe_text(field.get("name"), 96)
                for field in response_fields[:8]
                if isinstance(field, dict) and _safe_text(field.get("name"), 96)
            )
            domain = _safe_text(system.get("name"), 256) or _safe_text(detail.get("ownerDept"), 256)
            description = self._metadata_summary([
                ("请求方法", detail.get("method")),
                ("路径", detail.get("path")),
                ("版本", detail.get("version")),
                ("所属系统", system.get("name")),
                ("说明", detail.get("description")),
                ("参数", param_summary),
                ("响应字段", response_summary),
            ])
        return RagRecommendation(
            assetId=canonical_id,
            assetType=asset_type,
            name=canonical_id,
            displayName=display_name,
            description=description,
            domain=domain,
            layer="",
            retrievalSource="local",
            matchEvidence=match_evidence[:8],
            evidence=["已按类型化稳定 ID 读取并核实当前 DAP 权威详情"],
        )

    def recommend(
        self,
        query: str,
        *,
        profile: str,
        top_k: int | None = None,
        cancel_event: Any | None = None,
        search_id: str | None = None,
        execution_callback: Callable[[str, dict[str, Any]], None] | None = None,
    ) -> RagRecommendationsResponse:
        normalized_query = str(query or "").strip()
        started = time.monotonic()
        if cancel_event is not None and cancel_event.is_set():
            return self._unavailable(normalized_query, "service_unavailable", 0)
        if not normalized_query:
            return RagRecommendationsResponse(
                query="", status="available", recommendations=[], count=0,
                elapsedMs=0, reasonCode="empty_query",
            )
        if profile == "disabled":
            return self._unavailable(
                normalized_query, "visibility_unavailable", (time.monotonic() - started) * 1000
            )

        normalized_top_k = 5
        if top_k is not None:
            try:
                normalized_top_k = max(1, min(10, int(top_k)))
            except (TypeError, ValueError):
                normalized_top_k = 5
        active_search_id = search_id or uuid.uuid4().hex[:16]
        self._report(execution_callback, "start", {
            "searchId": active_search_id,
            "query": normalized_query,
            "startedAt": _timestamp(),
            "retrievalMode": "local",
            "requestCount": 0,
        })

        try:
            # One call to the same in-process keyword search used by the portal.
            # Field IDs are opt-in internal metadata; GET /api/search leaves its
            # default item/matchedFields shape unchanged.
            search_result = self._search_provider.search(
                normalized_query,
                scope="all",
                limit=normalized_top_k,
                profile=profile,
                include_field_ids=True,
            )
            if cancel_event is not None and cancel_event.is_set():
                return self._unavailable(
                    normalized_query, "service_unavailable", (time.monotonic() - started) * 1000
                )
        except Exception:
            LOGGER.warning("Local keyword search failed without exposing catalog details")
            response = self._unavailable(
                normalized_query, "service_unavailable", (time.monotonic() - started) * 1000
            )
            self._report(execution_callback, "complete", {
                "searchId": active_search_id,
                "query": normalized_query,
                "finishedAt": _timestamp(),
                "retrievalMode": "local",
                "requestCount": 0,
                "resultCount": 0,
                "verifiedCount": 0,
                "hits": [],
                "status": "unavailable",
                "errorCode": "unavailable",
            })
            return response

        if not isinstance(search_result, dict) or not isinstance(search_result.get("groups"), list):
            response = self._unavailable(
                normalized_query, "invalid_response", (time.monotonic() - started) * 1000
            )
            self._report(execution_callback, "complete", {
                "searchId": active_search_id,
                "query": normalized_query,
                "finishedAt": _timestamp(),
                "retrievalMode": "local",
                "requestCount": 0,
                "resultCount": 0,
                "verifiedCount": 0,
                "hits": [],
                "status": "unavailable",
                "errorCode": "invalid_response",
            })
            return response

        table_order: list[int] = []
        fields_by_table: dict[int, set[int]] = {}
        evidence_by_identity: dict[tuple[int, int | None], list[str]] = {}
        typed_hints: dict[str, list[tuple[str, list[str]]]] = {
            asset_type: [] for asset_type in _TYPED_LOCAL_ASSET_TYPES
        }
        has_more = False
        relevant_partial_failure = False
        relevant_group_types = {"asset", *_TYPED_LOCAL_ASSET_TYPES}
        for group in search_result["groups"]:
            if not isinstance(group, dict) or group.get("type") not in relevant_group_types:
                continue
            group_type = group["type"]
            has_more = has_more or bool(group.get("hasMore"))
            items = group.get("items")
            if not isinstance(items, list):
                relevant_partial_failure = True
                continue
            for item in items:
                if not isinstance(item, dict):
                    relevant_partial_failure = True
                    continue
                matches = item.get("matchedFields")
                evidence = [
                    value for match in (matches if isinstance(matches, list) else [])
                    if isinstance(match, dict)
                    if (value := _safe_text(match.get("value"), 256))
                ]
                if group_type in _TYPED_LOCAL_ASSET_TYPES:
                    raw_id = item.get("ref")
                    if isinstance(raw_id, bool) or not isinstance(raw_id, (str, int)):
                        relevant_partial_failure = True
                        continue
                    stable_id = str(raw_id).strip()
                    if not stable_id or len(stable_id) > 128 or any(ord(char) < 32 for char in stable_id):
                        relevant_partial_failure = True
                        continue
                    if all(existing_id != stable_id for existing_id, _ in typed_hints[group_type]):
                        typed_hints[group_type].append((stable_id, evidence[:8]))
                    continue

                asset_id = _positive_id(item.get("assetId"))
                if asset_id is None:
                    relevant_partial_failure = True
                    continue
                if asset_id not in table_order:
                    table_order.append(asset_id)
                if not isinstance(matches, list):
                    continue
                for match in matches:
                    if not isinstance(match, dict):
                        continue
                    field_id = _positive_id(match.get("fieldId"))
                    value = _safe_text(match.get("value"), 256)
                    if field_id is None or not value:
                        continue
                    fields_by_table.setdefault(asset_id, set()).add(field_id)
                    evidence_by_identity.setdefault((asset_id, field_id), [])
                    if value not in evidence_by_identity[(asset_id, field_id)]:
                        evidence_by_identity[(asset_id, field_id)].append(value)
                evidence_by_identity.setdefault((asset_id, None), [])
                for value in evidence:
                    if value not in evidence_by_identity[(asset_id, None)]:
                        evidence_by_identity[(asset_id, None)].append(value)

        failed_groups = search_result.get("failedGroups")
        if search_result.get("partial"):
            relevant_partial_failure = relevant_partial_failure or (
                not isinstance(failed_groups, list)
                or bool(relevant_group_types.intersection(failed_groups))
            )
        if len(table_order) > _MAX_LOCAL_TABLE_IDS:
            table_order = table_order[:_MAX_LOCAL_TABLE_IDS]
            has_more = True
        field_total = sum(len(values) for values in fields_by_table.values())
        if field_total > _MAX_LOCAL_FIELD_IDS:
            remaining = _MAX_LOCAL_FIELD_IDS
            bounded_fields: dict[int, set[int]] = {}
            for asset_id in table_order:
                values = sorted(fields_by_table.get(asset_id, set()))
                selected = values[:remaining]
                if selected:
                    bounded_fields[asset_id] = set(selected)
                    remaining -= len(selected)
                if remaining <= 0:
                    break
            fields_by_table = bounded_fields
            has_more = True

        if cancel_event is not None and cancel_event.is_set():
            return self._unavailable(
                normalized_query, "service_unavailable", (time.monotonic() - started) * 1000
            )
        typed_detail_count = sum(
            min(len(items), _MAX_LOCAL_TYPED_IDS_PER_TYPE)
            for items in typed_hints.values()
        )
        self._report(execution_callback, "catalog_start", {
            "searchId": active_search_id,
            "startedAt": _timestamp(),
            "phase": "database",
            "candidateAssetCount": len(table_order) + sum(len(items) for items in typed_hints.values()),
            "candidateFieldCount": sum(len(values) for values in fields_by_table.values()),
            "databaseCallCount": int(bool(table_order)) + typed_detail_count,
        })

        details_by_asset: dict[int, dict[str, Any]] = {}
        batch_error = False
        if table_order:
            try:
                details = self.load_candidate_catalog(
                    table_order,
                    fields_by_table,
                    profile=profile,
                    cancel_event=cancel_event,
                )
                if not isinstance(details, list):
                    raise ValueError("invalid_candidate_catalog")
                for detail in details:
                    if not isinstance(detail, dict):
                        relevant_partial_failure = True
                        continue
                    asset_id = _positive_id(detail.get("assetId"))
                    if (
                        asset_id not in table_order
                        or asset_id in details_by_asset
                        or not isinstance(detail.get("name"), str)
                        or not detail.get("name", "").strip()
                        or not isinstance(detail.get("fields"), list)
                    ):
                        relevant_partial_failure = True
                        continue
                    details_by_asset[asset_id] = detail
            except Exception:
                if cancel_event is not None and cancel_event.is_set():
                    return self._unavailable(
                        normalized_query, "service_unavailable", (time.monotonic() - started) * 1000
                    )
                LOGGER.warning("Local authoritative metadata lookup failed without exposing catalog details")
                batch_error = True

        if batch_error:
            self._report(execution_callback, "catalog_error", {
                "searchId": active_search_id,
                "finishedAt": _timestamp(),
                "phase": "database",
                "databaseCallCount": int(bool(table_order)),
                "verifiedAssetCount": 0,
                "verifiedFieldCount": 0,
                "errorCode": "visibility_unavailable",
            })
            response = self._unavailable(
                normalized_query, "visibility_unavailable", (time.monotonic() - started) * 1000
            )
            self._report(execution_callback, "complete", {
                "searchId": active_search_id,
                "query": normalized_query,
                "finishedAt": _timestamp(),
                "retrievalMode": "local",
                "requestCount": 0,
                "resultCount": len(table_order) + sum(len(items) for items in typed_hints.values()),
                "verifiedCount": 0,
                "hits": [],
                "status": "unavailable",
                "errorCode": "visibility_unavailable",
            })
            return response

        recommendations_by_type: dict[str, list[RagRecommendation]] = {
            asset_type: [] for asset_type in ("table", "field", *_TYPED_LOCAL_ASSET_TYPES)
        }
        seen: set[tuple[str, int | str, int | None]] = set()
        for asset_id in table_order:
            detail = details_by_asset.get(asset_id)
            if detail is None:
                relevant_partial_failure = True
                continue
            table_name = _safe_text(detail.get("name"), 256)
            if not table_name:
                relevant_partial_failure = True
                continue
            display = _safe_text(detail.get("cn"), 256) or table_name
            description = _safe_text(detail.get("desc"), 2000)
            common = {
                "assetId": asset_id,
                "displayName": display,
                "description": description,
                "domain": _safe_text(detail.get("domain"), 256),
                "layer": _safe_text(detail.get("layer"), 32),
                "retrievalSource": "local",
                "evidence": ["已由当前 DAP 目录核实"],
            }
            identity = ("table", asset_id, None)
            if identity not in seen:
                seen.add(identity)
                recommendations_by_type["table"].append(RagRecommendation(
                    **common,
                    assetType="table",
                    name=table_name,
                    matchEvidence=evidence_by_identity.get((asset_id, None), [])[:8],
                ))
            requested_fields = fields_by_table.get(asset_id, set())
            verified_fields: set[int] = set()
            fields_by_id: dict[int, dict[str, Any]] = {}
            ambiguous_field_ids: set[int] = set()
            for field in detail["fields"]:
                if not isinstance(field, dict):
                    relevant_partial_failure = True
                    continue
                field_id = _positive_id(field.get("fieldId"))
                if field_id is None or field_id not in requested_fields:
                    continue
                field_asset_id = _positive_id(field.get("assetId"))
                if field_asset_id != asset_id:
                    relevant_partial_failure = True
                    continue
                if field_id in fields_by_id:
                    fields_by_id.pop(field_id, None)
                    ambiguous_field_ids.add(field_id)
                    relevant_partial_failure = True
                    continue
                if field_id not in ambiguous_field_ids:
                    fields_by_id[field_id] = field
            for field_id in requested_fields:
                if field_id in ambiguous_field_ids:
                    continue
                field = fields_by_id.get(field_id)
                field_name = _safe_text(field.get("name"), 256) if field else ""
                if not field_name:
                    relevant_partial_failure = True
                    continue
                verified_fields.add(field_id)
                identity = ("field", asset_id, field_id)
                if identity in seen:
                    relevant_partial_failure = True
                    continue
                seen.add(identity)
                recommendations_by_type["field"].append(RagRecommendation(
                    assetId=asset_id,
                    fieldId=field_id,
                    assetType="field",
                    name=field_name,
                    displayName=_safe_text(field.get("cn"), 256) or field_name,
                    description=_safe_text(field.get("description"), 2000),
                    domain=common["domain"],
                    layer=common["layer"],
                    relatedTable={
                        "assetId": asset_id,
                        "name": table_name,
                        "displayName": display,
                        "description": description,
                        "domain": common["domain"],
                        "layer": common["layer"],
                    },
                    retrievalSource="local",
                    matchEvidence=evidence_by_identity.get((asset_id, field_id), [])[:8],
                    evidence=["字段、fieldId 和所属表已由当前 DAP 目录核实"],
                ))
            if requested_fields - verified_fields:
                relevant_partial_failure = True

        for asset_type in _TYPED_LOCAL_ASSET_TYPES:
            hints = typed_hints[asset_type]
            if len(hints) > _MAX_LOCAL_TYPED_IDS_PER_TYPE:
                has_more = True
            for hint_id, match_evidence in hints[:_MAX_LOCAL_TYPED_IDS_PER_TYPE]:
                if cancel_event is not None and cancel_event.is_set():
                    return self._unavailable(
                        normalized_query, "service_unavailable", (time.monotonic() - started) * 1000
                    )
                identity = (asset_type, hint_id, None)
                try:
                    candidate = self._typed_recommendation(
                        asset_type, hint_id, match_evidence, profile=profile
                    )
                except Exception:
                    candidate = None
                    LOGGER.warning(
                        "Local typed asset verification failed asset_type=%s",
                        asset_type,
                    )
                if candidate is None:
                    relevant_partial_failure = True
                    continue
                if identity in seen:
                    relevant_partial_failure = True
                    continue
                seen.add(identity)
                recommendations_by_type[asset_type].append(candidate)

        self._report(execution_callback, "catalog_complete", {
            "searchId": active_search_id,
            "finishedAt": _timestamp(),
            "phase": "database",
            "databaseCallCount": int(bool(table_order)) + typed_detail_count,
            "verifiedAssetCount": len(details_by_asset) + sum(
                len(recommendations_by_type[asset_type])
                for asset_type in _TYPED_LOCAL_ASSET_TYPES
            ),
            "verifiedFieldCount": sum(
                len(detail.get("fields", []))
                for detail in details_by_asset.values()
                if isinstance(detail.get("fields"), list)
            ),
        })
        recommendations: list[RagRecommendation] = []
        recommendation_order = ("table", "field", *_TYPED_LOCAL_ASSET_TYPES)
        max_per_type = max((len(items) for items in recommendations_by_type.values()), default=0)
        for rank in range(max_per_type):
            for asset_type in recommendation_order:
                candidates_for_type = recommendations_by_type[asset_type]
                if rank < len(candidates_for_type):
                    recommendations.append(candidates_for_type[rank])
                    if len(recommendations) >= _MAX_LOCAL_CANDIDATES:
                        break
            if len(recommendations) >= _MAX_LOCAL_CANDIDATES:
                break
        was_candidate_truncated = sum(map(len, recommendations_by_type.values())) > len(recommendations)
        results_truncated = has_more or was_candidate_truncated
        status = "degraded" if relevant_partial_failure or results_truncated else "available"
        reason_code = (
            "partial_search_failure" if relevant_partial_failure
            else "results_truncated" if results_truncated
            else None
        )
        response = RagRecommendationsResponse(
            query=normalized_query,
            status=status,
            recommendations=recommendations,
            count=len(recommendations),
            elapsedMs=(time.monotonic() - started) * 1000,
            reasonCode=reason_code,
            resultsTruncated=results_truncated,
        )
        hits = []
        for rank, item in enumerate(recommendations, start=1):
            hits.append({
                "rank": rank,
                "assetId": item.asset_id,
                "fieldId": item.field_id,
                "entityType": item.asset_type,
                "name": item.name,
                "retrievalChannels": ["local_keyword"],
                "matchedTerms": list(item.match_evidence),
            })
        self._report(execution_callback, "complete", {
            "searchId": active_search_id,
            "query": normalized_query,
            "startedAt": _timestamp(),
            "finishedAt": _timestamp(),
            "retrievalMode": "local",
            "requestedMode": "local",
            "effectiveMode": "local",
            "channelsUsed": ["local_keyword"],
            "requestCount": 0,
            "resultCount": len(table_order) + sum(len(items) for items in typed_hints.values()),
            "verifiedCount": len(recommendations),
            "hits": hits,
            "status": status,
            "errorCode": reason_code,
            "resultsTruncated": results_truncated,
        })
        return response


class ModeAwareRetrievalProvider:
    """Select Local or the existing External adapter without fallback."""

    def __init__(
        self,
        local_provider: LocalSearchProvider,
        external_provider: RagSearchService,
        config_getter: Callable[[], dict[str, Any]],
    ) -> None:
        self._local_provider = local_provider
        self._external_provider = external_provider
        self._config_getter = config_getter

    def selected_mode(self) -> str:
        return resolve_retrieval_mode(self._config_getter())

    def _selected_provider(self):
        return self._local_provider if self.selected_mode() == "local" else self._external_provider

    def is_configured(self) -> bool:
        try:
            provider = self._selected_provider()
            return bool(provider.is_configured())
        except Exception:
            return False

    def recommend(self, *args, **kwargs) -> RagRecommendationsResponse:
        try:
            provider = self._selected_provider()
        except Exception:
            query = str(args[0] if args else kwargs.get("query") or "")
            return LocalSearchProvider._unavailable(query, "invalid_response", 0)
        return provider.recommend(*args, **kwargs)

    def load_candidate_catalog(self, *args, **kwargs):
        # The local catalog reader is a DAP service call, not an External adapter
        # operation. The executor reuses it for its final identity check.
        return self._local_provider.load_candidate_catalog(*args, **kwargs)

    def load_candidate_detail(self, *args, **kwargs):
        # Typed detail reads are in-process DAP authority checks, never External
        # retrieval calls, and can therefore be reused by the final verifier.
        return self._local_provider.load_candidate_detail(*args, **kwargs)

    def verify_candidate_detail(self, *args, **kwargs):
        return self._local_provider.verify_candidate_detail(*args, **kwargs)


__all__ = ["LocalSearchProvider", "ModeAwareRetrievalProvider"]
