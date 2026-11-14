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
    ) -> None:
        self._search_provider = search_provider
        self._candidate_catalog_loader = candidate_catalog_loader

    def is_configured(self) -> bool:
        # This is a configuration check, matching the existing External status
        # semantics. Actual database readiness is determined by the bounded
        # search/read in each ask; no network or full-catalog probe is done here.
        return callable(getattr(self._search_provider, "search", None)) and callable(
            self._candidate_catalog_loader
        )

    def load_candidate_catalog(self, *args, **kwargs):
        return self._candidate_catalog_loader(*args, **kwargs)

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
        has_more = False
        relevant_partial_failure = False
        for group in search_result["groups"]:
            if not isinstance(group, dict) or group.get("type") != "asset":
                continue
            has_more = has_more or bool(group.get("hasMore"))
            items = group.get("items")
            if not isinstance(items, list):
                relevant_partial_failure = True
                continue
            for item in items:
                if not isinstance(item, dict):
                    relevant_partial_failure = True
                    continue
                asset_id = _positive_id(item.get("assetId"))
                if asset_id is None:
                    relevant_partial_failure = True
                    continue
                if asset_id not in table_order:
                    table_order.append(asset_id)
                matches = item.get("matchedFields")
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
                # Table-match evidence remains useful even when there is no
                # field-level match; it is never treated as authoritative text.
                table_evidence = [
                    _safe_text(match.get("value"), 256)
                    for match in matches
                    if isinstance(match, dict) and _safe_text(match.get("value"), 256)
                ]
                evidence_by_identity.setdefault((asset_id, None), [])
                for value in table_evidence:
                    if value not in evidence_by_identity[(asset_id, None)]:
                        evidence_by_identity[(asset_id, None)].append(value)

        failed_groups = search_result.get("failedGroups")
        if search_result.get("partial"):
            relevant_partial_failure = relevant_partial_failure or (
                not isinstance(failed_groups, list) or "asset" in failed_groups
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
        self._report(execution_callback, "catalog_start", {
            "searchId": active_search_id,
            "startedAt": _timestamp(),
            "phase": "database",
            "candidateAssetCount": len(table_order),
            "candidateFieldCount": sum(len(values) for values in fields_by_table.values()),
            "databaseCallCount": int(bool(table_order)) + int(bool(fields_by_table)),
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

        self._report(execution_callback, "catalog_complete" if not batch_error else "catalog_error", {
            "searchId": active_search_id,
            "finishedAt": _timestamp(),
            "phase": "database",
            "databaseCallCount": int(bool(table_order)) + int(bool(fields_by_table)),
            "verifiedAssetCount": len(details_by_asset),
            "verifiedFieldCount": sum(
                len(detail.get("fields", []))
                for detail in details_by_asset.values()
                if isinstance(detail.get("fields"), list)
            ),
            **({"errorCode": "visibility_unavailable"} if batch_error else {}),
        })
        if batch_error:
            response = self._unavailable(
                normalized_query, "visibility_unavailable", (time.monotonic() - started) * 1000
            )
            self._report(execution_callback, "complete", {
                "searchId": active_search_id,
                "query": normalized_query,
                "finishedAt": _timestamp(),
                "retrievalMode": "local",
                "requestCount": 0,
                "resultCount": len(table_order),
                "verifiedCount": 0,
                "hits": [],
                "status": "unavailable",
                "errorCode": "visibility_unavailable",
            })
            return response

        recommendations: list[RagRecommendation] = []
        seen: set[tuple[int, int | None]] = set()
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
            identity = (asset_id, None)
            if identity not in seen:
                seen.add(identity)
                recommendations.append(RagRecommendation(
                    **common,
                    assetType="table",
                    name=table_name,
                    matchEvidence=evidence_by_identity.get(identity, [])[:8],
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
                identity = (asset_id, field_id)
                if identity in seen:
                    relevant_partial_failure = True
                    continue
                seen.add(identity)
                recommendations.append(RagRecommendation(
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
                    matchEvidence=evidence_by_identity.get(identity, [])[:8],
                    evidence=["字段、fieldId 和所属表已由当前 DAP 目录核实"],
                ))
            if requested_fields - verified_fields:
                relevant_partial_failure = True

        was_candidate_truncated = len(recommendations) > _MAX_LOCAL_CANDIDATES
        if was_candidate_truncated:
            recommendations = recommendations[:_MAX_LOCAL_CANDIDATES]
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
            "resultCount": len(table_order),
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


__all__ = ["LocalSearchProvider", "ModeAwareRetrievalProvider"]
