"""Application service for the versioned Metadata Ingestion Contract.

This module is deliberately the only place that knows how the public metadata
DTO is normalized into the current asset and lineage storage model.  Collectors
never import these tables or this service; they submit the contract over HTTP.
"""

from __future__ import annotations

import hashlib
import json
import os
from copy import deepcopy
from datetime import timezone
from typing import Any
from uuid import uuid4

from sqlalchemy import delete, func, insert, select, update  # type: ignore

from ..application import AuditActorMixin, actor_aware, current_request_context
from ..application.errors import ApplicationError
from ..contracts.metadata_ingestion import (  # type: ignore
    AssetMetadataIngestionRequest,
    LineageMetadataIngestionRequest,
    MAX_ASSETS_PER_REQUEST,
    MAX_FIELDS_PER_ASSET,
    MAX_LINEAGE_EDGES,
    MAX_LINEAGE_NODES,
    MAX_TOTAL_FIELDS,
    MetadataAsset,
    MetadataIngestionResult,
    MetadataItemResult,
    MetadataSummary,
    SUPPORTED_CONTRACT_MAJOR,
)
from ..db.facade import database_transaction, resolve_db_profile_name
from ..db.service import CoreAccess
from ..db.tables import (
    asset_change_log,
    asset_field,
    asset_table,
    lineage_edge,
    lineage_node,
    lineage_snapshot,
)
from ..utils.data_types import normalize_data_type
from .operation_log_service import OperationLogService, operation_log_service


class MetadataIngestionError(ApplicationError):
    code = "METADATA_INGESTION_ERROR"
    status_code = 422


class MetadataValidationError(MetadataIngestionError):
    code = "METADATA_CONTRACT_INVALID"
    status_code = 422


class MetadataPayloadTooLargeError(MetadataIngestionError):
    code = "METADATA_PAYLOAD_TOO_LARGE"
    status_code = 413


class MetadataConflictError(MetadataIngestionError):
    code = "METADATA_INGESTION_CONFLICT"
    status_code = 409


class MetadataNotFoundError(MetadataIngestionError):
    code = "METADATA_INGESTION_NOT_FOUND"
    status_code = 404


class MetadataDataSourceError(MetadataIngestionError):
    code = "METADATA_DATA_SOURCE_ERROR"
    status_code = 503


class _ItemProblem(ValueError):
    def __init__(self, code: str, message: str, field: str | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.field = field


class MetadataIngestionService(AuditActorMixin):
    """Normalize, compare, persist and audit metadata ingestion requests."""

    def __init__(
        self,
        *,
        db: CoreAccess | None = None,
        operation_logs: OperationLogService | None = None,
        db_profile: str | None = None,
    ):
        self._db_profile = (db_profile or os.getenv("ASSET_DB_PROFILE", "")).strip()
        self._db = db or CoreAccess(
            profile_getter=lambda: self._db_profile,
            error_factory=MetadataDataSourceError,
        )
        self._operation_logs = operation_logs or operation_log_service

    def _profile(self) -> str:
        return self._db_profile or resolve_db_profile_name()

    @staticmethod
    def _limit(name: str, default: int) -> int:
        try:
            value = int(os.getenv(name, str(default)))
        except (TypeError, ValueError):
            value = default
        return max(1, value)

    @staticmethod
    def _safe_int(value: Any, default: int = 0) -> int:
        try:
            return int(value)
        except (TypeError, ValueError, OverflowError):
            return default

    @staticmethod
    def _canonical(value: Any) -> str:
        return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)

    @classmethod
    def _digest(cls, value: Any) -> str:
        return hashlib.sha256(cls._canonical(value).encode("utf-8")).hexdigest()

    @staticmethod
    def _source_key(source) -> str:
        value = {
            "type": source.type.strip().casefold(),
            "name": source.name.strip(),
            "namespace": (source.namespace or "").strip(),
            "instance": (source.instance or "").strip(),
        }
        return hashlib.sha256(
            json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest()

    @staticmethod
    def _contract_major(version: str) -> int:
        try:
            return int(str(version).strip().split(".", 1)[0])
        except (TypeError, ValueError, IndexError) as error:
            raise MetadataValidationError("contractVersion must use <major>.<minor> format") from error

    def _validate_contract_version(self, version: str) -> None:
        if self._contract_major(version) != SUPPORTED_CONTRACT_MAJOR:
            raise MetadataValidationError(
                f"unsupported metadata contract major version: {version}",
                details=[{"field": "contractVersion", "code": "UNSUPPORTED_CONTRACT_MAJOR"}],
            )

    @staticmethod
    def _item_error(index: int | None, key: str, problem: _ItemProblem) -> dict[str, Any]:
        return {
            "index": index,
            "externalKey": key,
            "status": "invalid" if problem.code.startswith("INVALID") else "conflict",
            "code": problem.code,
            "message": problem.message,
            "field": problem.field,
        }

    @staticmethod
    def _result_item(index: int | None, key: str, status: str, *, action: str | None = None, code: str | None = None, message: str | None = None, field: str | None = None) -> dict[str, Any]:
        return {
            "index": index,
            "externalKey": key,
            "status": status,
            "action": action,
            "code": code,
            "message": message,
            "field": field,
        }

    @staticmethod
    def _asset_key(source_key: str, item: dict[str, Any]) -> tuple[str, str, str]:
        return source_key, item["asset_type"], item["external_id"]

    def _normalize_asset(self, source_key: str, item: MetadataAsset) -> dict[str, Any]:
        asset_type = (item.asset_type or "table").strip().casefold()
        if not asset_type:
            raise _ItemProblem("INVALID_ASSET_TYPE", "assetType cannot be empty", "assetType")
        qualified_name = (item.qualified_name or "").strip()
        name = (item.name or "").strip()
        if not qualified_name and name:
            parts = [item.catalog, item.database, item.schema_name, name]
            qualified_name = ".".join(str(part).strip() for part in parts if str(part or "").strip())
        if not name and qualified_name:
            name = qualified_name.rsplit(".", 1)[-1].strip()
        if not name or not qualified_name:
            raise _ItemProblem("INVALID_ASSET_IDENTITY", "name or qualifiedName is required")
        natural_id = (item.external_id or "").strip() or qualified_name
        if not natural_id:
            raise _ItemProblem("INVALID_ASSET_IDENTITY", "externalId or qualifiedName is required")

        fields = []
        seen_names: set[str] = set()
        seen_ordinals: set[int] = set()
        for index, field in enumerate(item.fields, start=1):
            field_name = field.name.strip()
            field_key = field_name.casefold()
            if field_key in seen_names:
                raise _ItemProblem("INVALID_DUPLICATE_FIELD", "field names must be unique", f"fields[{index - 1}].name")
            seen_names.add(field_key)
            ordinal = field.ordinal_position or index
            if ordinal in seen_ordinals:
                raise _ItemProblem("INVALID_DUPLICATE_ORDINAL", "field ordinal positions must be unique", f"fields[{index - 1}].ordinalPosition")
            seen_ordinals.add(ordinal)
            if field.primary_key and field.nullable:
                raise _ItemProblem("INVALID_PRIMARY_KEY_NULLABILITY", "primary key fields must be non-nullable", f"fields[{index - 1}].nullable")
            description = (field.description or "").strip() or field_name
            fields.append(
                {
                    "name": field_name,
                    "type": normalize_data_type(field.data_type),
                    "nullable": field.nullable,
                    "pk": field.primary_key,
                    "part": field.partition_key,
                    "ordinal": ordinal,
                    "description": description,
                }
            )
        fields.sort(key=lambda value: (value["ordinal"], value["name"].casefold()))
        normalized = {
            "source_key": source_key,
            "asset_type": asset_type,
            "external_id": natural_id,
            "qualified_name": qualified_name,
            "catalog": (item.catalog or "").strip(),
            "database": (item.database or "").strip(),
            "schema": (item.schema_name or "").strip() or (qualified_name.rsplit(".", 1)[-2] if "." in qualified_name else "external"),
            "name": name,
            "description": (item.description or "").strip(),
            "fields": fields,
        }
        normalized["content"] = self._asset_content(normalized)
        normalized["key"] = self._asset_key(source_key, normalized)
        return normalized

    @staticmethod
    def _asset_content(asset: dict[str, Any]) -> dict[str, Any]:
        return {
            "assetType": asset["asset_type"],
            "qualifiedName": asset["qualified_name"],
            "catalog": asset["catalog"],
            "database": asset["database"],
            "schema": asset["schema"],
            "name": asset["name"],
            "description": asset["description"],
            "fields": [
                {
                    "name": field["name"],
                    "type": field["type"],
                    "nullable": field["nullable"],
                    "pk": field["pk"],
                    "part": field["part"],
                    "ordinal": field["ordinal"],
                    "description": field["description"],
                }
                for field in asset["fields"]
            ],
        }

    def _preflight_assets(self, request: AssetMetadataIngestionRequest) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        count = len(request.assets)
        limit = self._limit("METADATA_MAX_ASSETS_PER_REQUEST", MAX_ASSETS_PER_REQUEST)
        if count == 0:
            raise MetadataValidationError("assets must contain at least one item")
        if count > limit:
            raise MetadataPayloadTooLargeError(f"assets exceeds the configured limit of {limit}")
        total_fields = sum(len(item.fields) for item in request.assets)
        per_asset_limit = self._limit("METADATA_MAX_FIELDS_PER_ASSET", MAX_FIELDS_PER_ASSET)
        total_limit = self._limit("METADATA_MAX_TOTAL_FIELDS", MAX_TOTAL_FIELDS)
        if any(len(item.fields) > per_asset_limit for item in request.assets) or total_fields > total_limit:
            raise MetadataPayloadTooLargeError(
                f"field count exceeds configured limits (perAsset={per_asset_limit}, total={total_limit})"
            )

        source_key = self._source_key(request.source)
        normalized: list[dict[str, Any]] = []
        errors: list[dict[str, Any]] = []
        seen: dict[tuple[str, str, str], int] = {}
        duplicate_indexes: set[int] = set()
        for index, item in enumerate(request.assets):
            try:
                value = self._normalize_asset(source_key, item)
            except _ItemProblem as problem:
                errors.append(self._item_error(index, "", problem))
                continue
            previous = seen.get(value["key"])
            if previous is not None:
                duplicate_indexes.update({previous, index})
                errors.append(self._item_error(index, value["external_id"], _ItemProblem("DUPLICATE_NATURAL_KEY", "asset natural key is duplicated in the request")))
                errors.append(self._item_error(previous, value["external_id"], _ItemProblem("DUPLICATE_NATURAL_KEY", "asset natural key is duplicated in the request")))
                continue
            seen[value["key"]] = index
            value["index"] = index
            normalized.append(value)
        normalized = [item for item in normalized if item["index"] not in duplicate_indexes]
        return normalized, errors

    def _asset_fields(self, asset_ids: list[int]) -> dict[int, list[dict[str, Any]]]:
        if not asset_ids:
            return {}
        rows = self._db.fetch_rows(
            select(
                asset_field.c.asset_id,
                asset_field.c.field_name,
                asset_field.c.field_cn_name,
                asset_field.c.data_type,
                asset_field.c.field_order,
                asset_field.c.nullable_flag,
                asset_field.c.pk_flag,
                asset_field.c.partition_flag,
                asset_field.c.field_desc,
            ).where(asset_field.c.asset_id.in_(asset_ids)).order_by(asset_field.c.asset_id, asset_field.c.field_order)
        )
        result: dict[int, list[dict[str, Any]]] = {}
        for row in rows:
            asset_id = self._safe_int(row.get("asset_id"))
            result.setdefault(asset_id, []).append(
                {
                    "name": row["field_name"],
                    "type": normalize_data_type(row.get("data_type")),
                    "nullable": str(row.get("nullable_flag") or "Y").upper() == "Y",
                    "pk": str(row.get("pk_flag") or "N").upper() == "Y",
                    "part": str(row.get("partition_flag") or "N").upper() == "Y",
                    "ordinal": self._safe_int(row.get("field_order")),
                    "description": row.get("field_desc") or row.get("field_cn_name") or row["field_name"],
                }
            )
        return result

    def _load_existing_assets(self, source_keys: set[str]) -> dict[tuple[str, str, str], dict[str, Any]]:
        if not source_keys:
            return {}
        rows = self._db.fetch_rows(
            select(asset_table).where(asset_table.c.source_key.in_(sorted(source_keys)))
        )
        fields = self._asset_fields([self._safe_int(row.get("asset_id")) for row in rows])
        result = {}
        for row in rows:
            source_key = row.get("source_key")
            asset_type = row.get("asset_type") or "table"
            external_id = row.get("external_id") or row.get("qualified_name") or row.get("table_name")
            if not source_key or not external_id:
                continue
            value = {
                "asset_id": self._safe_int(row.get("asset_id")),
                "source_key": source_key,
                "asset_type": asset_type,
                "external_id": external_id,
                "qualified_name": row.get("qualified_name") or row.get("table_name"),
                "catalog": row.get("catalog_name") or "",
                "database": row.get("database_name") or "",
                "schema": row.get("schema_name") or "external",
                "name": row.get("table_name") or "",
                "description": row.get("table_desc") or "",
                "fields": fields.get(self._safe_int(row.get("asset_id")), []),
            }
            value["content"] = self._asset_content(value)
            value["key"] = (source_key, asset_type, external_id)
            result[value["key"]] = value
        return result

    def _asset_statements(
        self,
        item: dict[str, Any],
        *,
        asset_id: int,
        field_id_start: int,
        change_id: int,
        current: dict[str, Any] | None,
    ) -> tuple[list[Any], list[dict[str, Any]], dict[str, Any]]:
        values = {
            "asset_id": asset_id,
            "table_name": item["name"],
            "table_cn_name": item["description"] or item["name"],
            "schema_name": item["schema"],
            "catalog_name": item["catalog"] or None,
            "database_name": item["database"] or None,
            "source_key": item["source_key"],
            "asset_type": item["asset_type"],
            "external_id": item["external_id"],
            "qualified_name": item["qualified_name"],
            "layer_code": None,
            "domain_code": None,
            "owner_name": None,
            "field_count": len(item["fields"]),
            "table_desc": item["description"] or None,
            "updated_by": self._operator,
        }
        statements: list[Any] = []
        if current is None:
            statements.append(insert(asset_table).values({**values, "created_by": self._operator}))
            change_type = "CREATE_TABLE"
            before = None
        else:
            statements.extend(
                [
                    update(asset_table).where(asset_table.c.asset_id == asset_id).values(**values, updated_at=func.current_timestamp()),
                    delete(asset_field).where(asset_field.c.asset_id == asset_id),
                ]
            )
            change_type = "UPDATE_TABLE"
            before = {"qualifiedName": current["qualified_name"], "fieldCount": len(current["fields"])}
        field_rows = [
            {
                "field_id": field_id_start + offset,
                "asset_id": asset_id,
                "field_name": field["name"],
                "field_cn_name": field["description"],
                "data_type": field["type"],
                "field_order": offset + 1,
                "nullable_flag": "Y" if field["nullable"] else "N",
                "pk_flag": "Y" if field["pk"] else "N",
                "partition_flag": "Y" if field["part"] else "N",
                "field_desc": field["description"],
                "created_by": self._operator,
                "updated_by": self._operator,
            }
            for offset, field in enumerate(item["fields"])
        ]
        after = {"qualifiedName": item["qualified_name"], "fieldCount": len(item["fields"])}
        statements.append(
            insert(asset_change_log).values(
                change_id=change_id,
                asset_id=asset_id,
                table_name=item["name"],
                change_type=change_type,
                change_summary="元数据 ingestion " + ("创建资产" if current is None else "更新资产"),
                before_json=self._canonical(before) if before is not None else None,
                after_json=self._canonical(after),
                operator_name=self._operator,
            )
        )
        return statements, field_rows, after

    def _classify_assets(
        self,
        request: AssetMetadataIngestionRequest,
        normalized: list[dict[str, Any]],
        errors: list[dict[str, Any]],
        *,
        persist: bool,
    ) -> tuple[MetadataSummary, list[dict[str, Any]], list[dict[str, Any]]]:
        summary = MetadataSummary(received=len(request.assets), valid=len(normalized), invalid=0, conflict=0)
        for error in errors:
            if error.get("status") == "conflict":
                summary.conflict += 1
            else:
                summary.invalid += 1
        existing = self._load_existing_assets({item["source_key"] for item in normalized})
        items = list(errors)
        actions: list[dict[str, Any]] = []
        normalized_keys = set()
        for item in normalized:
            normalized_keys.add(item["key"])
            current = existing.get(item["key"])
            if current is None:
                summary.create += 1
                action = "create"
                status = "create"
            elif current["content"] == item["content"]:
                summary.unchanged += 1
                action = "unchanged"
                status = "unchanged"
            else:
                summary.update += 1
                action = "update"
                status = "update"
            items.append(self._result_item(item["index"], item["external_id"], status, action=action))
            if action in {"create", "update"}:
                actions.append({"item": item, "current": current, "action": action})
        if request.authoritative:
            source_key = self._source_key(request.source)
            for key, current in existing.items():
                if key[0] == source_key and key not in normalized_keys:
                    summary.delete_candidate += 1
                    items.append(self._result_item(None, current["external_id"], "delete_candidate", action="delete_candidate"))
        if persist and actions:
            self._persist_asset_actions(actions)
        return summary, items, actions

    def _persist_asset_actions(self, actions: list[dict[str, Any]]) -> None:
        field_count = sum(len(action["item"]["fields"]) for action in actions)
        next_asset_id = self._db.next_pk(asset_table, asset_table.c.asset_id)
        next_field_id = self._db.next_pk(asset_field, asset_field.c.field_id) if field_count else 0
        next_change_id = self._db.next_pk(asset_change_log, asset_change_log.c.change_id)
        statements = []
        field_rows = []
        for offset, action in enumerate(actions):
            item = action["item"]
            current = action["current"]
            asset_id = next_asset_id if action["action"] == "create" else current["asset_id"]
            if action["action"] == "create":
                next_asset_id += 1
            built, fields, _ = self._asset_statements(
                item,
                asset_id=asset_id,
                field_id_start=next_field_id,
                change_id=next_change_id + offset,
                current=current,
            )
            next_field_id += len(fields)
            statements.extend(built)
            field_rows.extend(fields)
        self._db.execute_statements(statements)
        if field_rows:
            self._db.execute_many(insert(asset_field), field_rows)

    def _asset_result(
        self,
        request: AssetMetadataIngestionRequest,
        *,
        ingestion_id: str,
        correlation_id: str,
        dry_run: bool,
        status: str,
        summary: MetadataSummary,
        items: list[dict[str, Any]],
    ) -> dict[str, Any]:
        result = MetadataIngestionResult(
            ingestion_id=ingestion_id,
            correlation_id=correlation_id,
            status=status,
            contract_version=request.contract_version,
            dry_run=dry_run,
            source=request.source,
            collector=request.collector,
            summary=summary,
            items=[MetadataItemResult.model_validate(item) for item in items],
            errors=[MetadataItemResult.model_validate(item) for item in items if item.get("status") in {"invalid", "conflict"}],
        )
        return result.model_dump(by_alias=True, exclude_none=True)

    @actor_aware
    def ingest_assets(self, request: AssetMetadataIngestionRequest, *, dry_run: bool = False) -> dict[str, Any]:
        self._validate_contract_version(request.contract_version)
        ingestion_id = str(uuid4())
        context = current_request_context()
        correlation_id = (context.request_id if context and context.request_id else ingestion_id)
        normalized, errors = self._preflight_assets(request)
        if errors:
            result = self._asset_result(
                request,
                ingestion_id=ingestion_id,
                correlation_id=correlation_id,
                dry_run=dry_run,
                status="rejected",
                summary=MetadataSummary(received=len(request.assets), valid=len(normalized), invalid=sum(item.get("status") == "invalid" for item in errors), conflict=sum(item.get("status") == "conflict" for item in errors)),
                items=errors,
            )
            raise MetadataValidationError("metadata asset validation failed", details=result)

        if dry_run:
            with database_transaction():
                summary, items, _ = self._classify_assets(request, normalized, [], persist=False)
            return self._asset_result(request, ingestion_id=ingestion_id, correlation_id=correlation_id, dry_run=True, status="preview", summary=summary, items=items)

        with self._operation_logs.batch_audit(
            batch_id=ingestion_id,
            resource_type="metadata-assets",
            operation="INGEST",
            total_count=len(request.assets),
            summary="metadata ingestion pending",
        ) as audit:
            summary, items, _ = self._classify_assets(request, normalized, [], persist=True)
            audit.success_count = summary.create + summary.update
            audit.failed_count = summary.failed
            audit.skipped_count = summary.unchanged + summary.delete_candidate
            audit.created_count = summary.create
            audit.updated_count = summary.update
            audit.summary = self._audit_summary(request, summary, ingestion_id, kind="assets")
        return self._asset_result(request, ingestion_id=ingestion_id, correlation_id=correlation_id, dry_run=False, status="completed", summary=summary, items=items)

    @staticmethod
    def _audit_summary(request, summary: MetadataSummary, ingestion_id: str, *, kind: str, snapshot_id: str | None = None) -> str:
        payload = {
            "ingestionId": ingestion_id,
            "kind": kind,
            "contractVersion": request.contract_version,
            "dryRun": False,
            "source": request.source.model_dump(by_alias=True, exclude_none=True),
            "collector": request.collector.model_dump(by_alias=True, exclude_none=True),
            "summary": summary.model_dump(by_alias=True),
            "snapshotId": snapshot_id,
            "result": "completed",
        }
        return json.dumps(payload, ensure_ascii=False, sort_keys=True)

    def _normalize_confidence(self, value: str | float | int) -> str:
        if isinstance(value, bool):
            raise _ItemProblem("INVALID_CONFIDENCE", "confidence must be low, medium, high, or a number from 0 to 1", "confidence")
        if isinstance(value, (int, float)):
            try:
                number = float(value)
            except (TypeError, ValueError, OverflowError) as error:
                raise _ItemProblem("INVALID_CONFIDENCE", "confidence must be a number from 0 to 1", "confidence") from error
            if not 0 <= number <= 1:
                raise _ItemProblem("INVALID_CONFIDENCE", "confidence number must be between 0 and 1", "confidence")
            return "high" if number >= 0.8 else "medium" if number >= 0.5 else "low"
        normalized = str(value or "").strip().casefold()
        if normalized not in {"low", "medium", "high", "unknown"}:
            raise _ItemProblem("INVALID_CONFIDENCE", "confidence must be low, medium, high, or unknown", "confidence")
        return normalized

    def _preflight_lineage(self, request: LineageMetadataIngestionRequest) -> dict[str, Any]:
        node_limit = self._limit("METADATA_MAX_LINEAGE_NODES", MAX_LINEAGE_NODES)
        edge_limit = self._limit("METADATA_MAX_LINEAGE_EDGES", MAX_LINEAGE_EDGES)
        if len(request.nodes) > node_limit or len(request.edges) > edge_limit:
            raise MetadataPayloadTooLargeError(f"lineage snapshot exceeds configured limits (nodes={node_limit}, edges={edge_limit})")
        mode = request.snapshot.mode.strip().casefold()
        if mode != "replace":
            raise MetadataValidationError("lineage V1 supports only snapshot mode=replace", details=[{"field": "snapshot.mode", "code": "UNSUPPORTED_SNAPSHOT_MODE"}])
        source_key = self._source_key(request.source)
        nodes: list[dict[str, Any]] = []
        node_map: dict[str, dict[str, Any]] = {}
        for index, node in enumerate(request.nodes):
            node_id = (node.external_id or node.qualified_name or "").strip()
            if not node_id:
                raise MetadataValidationError("lineage node identity is required", details=[{"index": index, "field": "nodes[].externalId"}])
            normalized = {
                "id": node_id,
                "type": node.node_type.strip(),
                "name": node.name.strip(),
                "namespace": (node.namespace or "").strip() or (request.source.namespace or "").strip(),
                "attributes": deepcopy(node.attributes),
            }
            existing = node_map.get(node_id)
            if existing is not None:
                if self._canonical(existing) == self._canonical(normalized):
                    continue
                raise MetadataConflictError("lineage node identity is duplicated with different content", details=[{"index": index, "externalKey": node_id, "code": "DUPLICATE_NODE"}])
            node_map[node_id] = normalized
            nodes.append(normalized)

        edges: list[dict[str, Any]] = []
        edge_map: dict[str, dict[str, Any]] = {}
        for index, edge in enumerate(request.edges):
            source_id = edge.source_id.strip()
            target_id = edge.target_id.strip()
            if source_id not in node_map or target_id not in node_map:
                raise MetadataValidationError("lineage edge must reference a node in the same snapshot", details=[{"index": index, "field": "edges[].sourceId/targetId", "code": "BAD_EDGE_REFERENCE"}])
            try:
                confidence = self._normalize_confidence(edge.confidence)
            except _ItemProblem as problem:
                raise MetadataValidationError(
                    problem.message,
                    details=[{"index": index, "field": problem.field, "code": problem.code}],
                ) from problem
            evidence = {
                "type": edge.evidence.evidence_type.strip(),
                "sourceRecordId": edge.evidence.source_record_id.strip(),
                "description": edge.evidence.description.strip(),
            }
            edge_id = (edge.external_id or "").strip() or self._digest({"source": source_id, "target": target_id, "type": edge.edge_type, "evidence": evidence, "confidence": confidence})[:48]
            normalized = {
                "id": edge_id,
                "sourceId": source_id,
                "targetId": target_id,
                "type": edge.edge_type.strip(),
                "evidence": evidence,
                "confidence": confidence,
                "diagnostics": deepcopy(edge.diagnostics),
            }
            existing = edge_map.get(edge_id)
            if existing is not None:
                if self._canonical(existing) == self._canonical(normalized):
                    continue
                raise MetadataConflictError("lineage edge identity is duplicated with different content", details=[{"index": index, "externalKey": edge_id, "code": "DUPLICATE_EDGE"}])
            edge_map[edge_id] = normalized
            edges.append(normalized)

        import_id = (request.snapshot.import_id or request.snapshot.external_snapshot_id or "").strip()
        import_batch_id = self._digest({"source": source_key, "importId": import_id})[:64]
        snapshot_id = "metadata-" + self._digest({"source": source_key, "importId": import_id})[:56]
        content_hash = self._digest({"mode": mode, "snapshotId": import_id, "nodes": nodes, "edges": edges})
        return {
            "source_key": source_key,
            "import_id": import_id,
            "import_batch_id": import_batch_id,
            "snapshot_id": snapshot_id,
            "content_hash": content_hash,
            "generated_at": request.snapshot.generated_at.astimezone(timezone.utc),
            "mode": mode,
            "nodes": nodes,
            "edges": edges,
        }

    def _lineage_existing(self, import_batch_id: str) -> dict[str, Any] | None:
        rows = self._db.fetch_rows(
            select(lineage_snapshot).where(lineage_snapshot.c.import_batch_id == import_batch_id).limit(1)
        )
        return rows[0] if rows else None

    def _lineage_result(self, request, *, ingestion_id, correlation_id, dry_run, status, summary, items, snapshot_id=None):
        result = MetadataIngestionResult(
            ingestion_id=ingestion_id,
            correlation_id=correlation_id,
            status=status,
            contract_version=request.contract_version,
            dry_run=dry_run,
            source=request.source,
            collector=request.collector,
            summary=summary,
            items=[MetadataItemResult.model_validate(item) for item in items],
            errors=[MetadataItemResult.model_validate(item) for item in items if item.get("status") in {"invalid", "conflict"}],
            snapshot_id=snapshot_id,
        )
        return result.model_dump(by_alias=True, exclude_none=True)

    def _persist_lineage(self, request, normalized: dict[str, Any], ingestion_id: str) -> None:
        self._db.execute(
            insert(lineage_snapshot).values(
                snapshot_id=normalized["snapshot_id"],
                generated_at=normalized["generated_at"],
                generator_name=request.collector.name,
                generator_version=request.collector.version,
                import_batch_id=normalized["import_batch_id"],
                source_key=normalized["source_key"],
                content_hash=normalized["content_hash"],
                ingestion_id=ingestion_id,
                status_code="INACTIVE",
            )
        )
        node_rows = [
            {
                "snapshot_id": normalized["snapshot_id"],
                "node_id": node["id"],
                "kind_code": node["type"],
                "node_name": node["name"],
                "display_name": node["name"],
                "namespace_name": node["namespace"],
                "attributes_json": self._canonical(node["attributes"]),
            }
            for node in normalized["nodes"]
        ]
        edge_rows = [
            {
                "snapshot_id": normalized["snapshot_id"],
                "edge_id": edge["id"],
                "source_node_id": edge["sourceId"],
                "target_node_id": edge["targetId"],
                "kind_code": edge["type"],
                "evidence_type": edge["evidence"]["type"],
                "source_record_id": edge["evidence"]["sourceRecordId"],
                "evidence_description": edge["evidence"]["description"],
                "confidence_code": edge["confidence"],
                "generated_at": normalized["generated_at"],
                "diagnostics_json": self._canonical(edge["diagnostics"]),
            }
            for edge in normalized["edges"]
        ]
        if node_rows:
            self._db.execute_many(insert(lineage_node), node_rows)
        if edge_rows:
            self._db.execute_many(insert(lineage_edge), edge_rows)
        self._db.execute(update(lineage_snapshot).where(lineage_snapshot.c.status_code == "ACTIVE").values(status_code="INACTIVE"))
        self._db.execute(update(lineage_snapshot).where(lineage_snapshot.c.snapshot_id == normalized["snapshot_id"]).values(status_code="ACTIVE"))

    @actor_aware
    def ingest_lineage(self, request: LineageMetadataIngestionRequest, *, dry_run: bool = False) -> dict[str, Any]:
        self._validate_contract_version(request.contract_version)
        ingestion_id = str(uuid4())
        context = current_request_context()
        correlation_id = (context.request_id if context and context.request_id else ingestion_id)
        normalized = self._preflight_lineage(request)
        with database_transaction():
            existing = self._lineage_existing(normalized["import_batch_id"])
        if existing is not None:
            same = existing.get("content_hash") == normalized["content_hash"]
            if not same:
                result = self._lineage_result(
                    request,
                    ingestion_id=ingestion_id,
                    correlation_id=correlation_id,
                    dry_run=dry_run,
                    status="rejected",
                    summary=MetadataSummary(received=1, valid=0, conflict=1, nodes=len(normalized["nodes"]), edges=len(normalized["edges"])),
                    items=[self._result_item(0, normalized["import_id"], "conflict", code="IMPORT_CONTENT_CONFLICT", message="importId was already used with different content")],
                    snapshot_id=existing.get("snapshot_id"),
                )
                raise MetadataConflictError("lineage importId conflicts with an existing snapshot", details=result)
            summary = MetadataSummary(received=1, valid=1, unchanged=1, nodes=len(normalized["nodes"]), edges=len(normalized["edges"]))
            if not dry_run:
                with self._operation_logs.batch_audit(
                    batch_id=ingestion_id,
                    resource_type="metadata-lineage",
                    operation="PUBLISH_SNAPSHOT",
                    total_count=1,
                    summary="metadata lineage idempotent replay",
                ) as audit:
                    audit.success_count = 0
                    audit.skipped_count = 1
                    audit.summary = self._audit_summary(request, summary, ingestion_id, kind="lineage", snapshot_id=existing.get("snapshot_id"))
            return self._lineage_result(request, ingestion_id=ingestion_id, correlation_id=correlation_id, dry_run=dry_run, status="preview" if dry_run else "already_applied", summary=summary, items=[self._result_item(0, normalized["import_id"], "unchanged", action="unchanged")], snapshot_id=existing.get("snapshot_id"))

        summary = MetadataSummary(received=1, valid=1, create=1, nodes=len(normalized["nodes"]), edges=len(normalized["edges"]))
        item = self._result_item(0, normalized["import_id"], "create", action="create")
        if dry_run:
            return self._lineage_result(request, ingestion_id=ingestion_id, correlation_id=correlation_id, dry_run=True, status="preview", summary=summary, items=[item], snapshot_id=normalized["snapshot_id"])

        with self._operation_logs.batch_audit(
            batch_id=ingestion_id,
            resource_type="metadata-lineage",
            operation="PUBLISH_SNAPSHOT",
            total_count=1,
            summary="metadata lineage ingestion pending",
        ) as audit:
            self._persist_lineage(request, normalized, ingestion_id)
            audit.success_count = 1
            audit.created_count = 1
            audit.summary = self._audit_summary(request, summary, ingestion_id, kind="lineage", snapshot_id=normalized["snapshot_id"])
        return self._lineage_result(request, ingestion_id=ingestion_id, correlation_id=correlation_id, dry_run=False, status="completed", summary=summary, items=[item], snapshot_id=normalized["snapshot_id"])

    def get_ingestion(self, ingestion_id: str) -> dict[str, Any]:
        value = str(ingestion_id or "").strip()
        if not value or len(value) > 64:
            raise MetadataNotFoundError("ingestion was not found")
        try:
            log = self._operation_logs.get_batch_log(value)
        except Exception as error:
            raise MetadataDataSourceError("ingestion audit is temporarily unavailable") from error
        if not log:
            raise MetadataNotFoundError("ingestion was not found")
        try:
            request_params = json.loads(log.get("requestParams") or "{}")
            after = request_params.get("after") or {}
            metadata = json.loads(after.get("summary") or "{}")
        except (TypeError, ValueError, json.JSONDecodeError) as error:
            raise MetadataDataSourceError("ingestion audit record is malformed") from error
        summary = MetadataSummary.model_validate(metadata.get("summary") or {})
        return MetadataIngestionResult(
            ingestion_id=value,
            correlation_id=value,
            status=metadata.get("result") or "completed",
            contract_version=metadata.get("contractVersion") or "1.0",
            dry_run=False,
            duration_ms=self._safe_int(log.get("costTimeMs")),
            source=metadata.get("source") or {"type": "unknown", "name": "unknown"},
            collector=metadata.get("collector") or {"name": "unknown", "version": "unknown"},
            summary=summary,
            snapshot_id=metadata.get("snapshotId"),
        ).model_dump(by_alias=True, exclude_none=True)


metadata_ingestion_service = MetadataIngestionService()


__all__ = [
    "MetadataConflictError",
    "MetadataDataSourceError",
    "MetadataIngestionError",
    "MetadataIngestionService",
    "MetadataNotFoundError",
    "MetadataPayloadTooLargeError",
    "MetadataValidationError",
    "metadata_ingestion_service",
]
