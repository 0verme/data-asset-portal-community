"""HTTP-only RAG adapter with request-scoped public-catalog authorization.

DAP never imports dap-rag-lab, loads a model, opens LanceDB, or shells out to a
CLI. The adapter speaks HTTP Search Service v1; every returned ID is rebuilt
from DAP's current public catalog before it is exposed.
"""

from __future__ import annotations

import logging
import re
import threading
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Callable

from pydantic import ValidationError

from ..contracts.rag_search import (
    RagHttpSearchHit,
    RagRecommendation,
    RagRecommendationsResponse,
    RagRelatedTable,
    RagSearchConfig,
)
from ..fastapi.public_catalog import project_public_catalog_value
from .rag_search_http_client import RagHttpClientError, RagSearchHttpClient

LOGGER = logging.getLogger(__name__)
_DIGITS = re.compile(r"[1-9][0-9]*\Z")


@dataclass(frozen=True)
class _CatalogSnapshot:
    tables: dict[int, dict[str, Any]]
    fields: dict[tuple[int, int], dict[str, Any]]


def _utc_timestamp() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class RagSearchService:
    """Call a configured HTTP search service, then authorize IDs against DAP."""

    def __init__(
        self,
        assets_service: Any,
        config_getter: Callable[[], dict[str, Any]],
        token_getter: Callable[[], str] | None = None,
        *,
        http_client: RagSearchHttpClient | None = None,
    ) -> None:
        self._assets_service = assets_service
        self._config_getter = config_getter
        self._token_getter = token_getter or (lambda: "")
        self._http_client = http_client or RagSearchHttpClient()

    @staticmethod
    def _disabled(query: str) -> RagRecommendationsResponse:
        return RagRecommendationsResponse(
            query=query,
            status="disabled",
            recommendations=[],
            count=0,
            elapsedMs=0,
            reasonCode="disabled",
        )

    @staticmethod
    def _unavailable(
        query: str, reason_code: str, elapsed_ms: float
    ) -> RagRecommendationsResponse:
        return RagRecommendationsResponse(
            query=query,
            status="unavailable",
            recommendations=[],
            count=0,
            elapsedMs=max(0.0, elapsed_ms),
            reasonCode=reason_code,
        )

    def _config(self) -> RagSearchConfig:
        try:
            return RagSearchConfig.model_validate(self._config_getter())
        except Exception:
            raise RagHttpClientError("service_unavailable") from None

    def recommend(
        self,
        query: str,
        *,
        profile: str,
        top_k: int | None = None,
        cancel_event: threading.Event | None = None,
        search_id: str | None = None,
        execution_callback: Callable[[str, dict[str, Any]], None] | None = None,
    ) -> RagRecommendationsResponse:
        normalized_query = str(query or "").strip()
        started = time.monotonic()
        if cancel_event is not None and cancel_event.is_set():
            return self._unavailable(
                normalized_query, "service_unavailable", 0
            )
        if not normalized_query:
            return RagRecommendationsResponse(
                query="",
                status="available",
                recommendations=[],
                count=0,
                elapsedMs=0,
                reasonCode="empty_query",
            )
        try:
            config = self._config()
            if top_k is not None:
                # Per-request asks may narrow the administrator's configured
                # ceiling, but can never increase it.
                requested_top_k = max(1, min(20, int(top_k)))
                config = config.model_copy(
                    update={"top_k": min(config.top_k, requested_top_k)}
                )
        except (RagHttpClientError, TypeError, ValueError) as error:
            reason_code = getattr(error, "reason_code", "service_unavailable")
            return self._unavailable(
                normalized_query, reason_code, (time.monotonic() - started) * 1000
            )
        if not config.enabled:
            return self._disabled(normalized_query)
        if profile == "disabled":
            return self._unavailable(
                normalized_query,
                "visibility_unavailable",
                (time.monotonic() - started) * 1000,
            )

        token = self._safe_token()
        if not token:
            return self._unavailable(
                normalized_query,
                "service_auth_not_configured",
                (time.monotonic() - started) * 1000,
            )
        search_started = started
        search_started_at = ""
        search_was_sent = False

        def report_execution(event: str, data: dict[str, Any]) -> None:
            if execution_callback is None:
                return
            try:
                execution_callback(event, {"searchId": search_id, **data})
            except Exception:
                # Execution reporting must not alter the search contract.
                return

        def on_http_request_start() -> None:
            nonlocal search_started, search_started_at, search_was_sent
            search_started = time.monotonic()
            search_started_at = _utc_timestamp()
            search_was_sent = True
            report_execution("start", {
                "query": normalized_query,
                "startedAt": search_started_at,
                "retrievalMode": config.strategy,
                "requestCount": 1,
            })

        try:
            search_options = (
                {"cancel_event": cancel_event}
                if cancel_event is not None
                else {}
            )
            remote = self._http_client.search(
                config,
                token=token,
                query=normalized_query,
                on_request_start=on_http_request_start,
                **search_options,
            )
        except RagHttpClientError as error:
            reason_code = (
                "service_unavailable"
                if error.reason_code == "cancelled"
                else error.reason_code
            )
            response = self._unavailable(
                normalized_query, reason_code, (time.monotonic() - started) * 1000
            )
            if search_was_sent:
                finished_at = _utc_timestamp()
                report_execution("complete", {
                    "query": normalized_query,
                    "startedAt": search_started_at,
                    "finishedAt": finished_at,
                    "durationMs": max(0.0, (time.monotonic() - search_started) * 1000),
                    "retrievalMode": config.strategy,
                    "requestedMode": None,
                    "effectiveMode": None,
                    "channelsUsed": [],
                    "resultCount": 0,
                    "verifiedCount": 0,
                    "hits": [],
                    "status": "unavailable",
                    "errorCode": reason_code,
                    "requestCount": 1,
                })
            return response
        except Exception:
            LOGGER.warning("RAG HTTP search failed without a safe error code")
            response = self._unavailable(
                normalized_query,
                "service_unavailable",
                (time.monotonic() - started) * 1000,
            )
            if search_was_sent:
                finished_at = _utc_timestamp()
                report_execution("complete", {
                    "query": normalized_query,
                    "startedAt": search_started_at,
                    "finishedAt": finished_at,
                    "durationMs": max(0.0, (time.monotonic() - search_started) * 1000),
                    "retrievalMode": config.strategy,
                    "requestedMode": None,
                    "effectiveMode": None,
                    "channelsUsed": [],
                    "resultCount": 0,
                    "verifiedCount": 0,
                    "hits": [],
                    "status": "unavailable",
                    "errorCode": "service_unavailable",
                    "requestCount": 1,
                })
            return response

        if cancel_event is not None and cancel_event.is_set():
            response = self._unavailable(
                normalized_query,
                "service_unavailable",
                (time.monotonic() - started) * 1000,
            )
            report_execution("complete", {
                "query": normalized_query,
                "startedAt": search_started_at,
                "finishedAt": _utc_timestamp(),
                "durationMs": max(0.0, (time.monotonic() - search_started) * 1000),
                "retrievalMode": config.strategy,
                "requestedMode": remote.retrieval.requested_mode,
                "effectiveMode": remote.retrieval.effective_mode,
                "channelsUsed": remote.retrieval.channels_used,
                "resultCount": len(remote.results),
                "verifiedCount": 0,
                "hits": [],
                "status": "unavailable",
                "errorCode": "cancelled",
                "requestCount": 1,
            })
            return response

        http_elapsed_ms = max(0.0, (time.monotonic() - search_started) * 1000)
        LOGGER.info(
            "RAG stage complete stage=http_search elapsed_ms=%.2f database_call_count=0 result_count=%s",
            http_elapsed_ms,
            len(remote.results),
        )
        candidate_asset_ids, candidate_fields = self._candidate_ids(remote.results)
        expected_db_calls = int(bool(candidate_asset_ids)) + int(bool(candidate_fields))
        catalog_started = time.monotonic()
        report_execution("catalog_start", {
            "startedAt": _utc_timestamp(),
            "phase": "database",
            "candidateAssetCount": len(candidate_asset_ids),
            "candidateFieldCount": sum(len(values) for values in candidate_fields.values()),
            "databaseCallCount": expected_db_calls,
        })
        try:
            snapshot = self._snapshot(
                profile,
                asset_ids=candidate_asset_ids,
                field_ids_by_asset=candidate_fields,
            )
        except Exception:
            catalog_elapsed_ms = (time.monotonic() - catalog_started) * 1000
            LOGGER.warning(
                "RAG stage failed stage=catalog_validation elapsed_ms=%.2f database_call_count=%s reason=visibility_unavailable",
                catalog_elapsed_ms,
                expected_db_calls,
            )
            report_execution("catalog_error", {
                "finishedAt": _utc_timestamp(),
                "durationMs": max(0.0, catalog_elapsed_ms),
                "databaseCallCount": expected_db_calls,
                "errorCode": "visibility_unavailable",
            })
            response = self._unavailable(
                normalized_query,
                "visibility_unavailable",
                (time.monotonic() - started) * 1000,
            )
            report_execution("complete", {
                "query": normalized_query,
                "startedAt": search_started_at,
                "finishedAt": _utc_timestamp(),
                "durationMs": max(0.0, (time.monotonic() - search_started) * 1000),
                "stageTimings": {
                    "httpSearchMs": http_elapsed_ms,
                    "catalogValidationMs": catalog_elapsed_ms,
                },
                "databaseCallCount": expected_db_calls,
                "retrievalMode": config.strategy,
                "requestedMode": remote.retrieval.requested_mode,
                "effectiveMode": remote.retrieval.effective_mode,
                "channelsUsed": remote.retrieval.channels_used,
                "resultCount": len(remote.results),
                "verifiedCount": 0,
                "hits": [],
                "status": "unavailable",
                "errorCode": "visibility_unavailable",
                "requestCount": 1,
            })
            return response
        catalog_elapsed_ms = (time.monotonic() - catalog_started) * 1000
        catalog_logger = LOGGER.warning if catalog_elapsed_ms >= 3000 else LOGGER.info
        catalog_logger(
            "RAG stage complete stage=catalog_validation elapsed_ms=%.2f database_call_count=%s candidate_assets=%s candidate_fields=%s verified_assets=%s",
            catalog_elapsed_ms,
            expected_db_calls,
            len(candidate_asset_ids),
            sum(len(values) for values in candidate_fields.values()),
            len(snapshot.tables),
        )
        report_execution("catalog_complete", {
            "finishedAt": _utc_timestamp(),
            "durationMs": max(0.0, catalog_elapsed_ms),
            "databaseCallCount": expected_db_calls,
            "verifiedAssetCount": len(snapshot.tables),
            "verifiedFieldCount": len(snapshot.fields),
        })

        recommendations: list[RagRecommendation] = []
        execution_hits: list[dict[str, Any]] = []
        seen: set[tuple[str, int, int | None]] = set()
        rejected = False
        for rank, hit in enumerate(remote.results, start=1):
            identity = self._resolve_hit(hit, snapshot)
            if identity is None:
                rejected = True
                continue
            entity_type, asset_id, field_id = identity
            key = (entity_type, asset_id, field_id)
            if key in seen:
                continue
            seen.add(key)
            if entity_type == "table":
                item = snapshot.tables[asset_id]
                recommendations.append(
                    RagRecommendation(
                        assetId=asset_id,
                        assetType="table",
                        name=item["name"],
                        displayName=item["displayName"],
                        description=item["description"],
                        domain=item["domain"],
                        layer=item["layer"],
                        evidence=["已通过当前共享目录校验"],
                    )
                )
                item_name = item["displayName"] or item["name"]
            else:
                item = snapshot.fields[(asset_id, int(field_id))]
                parent = snapshot.tables[asset_id]
                recommendations.append(
                    RagRecommendation(
                        assetId=asset_id,
                        fieldId=int(field_id),
                        assetType="field",
                        name=item["name"],
                        displayName=item["displayName"],
                        description=item["description"],
                        domain=item["domain"],
                        layer=item["layer"],
                        relatedTable=RagRelatedTable(
                            assetId=asset_id,
                            name=parent["name"],
                            displayName=parent["displayName"],
                            description=parent["description"],
                            domain=parent["domain"],
                            layer=parent["layer"],
                        ),
                        evidence=["已通过当前共享目录校验"],
                    )
                )
                item_name = item["displayName"] or item["name"]
            execution_hits.append({
                "rank": rank,
                "assetId": asset_id,
                "fieldId": int(field_id) if field_id is not None else None,
                "entityType": entity_type,
                "name": item_name,
                "retrievalChannels": list(hit.retrieval_channels),
                "matchedTerms": list(dict.fromkeys(
                    term
                    for evidence in hit.evidence
                    for term in evidence.matched_terms
                ))[:8],
            })
            if len(recommendations) >= config.top_k:
                break

        reason_code = "visibility_unavailable" if rejected else None
        status = "degraded" if reason_code else "available"
        response = RagRecommendationsResponse(
            query=normalized_query,
            status=status,
            recommendations=recommendations,
            count=len(recommendations),
            elapsedMs=(time.monotonic() - started) * 1000,
            reasonCode=reason_code,
        )
        if search_was_sent:
            report_execution("complete", {
                "query": normalized_query,
                "startedAt": search_started_at,
                "finishedAt": _utc_timestamp(),
                "durationMs": max(0.0, (time.monotonic() - search_started) * 1000),
                "stageTimings": {
                    "httpSearchMs": http_elapsed_ms,
                    "catalogValidationMs": catalog_elapsed_ms,
                },
                "databaseCallCount": expected_db_calls,
                "retrievalMode": config.strategy,
                "requestedMode": remote.retrieval.requested_mode,
                "effectiveMode": remote.retrieval.effective_mode,
                "channelsUsed": list(remote.retrieval.channels_used),
                "resultCount": len(remote.results),
                "verifiedCount": len(recommendations),
                "hits": execution_hits[:20],
                "status": status,
                "errorCode": reason_code,
                "requestCount": 1,
            })
        return response

    @staticmethod
    def _parse_id(value: int | str | None) -> int | None:
        if isinstance(value, bool) or value is None:
            return None
        if isinstance(value, int):
            return value if 0 < value <= 2_147_483_647 else None
        if not isinstance(value, str) or not _DIGITS.fullmatch(value):
            return None
        try:
            parsed = int(value)
        except ValueError:
            return None
        return parsed if 0 < parsed <= 2_147_483_647 else None

    def _resolve_hit(
        self,
        hit: RagHttpSearchHit,
        snapshot: _CatalogSnapshot,
    ) -> tuple[str, int, int | None] | None:
        asset_id = self._parse_id(hit.asset_id)
        if asset_id is None or asset_id not in snapshot.tables:
            return None
        if hit.entity_type == "table":
            return ("table", asset_id, None) if hit.field_id is None else None
        field_id = self._parse_id(hit.field_id)
        if field_id is None or (asset_id, field_id) not in snapshot.fields:
            return None
        return "field", asset_id, field_id

    @staticmethod
    def _candidate_ids(hits: list[RagHttpSearchHit]) -> tuple[list[int], dict[int, set[int]]]:
        asset_ids: set[int] = set()
        field_ids_by_asset: dict[int, set[int]] = {}
        for hit in hits[:20]:
            asset_id = RagSearchService._parse_id(hit.asset_id)
            if asset_id is None:
                continue
            asset_ids.add(asset_id)
            if hit.entity_type == "field":
                field_id = RagSearchService._parse_id(hit.field_id)
                if field_id is not None:
                    field_ids_by_asset.setdefault(asset_id, set()).add(field_id)
        return sorted(asset_ids), field_ids_by_asset

    def load_candidate_catalog(
        self,
        asset_ids: list[int],
        field_ids_by_asset: dict[int, set[int]],
        *,
        profile: str,
        cancel_event: Any | None = None,
    ) -> list[dict[str, Any]]:
        """Batch-read and project the current authoritative DAP candidates."""
        if cancel_event is not None and cancel_event.is_set():
            raise RuntimeError("catalog validation cancelled")
        started = time.monotonic()
        database_call_count = int(bool(asset_ids)) + int(
            any(bool(values) for values in field_ids_by_asset.values())
        )
        completed = False
        try:
            source = self._assets_service.get_rag_candidate_catalog(
                asset_ids,
                field_ids_by_asset,
            )
            projected = project_public_catalog_value(source, profile=profile)
            if not isinstance(projected, list):
                raise ValueError("public asset projection is unavailable")
            if cancel_event is not None and cancel_event.is_set():
                raise RuntimeError("catalog validation cancelled")
            completed = True
            return projected
        finally:
            elapsed_ms = (time.monotonic() - started) * 1000
            logger = LOGGER.warning if elapsed_ms >= 3000 or not completed else LOGGER.info
            logger(
                "RAG stage %s stage=candidate_metadata_lookup elapsed_ms=%.2f database_call_count=%s candidate_assets=%s candidate_fields=%s",
                "complete" if completed else "failed",
                elapsed_ms,
                database_call_count,
                len(asset_ids),
                sum(len(values) for values in field_ids_by_asset.values()),
            )

    def _snapshot(
        self,
        profile: str,
        *,
        asset_ids: list[int],
        field_ids_by_asset: dict[int, set[int]],
    ) -> _CatalogSnapshot:
        projected = self.load_candidate_catalog(
            asset_ids,
            field_ids_by_asset,
            profile=profile,
        )

        tables: dict[int, dict[str, Any]] = {}
        fields: dict[tuple[int, int], dict[str, Any]] = {}
        seen_field_ids: set[int] = set()
        for row in projected:
            if not isinstance(row, dict):
                raise ValueError("public asset row is malformed")
            asset_id = self._parse_id(row.get("assetId"))
            name = self._safe_text(row.get("name"))
            if asset_id is None or not name or asset_id in tables:
                raise ValueError("public asset identity is ambiguous")
            table = {
                "assetId": asset_id,
                "name": name,
                "displayName": self._safe_text(row.get("cn")) or name,
                "description": self._safe_text(row.get("desc")),
                "domain": self._safe_text(row.get("domain")),
                "layer": self._safe_text(row.get("layer")),
            }
            tables[asset_id] = table
            source_fields = row.get("fields")
            if not isinstance(source_fields, list):
                raise ValueError("public fields are unavailable")
            for field in source_fields:
                if not isinstance(field, dict):
                    raise ValueError("public field row is malformed")
                field_id = self._parse_id(field.get("fieldId"))
                field_asset_id = self._parse_id(field.get("assetId"))
                field_name = self._safe_text(field.get("name"))
                if (
                    field_id is None
                    or field_asset_id != asset_id
                    or not field_name
                    or field_id in seen_field_ids
                ):
                    raise ValueError("public field identity is ambiguous")
                seen_field_ids.add(field_id)
                record = {
                    "assetId": asset_id,
                    "fieldId": field_id,
                    "name": field_name,
                    "displayName": self._safe_text(field.get("cn")) or field_name,
                    "description": self._safe_text(field.get("description")),
                    "domain": table["domain"],
                    "layer": table["layer"],
                }
                fields[(asset_id, field_id)] = record
        return _CatalogSnapshot(tables=tables, fields=fields)

    @staticmethod
    def _safe_text(value: Any) -> str:
        return value.strip() if isinstance(value, str) else ""

    def _safe_token(self) -> str:
        try:
            value = self._token_getter()
        except Exception:
            return ""
        return value.strip() if isinstance(value, str) else ""

    def is_configured(self) -> bool:
        """Return whether retrieval is administratively enabled and authenticated.

        This is a configuration-only check; it does not probe the remote service
        and never returns its URL or credential to the browser.
        """
        try:
            return self._config().enabled and bool(self._safe_token())
        except Exception:
            return False

    def diagnostics(self, raw_config: dict[str, Any]) -> dict[str, Any]:
        try:
            config = RagSearchConfig.model_validate(raw_config)
        except ValidationError:
            return {"status": "unavailable", "reasonCode": "service_unavailable"}
        if not config.enabled:
            return {
                "status": "disabled",
                "reasonCode": "disabled",
                "health": "unknown",
                "ready": False,
                "tokenConfigured": bool(self._safe_token()),
            }
        token = self._safe_token()
        if not token:
            return {
                "status": "unavailable",
                "reasonCode": "service_auth_not_configured",
                "health": "unknown",
                "ready": False,
                "tokenConfigured": False,
            }
        try:
            result = self._http_client.diagnostics(config, token=token)
        except RagHttpClientError as error:
            return {
                "status": "unavailable",
                "reasonCode": error.reason_code,
                "health": "unavailable",
                "ready": False,
                "tokenConfigured": True,
            }
        except Exception:
            LOGGER.warning("RAG HTTP diagnostics failed without a safe error code")
            return {
                "status": "unavailable",
                "reasonCode": "service_unavailable",
                "health": "unavailable",
                "ready": False,
                "tokenConfigured": True,
            }
        return {**result, "tokenConfigured": True}


# These existing DAP services are supplied to the HTTP adapter; no RAG runtime
# package, index, or model is imported into the DAP process.
from .assets_service import assets_service
from .system_management_service import system_management_service
from ..settings import get_rag_search_service_token

rag_search_service = RagSearchService(
    assets_service=assets_service,
    config_getter=system_management_service.get_rag_search_config,
    token_getter=get_rag_search_service_token,
)
