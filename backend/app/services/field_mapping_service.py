# Copyright 2025 Jearhe
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

from __future__ import annotations

import json
import logging
import os
import time
from datetime import date, datetime
from typing import Any

from sqlalchemy import (  # pyright: ignore[reportMissingImports]
    and_,
    case,
    distinct,
    func,
    insert,
    or_,
    select,
    update,
)

from ..application import AuditActorMixin, actor_aware
from ..contracts.field_mapping import (  # pyright: ignore[reportMissingImports]
    FieldMappingImportError,
    FieldMappingImportItemRequest,
    FieldMappingImportItemResult,
    FieldMappingImportRequest,
    FieldMappingImportResponse,
    FieldMappingImportSummary,
)
from ..db.facade import (
    active_transaction_connection,
    database_transaction,
    resolve_db_profile_name,
)
from ..db.service import CoreAccess
from ..db.tables import data_source, mapping_field, mapping_table, upstream_system
from ..settings import get_int_env, get_page_size_limits
from ..utils.service_perf import log_slow_service_call
from .operation_log_service import (
    OPERATION_TYPE_IMPORT,
    OperationLogService,
    operation_log_service,
)

LOGGER = logging.getLogger(__name__)

FIELD_SORT_COLUMNS = {
    "srcSystem": upstream_system.c.system_name,
    "srcTable": mapping_table.c.source_table_name,
    "srcField": mapping_field.c.source_field_name,
    "srcType": mapping_field.c.source_field_type,
    "srcComment": mapping_field.c.source_field_comment,
    "targetTable": mapping_table.c.target_table_name,
    "targetField": mapping_field.c.target_field_name,
    "mappingRule": mapping_field.c.mapping_rule,
}


class FieldMappingDataSourceError(Exception):
    def __init__(self, message):
        self.message = message
        super().__init__(message)

    def to_dict(self):
        return {"code": "FIELD_MAPPING_DATA_SOURCE_ERROR", "message": self.message}


class FieldMappingImportItemError(ValueError):
    """A business error that can be reported without aborting other items."""

    def __init__(self, code: str, message: str):
        self.code = code
        self.message = message
        super().__init__(message)


_ENABLED_DATA_SOURCE_STATUSES = frozenset(
    {"Y", "YES", "TRUE", "1", "ACTIVE", "ENABLED"}
)
_TABLE_COMPARE_KEYS = (
    "upstream_system_id",
    "data_source_id",
    "source_table_name",
    "source_table_cn",
    "target_layer_code",
    "target_table_name",
    "load_mode",
    "field_total_count",
    "mapped_field_count",
    "table_desc",
)
_FIELD_COMPARE_KEYS = (
    "source_field_name",
    "source_field_type",
    "source_field_comment",
    "target_field_name",
    "mapping_rule",
    "field_order",
)


class FieldMappingService(AuditActorMixin):
    def __init__(
        self,
        *,
        db: CoreAccess | None = None,
        operation_logs: OperationLogService | None = None,
        db_profile: str | None = None,
    ):
        self._db_profile = (db_profile or os.getenv("ASSET_DB_PROFILE", "")).strip()
        self._stats_cache = {}
        self._db = db or CoreAccess(
            profile_getter=lambda: self._db_profile,
            error_factory=FieldMappingDataSourceError,
        )
        self._operation_logs = operation_logs or operation_log_service

    def _profile(self) -> str:
        return self._db_profile or resolve_db_profile_name()

    def _fetch_rows(self, statement):
        return self._db.fetch_rows(statement)

    def _fetch_rows_logged(
        self, statement, *, purpose, method, page=None, page_size=None, keyword=None
    ):
        started_at = time.perf_counter()
        try:
            return self._fetch_rows(statement)
        finally:
            log_slow_service_call(
                LOGGER,
                service="FieldMappingService",
                method=method,
                purpose=purpose,
                started_at=started_at,
                page=page,
                page_size=page_size,
                keyword=keyword,
            )

    @staticmethod
    def _format_date(value):
        if isinstance(value, datetime):
            return value.strftime("%Y-%m-%d")
        if isinstance(value, date):
            return value.strftime("%Y-%m-%d")
        text = str(value or "").strip()
        return text[:10] if len(text) >= 10 else text

    @staticmethod
    def _base_from():
        # ``upstream_system_id`` is the mapping identity.  ``data_source`` is
        # an older, optional catalog relation and must not decide which
        # upstream system owns a mapping.
        return (
            mapping_table.join(
                upstream_system,
                and_(
                    mapping_table.c.upstream_system_id == upstream_system.c.system_pk,
                    mapping_table.c.is_deleted == "N",
                    upstream_system.c.is_deleted == "N",
                ),
            )
            .outerjoin(
                data_source,
                data_source.c.source_id == mapping_table.c.data_source_id,
            )
            .join(
                mapping_field,
                and_(
                    mapping_table.c.table_pk == mapping_field.c.table_pk,
                    mapping_field.c.is_deleted == "N",
                ),
            )
        )

    @staticmethod
    def _append_like(clauses, column, value):
        text = str(value or "").strip().lower()
        if text:
            escaped = text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            clauses.append(
                func.lower(func.coalesce(column, "")).like(f"%{escaped}%", escape="\\")
            )

    def _build_where(self, params=None):
        params = params or {}
        clauses = []

        # The canonical filter is the upstream table's primary key.  The
        # historical upstreamSystemId alias is also resolved against that
        # table (and may still carry the old unique technical system_id).
        source_system_id = str(
            params.get("sourceSystemId") or params.get("source_system_id") or ""
        ).strip()
        legacy_upstream_system_id = str(params.get("upstreamSystemId") or "").strip()
        if source_system_id:
            if source_system_id.isdigit():
                clauses.append(
                    upstream_system.c.system_pk == self._safe_int(source_system_id)
                )
            else:
                clauses.append(upstream_system.c.system_id == source_system_id)
        elif legacy_upstream_system_id:
            if legacy_upstream_system_id.isdigit():
                clauses.append(
                    upstream_system.c.system_pk
                    == self._safe_int(legacy_upstream_system_id)
                )
            else:
                clauses.append(upstream_system.c.system_id == legacy_upstream_system_id)
        else:
            # dataSourceId remains a deprecated catalog compatibility filter;
            # it is never promoted to an upstream identity.
            data_source_id = str(params.get("dataSourceId") or "").strip()
            if data_source_id.isdigit():
                clauses.append(
                    data_source.c.source_id == self._safe_int(data_source_id)
                )

        # srcSystem is retained only as a non-identity, deprecated display
        # filter.  If names collide it intentionally returns every matching
        # upstream system instead of choosing one.
        src_system = str(params.get("srcSystem") or "").strip()
        if src_system:
            clauses.append(upstream_system.c.system_name == src_system)

        self._append_like(
            clauses, mapping_table.c.source_table_name, params.get("srcTable")
        )
        self._append_like(
            clauses, mapping_field.c.source_field_name, params.get("srcField")
        )
        self._append_like(
            clauses, mapping_table.c.target_table_name, params.get("targetTable")
        )
        self._append_like(
            clauses, mapping_field.c.target_field_name, params.get("targetField")
        )

        empty_comment = str(params.get("emptyComment") or "").strip()
        comment = func.trim(func.coalesce(mapping_field.c.source_field_comment, ""))
        if empty_comment == "yes":
            clauses.append(comment == "")
        elif empty_comment == "no":
            clauses.append(comment != "")

        keyword = str(params.get("keyword") or "").strip().lower()
        if keyword:
            escaped = (
                keyword.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            )
            pattern = f"%{escaped}%"
            searchable = (
                upstream_system.c.system_name,
                upstream_system.c.system_abbr,
                upstream_system.c.system_id,
                data_source.c.source_name,
                data_source.c.source_code,
                mapping_table.c.source_table_name,
                mapping_table.c.source_table_cn,
                mapping_field.c.source_field_name,
                mapping_field.c.source_field_type,
                mapping_field.c.source_field_comment,
                mapping_table.c.target_table_name,
                mapping_field.c.target_field_name,
                mapping_field.c.mapping_rule,
            )
            clauses.append(
                or_(
                    *(
                        func.lower(func.coalesce(column, "")).like(pattern, escape="\\")
                        for column in searchable
                    )
                )
            )
        return clauses

    def _resolve_paging(self, params=None):
        default_page_size, max_page_size = get_page_size_limits(50)
        params = params or {}
        try:
            page = int(params.get("page") or 1)
        except (TypeError, ValueError):
            page = 1
        try:
            page_size = int(
                params.get("pageSize") or params.get("limit") or default_page_size
            )
        except (TypeError, ValueError):
            page_size = default_page_size
        return max(1, page), max(1, min(max_page_size, page_size))

    def _stats_cache_key(self, params=None):
        relevant = {
            "keyword": (params or {}).get("keyword"),
            "sourceSystemId": (params or {}).get("sourceSystemId"),
            "source_system_id": (params or {}).get("source_system_id"),
            "upstreamSystemId": (params or {}).get("upstreamSystemId"),
            "dataSourceId": (params or {}).get("dataSourceId"),
            "srcSystem": (params or {}).get("srcSystem"),
            "srcTable": (params or {}).get("srcTable"),
            "srcField": (params or {}).get("srcField"),
            "emptyComment": (params or {}).get("emptyComment"),
            "targetTable": (params or {}).get("targetTable"),
            "targetField": (params or {}).get("targetField"),
        }
        return json.dumps(relevant, ensure_ascii=False, sort_keys=True)

    def _get_cached_stats(self, params=None):
        key = self._stats_cache_key(params)
        entry = self._stats_cache.get(key)
        if not entry:
            return None
        if time.time() - entry["ts"] > get_int_env(
            "FIELD_MAPPING_STATS_CACHE_TTL_SECONDS", 300, minimum=1
        ):
            self._stats_cache.pop(key, None)
            return None
        return entry["value"]

    def _set_cached_stats(self, params, value):
        self._stats_cache[self._stats_cache_key(params)] = {
            "ts": time.time(),
            "value": value,
        }

    def clear_stats_cache(self):
        self._stats_cache.clear()

    @staticmethod
    def _is_active(value: Any) -> bool:
        return str(value or "").strip().upper() == "N"

    @staticmethod
    def _is_enabled_status(value: Any) -> bool:
        return str(value or "").strip().upper() in _ENABLED_DATA_SOURCE_STATUSES

    @staticmethod
    def _optional_text(value: Any) -> str | None:
        if value is None:
            return None
        normalized = str(value).strip()
        return normalized or None

    @staticmethod
    def _safe_int(value: Any, default: int = 0) -> int:
        try:
            return int(value)
        except (TypeError, ValueError, OverflowError):
            return default

    @staticmethod
    def _same_value(key: str, left: Any, right: Any) -> bool:
        if key in {
            "source_table_name",
            "target_table_name",
            "source_field_name",
            "target_field_name",
        }:
            return (
                str(left or "").strip().casefold()
                == str(right or "").strip().casefold()
            )
        if key in {"target_layer_code", "load_mode"}:
            return (
                str(left or "").strip().casefold()
                == str(right or "").strip().casefold()
            )
        if key in {
            "source_table_cn",
            "table_desc",
            "source_field_type",
            "source_field_comment",
        }:
            left_text = "" if left is None else str(left).strip()
            right_text = "" if right is None else str(right).strip()
            return left_text == right_text
        return left == right

    @staticmethod
    def _provided(model: Any, field_name: str) -> bool:
        return field_name in getattr(model, "model_fields_set", set())

    def _load_import_data_source(self, data_source_id: int) -> dict[str, Any]:
        rows = self._fetch_rows(
            select(
                data_source.c.source_id,
                data_source.c.status_code,
                data_source.c.is_deleted,
            ).where(data_source.c.source_id == data_source_id)
        )
        if not rows:
            raise FieldMappingImportItemError(
                "DATA_SOURCE_NOT_FOUND", "数据源不存在或已删除"
            )
        row = rows[0]
        if not self._is_active(row.get("is_deleted")) or not self._is_enabled_status(
            row.get("status_code")
        ):
            raise FieldMappingImportItemError(
                "DATA_SOURCE_NOT_AVAILABLE", "数据源不存在或未启用"
            )
        return row

    def _load_import_source_system(
        self, item: FieldMappingImportItemRequest
    ) -> tuple[dict[str, Any], int, int | None]:
        requested_source_system_id = item.source_system_id
        requested_data_source_id = item.data_source_id
        if requested_data_source_id is not None:
            self._load_import_data_source(requested_data_source_id)

        if requested_source_system_id is not None:
            rows = self._fetch_rows(
                select(upstream_system).where(
                    upstream_system.c.system_pk == requested_source_system_id
                )
            )
            if not rows:
                raise FieldMappingImportItemError(
                    "UPSTREAM_SYSTEM_NOT_FOUND", "上游系统不存在或已删除"
                )
        elif requested_data_source_id is not None:
            rows = self._fetch_rows(
                select(upstream_system).where(
                    upstream_system.c.data_source_id == requested_data_source_id
                )
            )
        else:
            raise FieldMappingImportItemError(
                "UPSTREAM_SYSTEM_NOT_FOUND", "必须提供有效的上游系统标识"
            )

        active_rows = [
            row
            for row in rows
            if self._is_active(row.get("is_deleted"))
            and self._is_enabled_status(row.get("status_code"))
        ]
        if requested_source_system_id is None and len(active_rows) > 1:
            raise FieldMappingImportItemError(
                "UPSTREAM_SYSTEM_AMBIGUOUS",
                "数据源对应多个有效上游系统，请改用 sourceSystemId",
            )
        if not active_rows:
            raise FieldMappingImportItemError(
                "UPSTREAM_SYSTEM_NOT_AVAILABLE", "上游系统不存在或未启用"
            )
        owner = active_rows[0]
        resolved_source_system_id = self._safe_int(owner.get("system_pk"))
        if resolved_source_system_id <= 0:
            raise FieldMappingImportItemError(
                "UPSTREAM_SYSTEM_NOT_FOUND", "上游系统主键无效"
            )

        owner_data_source_id = (
            self._safe_int(owner.get("data_source_id"), default=0) or None
        )
        if (
            requested_data_source_id is not None
            and owner_data_source_id != requested_data_source_id
        ):
            raise FieldMappingImportItemError(
                "IDENTITY_MISMATCH", "sourceSystemId 与 dataSourceId 不属于同一上游系统"
            )
        if owner_data_source_id is not None and requested_data_source_id is None:
            self._load_import_data_source(owner_data_source_id)
        return owner, resolved_source_system_id, owner_data_source_id

    def _load_import_table(
        self, source_system_id: int, source_table: str
    ) -> dict[str, Any] | None:
        rows = self._fetch_rows(
            select(mapping_table)
            .where(
                and_(
                    mapping_table.c.upstream_system_id == source_system_id,
                    func.lower(mapping_table.c.source_table_name)
                    == source_table.casefold(),
                )
            )
            .order_by(mapping_table.c.table_pk.asc())
        )
        active = [row for row in rows if self._is_active(row.get("is_deleted"))]
        if len(active) > 1:
            raise FieldMappingImportItemError(
                "DUPLICATE_TABLE_IDENTITY",
                "同一上游系统和源表名存在多条有效表映射",
            )
        if active:
            return active[0]
        deleted = [row for row in rows if not self._is_active(row.get("is_deleted"))]
        if len(deleted) > 1:
            raise FieldMappingImportItemError(
                "DUPLICATE_TABLE_IDENTITY",
                "同一上游系统和源表名存在多条已删除表映射",
            )
        return deleted[0] if deleted else None

    def _load_import_fields(
        self, table_pk: int
    ) -> dict[tuple[str, str], dict[str, Any]]:
        rows = self._fetch_rows(
            select(mapping_field)
            .where(mapping_field.c.table_pk == table_pk)
            .order_by(mapping_field.c.field_pk.asc())
        )
        result: dict[tuple[str, str], dict[str, Any]] = {}
        for row in rows:
            key = self._field_identity(
                row.get("source_field_name"), row.get("target_field_name")
            )
            previous = result.get(key)
            if previous is None:
                result[key] = row
                continue
            if self._is_active(previous.get("is_deleted")) and self._is_active(
                row.get("is_deleted")
            ):
                raise FieldMappingImportItemError(
                    "DUPLICATE_FIELD_IDENTITY",
                    "同一表映射存在重复的源字段和目标字段",
                )
            if not self._is_active(previous.get("is_deleted")) and self._is_active(
                row.get("is_deleted")
            ):
                result[key] = row
        return result

    @staticmethod
    def _field_identity(source_field: Any, target_field: Any) -> tuple[str, str]:
        return (
            str(source_field or "").strip().casefold(),
            str(target_field or "").strip().casefold(),
        )

    @staticmethod
    def _field_values_from_row(row: dict[str, Any]) -> dict[str, Any]:
        return {key: row.get(key) for key in _FIELD_COMPARE_KEYS}

    def _normalize_import_field(
        self,
        field: FieldMappingImportItemRequest,
        current: dict[str, Any] | None,
    ) -> dict[str, Any]:
        values = {
            "source_field_name": field.source_field,
            "source_field_type": field.source_type,
            "source_field_comment": field.source_comment,
            "target_field_name": field.target_field,
            "mapping_rule": field.mapping_rule,
            "field_order": field.field_order,
        }
        if current is not None:
            for model_name, column_name in (
                ("source_type", "source_field_type"),
                ("source_comment", "source_field_comment"),
                ("target_field", "target_field_name"),
                ("mapping_rule", "mapping_rule"),
            ):
                if not self._provided(field, model_name):
                    values[column_name] = current.get(column_name)
            values["source_field_name"] = (
                current.get("source_field_name") or field.source_field
            )
        values["source_field_name"] = str(values["source_field_name"]).strip()
        values["source_field_type"] = self._optional_text(values["source_field_type"])
        values["source_field_comment"] = self._optional_text(
            values["source_field_comment"]
        )
        values["target_field_name"] = self._optional_text(values["target_field_name"])
        values["mapping_rule"] = str(values["mapping_rule"] or "待补充").strip()
        values["field_order"] = self._safe_int(values["field_order"])
        if values["field_order"] < 1:
            raise FieldMappingImportItemError(
                "INVALID_FIELD_ORDER", "字段顺序必须是正整数"
            )
        return values

    @classmethod
    def _field_content_equal(
        cls, current: dict[str, Any], desired: dict[str, Any]
    ) -> bool:
        return all(
            cls._same_value(key, current.get(key), desired.get(key))
            for key in _FIELD_COMPARE_KEYS
        )

    @classmethod
    def _table_content_equal(
        cls, current: dict[str, Any], desired: dict[str, Any]
    ) -> bool:
        return all(
            cls._same_value(key, current.get(key), desired.get(key))
            for key in _TABLE_COMPARE_KEYS
        )

    def _prepare_import_item(
        self, index: int, item: FieldMappingImportItemRequest
    ) -> dict[str, Any]:
        _owner, source_system_id, data_source_id = self._load_import_source_system(item)
        source_table = item.source_table.strip()
        current_table = self._load_import_table(source_system_id, source_table)
        current_fields = (
            self._load_import_fields(self._safe_int(current_table.get("table_pk")))
            if current_table is not None
            else {}
        )
        field_actions: list[dict[str, Any]] = []
        final_fields = {
            key: self._field_values_from_row(row)
            for key, row in current_fields.items()
            if self._is_active(row.get("is_deleted"))
        }
        seen_incoming: set[tuple[str, str]] = set()
        for field in item.fields:
            identity = self._field_identity(field.source_field, field.target_field)
            if identity in seen_incoming:
                raise FieldMappingImportItemError(
                    "DUPLICATE_FIELD_IDENTITY",
                    "请求中存在重复的源字段和目标字段",
                )
            seen_incoming.add(identity)
            current = current_fields.get(identity)
            desired = self._normalize_import_field(field, current)
            if current is None:
                action = "create"
            elif not self._is_active(
                current.get("is_deleted")
            ) or not self._field_content_equal(current, desired):
                action = "update"
            else:
                action = "unchanged"
            field_actions.append(
                {"action": action, "current": current, "values": desired}
            )
            final_fields[identity] = desired

        provided = getattr(item, "model_fields_set", set())
        if current_table is None or "source_table_cn" in provided:
            source_table_cn = item.source_table_cn
        else:
            source_table_cn = current_table.get("source_table_cn")
        if current_table is None and "source_table_cn" not in provided:
            source_table_cn = source_table
        if current_table is None or "target_layer" in provided:
            target_layer = item.target_layer.strip().upper()
        else:
            target_layer = (
                str(current_table.get("target_layer_code") or "DWF").strip().upper()
            )
        if current_table is None or "target_table" in provided:
            target_table = self._optional_text(item.target_table)
        else:
            target_table = self._optional_text(current_table.get("target_table_name"))
        if current_table is None or "load_mode" in provided:
            load_mode = self._optional_text(item.load_mode)
            load_mode = load_mode.casefold() if load_mode else None
        else:
            load_mode = self._optional_text(current_table.get("load_mode"))
        if current_table is None or "table_desc" in provided:
            table_desc = self._optional_text(item.table_desc)
        else:
            table_desc = self._optional_text(current_table.get("table_desc"))

        table_values = {
            "upstream_system_id": source_system_id,
            "data_source_id": data_source_id,
            "source_table_name": current_table.get("source_table_name")
            if current_table is not None
            else source_table,
            "source_table_cn": self._optional_text(source_table_cn),
            "target_layer_code": target_layer,
            "target_table_name": target_table,
            "load_mode": load_mode,
            "field_total_count": len(final_fields),
            "mapped_field_count": sum(
                bool(str(values.get("target_field_name") or "").strip())
                for values in final_fields.values()
            ),
            "table_desc": table_desc,
        }
        table_changed = (
            current_table is None
            or not self._is_active(current_table.get("is_deleted"))
            or not self._table_content_equal(current_table, table_values)
        )
        field_changed = any(
            action["action"] in {"create", "update"} for action in field_actions
        )
        action = (
            "created"
            if current_table is None
            else "updated"
            if table_changed or field_changed
            else "unchanged"
        )
        identity = {
            "sourceSystemId": source_system_id,
            "upstreamSystemId": source_system_id,
            "dataSourceId": data_source_id,
            "sourceTable": table_values["source_table_name"],
            "targetTable": table_values["target_table_name"],
        }
        before = None
        if current_table is not None:
            before = {
                "table": {key: current_table.get(key) for key in _TABLE_COMPARE_KEYS},
                "fields": [
                    self._field_values_from_row(row)
                    for row in current_fields.values()
                    if self._is_active(row.get("is_deleted"))
                ],
            }
        after = {
            "table": table_values,
            "fields": list(final_fields.values()),
        }
        return {
            "index": index,
            "item": item,
            "current_table": current_table,
            "table_values": table_values,
            "field_actions": field_actions,
            "table_pk": self._safe_int(current_table["table_pk"])
            if current_table is not None
            else None,
            "action": action,
            "identity": identity,
            "field_count": len(final_fields),
            "created_field_count": sum(
                field_action["action"] == "create" for field_action in field_actions
            ),
            "updated_field_count": sum(
                field_action["action"] == "update" for field_action in field_actions
            ),
            "unchanged_field_count": sum(
                field_action["action"] == "unchanged" for field_action in field_actions
            ),
            "before": before,
            "after": after,
        }

    @staticmethod
    def _import_item_result(prepared: dict[str, Any]) -> dict[str, Any]:
        return FieldMappingImportItemResult(
            index=prepared["index"],
            identity=prepared["identity"],
            action=prepared["action"],
            field_count=prepared["field_count"],
            created_field_count=prepared["created_field_count"],
            updated_field_count=prepared["updated_field_count"],
            unchanged_field_count=prepared["unchanged_field_count"],
        ).model_dump(by_alias=True, exclude_none=True)

    def _persist_import_item(self, prepared: dict[str, Any]) -> None:
        table_pk = prepared["table_pk"]
        table_values = prepared["table_values"]
        operator = self._default_operator
        if table_pk is None:
            table_pk = self._db.next_pk(mapping_table, mapping_table.c.table_pk)
            prepared["table_pk"] = table_pk
            self._db.execute(
                insert(mapping_table).values(
                    table_pk=table_pk,
                    **table_values,
                    is_deleted="N",
                    created_by=operator,
                    created_at=func.current_timestamp(),
                    updated_by=operator,
                    updated_at=func.current_timestamp(),
                    latest_mapping_time=func.current_timestamp(),
                )
            )
        else:
            self._db.execute(
                update(mapping_table)
                .where(mapping_table.c.table_pk == table_pk)
                .values(
                    **table_values,
                    is_deleted="N",
                    updated_by=operator,
                    updated_at=func.current_timestamp(),
                    latest_mapping_time=func.current_timestamp(),
                )
            )

        create_actions = [
            action
            for action in prepared["field_actions"]
            if action["action"] == "create"
        ]
        next_field_pk = (
            self._db.next_pk(mapping_field, mapping_field.c.field_pk)
            if create_actions
            else None
        )
        create_offset = 0
        for field_action in prepared["field_actions"]:
            if field_action["action"] == "unchanged":
                continue
            values = field_action["values"]
            if field_action["action"] == "create":
                if next_field_pk is None:
                    raise RuntimeError(
                        "field primary key allocation was not initialized"
                    )
                self._db.execute(
                    insert(mapping_field).values(
                        field_pk=next_field_pk + create_offset,
                        table_pk=table_pk,
                        **values,
                        is_deleted="N",
                        created_by=operator,
                        created_at=func.current_timestamp(),
                        updated_by=operator,
                        updated_at=func.current_timestamp(),
                    )
                )
                create_offset += 1
                continue
            current = field_action["current"]
            self._db.execute(
                update(mapping_field)
                .where(mapping_field.c.field_pk == current["field_pk"])
                .values(
                    **values,
                    is_deleted="N",
                    updated_by=operator,
                    updated_at=func.current_timestamp(),
                )
            )

    def _preview_import_item(
        self, index: int, item: FieldMappingImportItemRequest
    ) -> dict[str, Any]:
        with database_transaction():
            prepared = self._prepare_import_item(index, item)
        return self._import_item_result(prepared)

    def _import_one_item(
        self, index: int, item: FieldMappingImportItemRequest
    ) -> dict[str, Any]:
        with database_transaction():
            prepared = self._prepare_import_item(index, item)
            result = self._import_item_result(prepared)
            if prepared["action"] == "unchanged":
                return result

            self._persist_import_item(prepared)
            connection = active_transaction_connection(self._profile())
            if connection is None:
                raise RuntimeError(
                    "Required field mapping audit did not use a database connection"
                )
            self._operation_logs.record_required_audit(
                connection=connection,
                module_name="字段映射",
                operation_type=OPERATION_TYPE_IMPORT,
                operation_object=(
                    f"{prepared['identity'].get('sourceSystemId')}:{item.source_table}"
                ),
                before=prepared["before"],
                after=result,
                operation_desc="导入字段映射",
            )
            return result

    @staticmethod
    def _failed_import_item(
        index: int,
        item: FieldMappingImportItemRequest,
        error: FieldMappingImportItemError,
    ) -> dict[str, Any]:
        return FieldMappingImportItemResult(
            index=index,
            identity={
                "sourceSystemId": item.source_system_id,
                "upstreamSystemId": item.source_system_id,
                "dataSourceId": item.data_source_id,
                "sourceTable": item.source_table,
                "targetTable": item.target_table,
            },
            action="failed",
            field_count=0,
            error=FieldMappingImportError(code=error.code, message=error.message),
        ).model_dump(by_alias=True, exclude_none=True)

    @actor_aware
    def import_mappings(self, request: FieldMappingImportRequest) -> dict[str, Any]:
        if not isinstance(request, FieldMappingImportRequest):
            request = FieldMappingImportRequest.model_validate(request)
        results: list[dict[str, Any]] = []
        for index, item in enumerate(request.items):
            try:
                result = (
                    self._preview_import_item(index, item)
                    if request.dry_run
                    else self._import_one_item(index, item)
                )
            except FieldMappingImportItemError as error:
                result = self._failed_import_item(index, item, error)
            except Exception:
                LOGGER.exception(
                    "Field mapping import item failed: index=%s data_source_id=%s source_table=%s",
                    index,
                    item.data_source_id,
                    item.source_table,
                )
                result = self._failed_import_item(
                    index,
                    item,
                    FieldMappingImportItemError(
                        "IMPORT_FAILED", "字段映射导入失败，请查看服务日志"
                    ),
                )
            results.append(result)
            if not request.dry_run and result["action"] in {"created", "updated"}:
                self.clear_stats_cache()

        summary_values = {
            "received": len(request.items),
            "created": sum(item["action"] == "created" for item in results),
            "updated": sum(item["action"] == "updated" for item in results),
            "unchanged": sum(item["action"] == "unchanged" for item in results),
            "failed": sum(item["action"] == "failed" for item in results),
            "field_count": sum(item.get("fieldCount", 0) for item in results),
            "created_field_count": sum(
                item.get("createdFieldCount", 0) for item in results
            ),
            "updated_field_count": sum(
                item.get("updatedFieldCount", 0) for item in results
            ),
            "unchanged_field_count": sum(
                item.get("unchangedFieldCount", 0) for item in results
            ),
        }
        return FieldMappingImportResponse(
            mode=request.mode,
            dry_run=request.dry_run,
            summary=FieldMappingImportSummary(**summary_values),
            items=results,
        ).model_dump(by_alias=True, exclude_none=True)

    @staticmethod
    def _null_last_text_order_terms(column, direction="ASC"):
        normalized_direction = "DESC" if str(direction).upper() == "DESC" else "ASC"
        empty = or_(column.is_(None), func.trim(column) == "")
        value = column.desc() if normalized_direction == "DESC" else column.asc()
        return [case((empty, 1), else_=0).asc(), value]

    @staticmethod
    def _null_last_numeric_order_terms(column):
        return [case((column.is_(None), 1), else_=0).asc(), column.asc()]

    def _table_default_order_terms(self):
        return (
            self._null_last_text_order_terms(upstream_system.c.system_name)
            + self._null_last_text_order_terms(upstream_system.c.system_abbr)
            + [upstream_system.c.system_pk.asc()]
            + self._null_last_text_order_terms(mapping_table.c.source_table_name)
            + self._null_last_text_order_terms(mapping_table.c.target_table_name)
        )

    def _field_default_order_terms(self):
        return (
            self._null_last_text_order_terms(upstream_system.c.system_name)
            + self._null_last_text_order_terms(upstream_system.c.system_abbr)
            + [upstream_system.c.system_pk.asc()]
            + self._null_last_text_order_terms(mapping_table.c.source_table_name)
            + self._null_last_numeric_order_terms(mapping_field.c.field_order)
            + self._null_last_text_order_terms(mapping_field.c.source_field_name)
            + self._null_last_text_order_terms(mapping_table.c.target_table_name)
            + self._null_last_text_order_terms(mapping_field.c.target_field_name)
            + [mapping_table.c.table_pk.asc(), mapping_field.c.field_pk.asc()]
        )

    @staticmethod
    def _field_select():
        return (
            data_source.c.source_id.label("data_source_id"),
            mapping_table.c.upstream_system_id.label("source_system_id"),
            mapping_table.c.upstream_system_id.label("upstream_system_id"),
            upstream_system.c.system_abbr.label("system_code"),
            upstream_system.c.system_name.label("system_name"),
            upstream_system.c.system_abbr.label("system_abbr"),
            mapping_table.c.source_table_name,
            mapping_table.c.source_table_cn,
            func.coalesce(mapping_table.c.target_layer_code, "DWF").label(
                "target_layer_code"
            ),
            func.coalesce(mapping_table.c.target_table_name, "").label(
                "target_table_name"
            ),
            func.coalesce(mapping_table.c.load_mode, "").label("load_mode"),
            mapping_field.c.source_field_name,
            func.coalesce(mapping_field.c.source_field_type, "").label(
                "source_field_type"
            ),
            func.coalesce(mapping_field.c.source_field_comment, "").label(
                "source_field_comment"
            ),
            func.coalesce(mapping_field.c.target_field_name, "").label(
                "target_field_name"
            ),
            func.coalesce(mapping_field.c.mapping_rule, "待补充").label("mapping_rule"),
            func.coalesce(
                mapping_field.c.updated_at,
                mapping_table.c.updated_at,
                func.current_timestamp(),
            ).label("updated_at"),
        )

    def _row_to_field_mapping(self, row):
        source_system_id = row.get("source_system_id", row.get("upstream_system_id"))
        data_source_id = row.get("data_source_id", source_system_id)
        system_name = row.get("system_name", row.get("src_system"))
        system_code = row.get("system_code", row.get("system_abbr"))
        return {
            "dataSourceId": data_source_id,
            "sourceSystemId": source_system_id,
            "upstreamSystemId": source_system_id,
            "systemName": system_name,
            "systemCode": system_code,
            "srcSystem": system_name,
            "systemAbbr": row.get("system_abbr", system_code),
            "srcTable": row["source_table_name"],
            "srcTableCn": row["source_table_cn"] or row["source_table_name"],
            "srcField": row["source_field_name"],
            "srcType": row["source_field_type"],
            "srcComment": row["source_field_comment"],
            "targetLayer": row["target_layer_code"],
            "targetTable": row["target_table_name"],
            "loadMode": row["load_mode"],
            "targetField": row["target_field_name"],
            "mappingRule": row["mapping_rule"],
            "updatedAt": self._format_date(row["updated_at"]),
        }

    def get_source_systems(self):
        statement = (
            select(
                upstream_system.c.system_pk.label("source_system_id"),
                data_source.c.source_id.label("data_source_id"),
                upstream_system.c.system_name.label("system_name"),
                upstream_system.c.system_abbr.label("system_code"),
                func.count().label("count"),
            )
            .select_from(self._base_from())
            .group_by(
                upstream_system.c.system_pk,
                data_source.c.source_id,
                upstream_system.c.system_name,
                upstream_system.c.system_abbr,
            )
            .order_by(
                upstream_system.c.system_name,
                upstream_system.c.system_abbr,
                upstream_system.c.system_pk,
            )
        )
        return [
            {
                "id": row["source_system_id"],
                "sourceSystemId": row["source_system_id"],
                "upstreamSystemId": row["source_system_id"],
                "dataSourceId": row["data_source_id"],
                "name": row["system_name"],
                "systemName": row["system_name"],
                "systemCode": row["system_code"],
                "systemAbbr": row["system_code"],
                "count": self._safe_int(row.get("count")),
            }
            for row in self._fetch_rows_logged(
                statement,
                purpose="mapping source systems",
                method="get_source_systems",
            )
        ]

    def get_stats(self, params=None):
        cached = self._get_cached_stats(params)
        if cached is not None:
            return cached
        statement = (
            select(
                func.count(distinct(upstream_system.c.system_pk)).label(
                    "source_system_count"
                ),
                func.count(distinct(mapping_table.c.table_pk)).label(
                    "source_table_count"
                ),
                func.count(distinct(mapping_field.c.field_pk)).label("field_count"),
                func.count(
                    distinct(
                        case(
                            (
                                func.trim(
                                    func.coalesce(mapping_field.c.target_field_name, "")
                                )
                                != "",
                                mapping_field.c.field_pk,
                            ),
                            else_=None,
                        )
                    )
                ).label("mapped_field_count"),
                func.count(
                    distinct(
                        case(
                            (
                                func.trim(
                                    func.coalesce(
                                        mapping_field.c.source_field_comment, ""
                                    )
                                )
                                == "",
                                mapping_field.c.field_pk,
                            ),
                            else_=None,
                        )
                    )
                ).label("empty_comment_count"),
            )
            .select_from(self._base_from())
            .where(*self._build_where(params))
        )
        row = (
            self._fetch_rows_logged(
                statement,
                purpose="mapping stats",
                method="get_stats",
                keyword=(params or {}).get("keyword"),
            )
            or [{}]
        )[0]
        total_count = self._safe_int(row.get("field_count"))
        mapped_count = self._safe_int(row.get("mapped_field_count"))
        empty_comment_count = self._safe_int(row.get("empty_comment_count"))
        result = {
            "sourceSystemCount": self._safe_int(row.get("source_system_count")),
            "sourceTableCount": self._safe_int(row.get("source_table_count")),
            "fieldCount": total_count,
            "mappedFieldCount": mapped_count,
            "unmappedFieldCount": total_count - mapped_count,
            "emptyCommentCount": empty_comment_count,
            "emptyCommentRate": round(empty_comment_count * 100 / total_count)
            if total_count
            else 0,
            "coverage": round(mapped_count * 100 / total_count) if total_count else 0,
        }
        self._set_cached_stats(params, result)
        return result

    def get_field_mappings(self, params=None):
        with database_transaction():
            return self._get_field_mappings(params)

    def _get_field_mappings(self, params=None):
        page, page_size = self._resolve_paging(params)
        offset = (page - 1) * page_size
        where = self._build_where(params)

        total_statement = (
            select(func.count().label("total"))
            .select_from(self._base_from())
            .where(*where)
        )
        total_rows = self._fetch_rows_logged(
            total_statement,
            purpose="mapping field total",
            method="get_field_mappings",
            page=page,
            page_size=page_size,
            keyword=(params or {}).get("keyword"),
        )
        total = self._safe_int(total_rows[0].get("total")) if total_rows else 0

        statement = (
            select(*self._field_select())
            .select_from(self._base_from())
            .where(*where)
            .order_by(*self._resolve_field_order(params))
            .limit(page_size)
            .offset(offset)
        )
        items = [
            self._row_to_field_mapping(row)
            for row in self._fetch_rows_logged(
                statement,
                purpose="mapping field page",
                method="get_field_mappings",
                page=page,
                page_size=page_size,
                keyword=(params or {}).get("keyword"),
            )
        ]
        return {"items": items, "total": total, "page": page, "pageSize": page_size}

    def _resolve_field_order(self, params=None):
        params = params or {}
        sort_key = str(params.get("sortKey") or "").strip()
        sort_direction = (
            "DESC"
            if str(params.get("sortDirection") or "").strip().lower() == "desc"
            else "ASC"
        )
        sort_column = FIELD_SORT_COLUMNS.get(sort_key)
        if not sort_column:
            return self._field_default_order_terms()
        return (
            self._null_last_text_order_terms(sort_column, sort_direction)
            + self._field_default_order_terms()
        )

    def get_table_mappings(self, params=None):
        with database_transaction():
            return self._get_table_mappings(params)

    def _get_table_mappings(self, params=None):
        page, page_size = self._resolve_paging(params)
        offset = (page - 1) * page_size
        where = self._build_where(params)

        counted = (
            select(mapping_table.c.table_pk)
            .select_from(self._base_from())
            .where(*where)
            .group_by(mapping_table.c.table_pk)
            .subquery("counted")
        )
        count_statement = select(func.count().label("total")).select_from(counted)
        total_rows = self._fetch_rows_logged(
            count_statement,
            purpose="mapping table total",
            method="get_table_mappings",
            page=page,
            page_size=page_size,
            keyword=(params or {}).get("keyword"),
        )
        total = self._safe_int(total_rows[0].get("total")) if total_rows else 0

        source_table_cn = func.coalesce(
            mapping_table.c.source_table_cn, mapping_table.c.source_table_name
        ).label("source_table_cn")
        statement = (
            select(
                data_source.c.source_id.label("data_source_id"),
                mapping_table.c.upstream_system_id.label("source_system_id"),
                mapping_table.c.upstream_system_id.label("upstream_system_id"),
                upstream_system.c.system_abbr.label("system_code"),
                upstream_system.c.system_name.label("system_name"),
                upstream_system.c.system_abbr.label("system_abbr"),
                mapping_table.c.source_table_name,
                source_table_cn,
                func.coalesce(mapping_table.c.target_layer_code, "DWF").label(
                    "target_layer_code"
                ),
                func.coalesce(mapping_table.c.target_table_name, "").label(
                    "target_table_name"
                ),
                func.coalesce(mapping_table.c.load_mode, "").label("load_mode"),
                func.count().label("field_count"),
                func.sum(
                    case(
                        (
                            func.trim(
                                func.coalesce(mapping_field.c.target_field_name, "")
                            )
                            != "",
                            1,
                        ),
                        else_=0,
                    )
                ).label("mapped_count"),
                func.sum(
                    case(
                        (
                            func.trim(
                                func.coalesce(mapping_field.c.source_field_comment, "")
                            )
                            == "",
                            1,
                        ),
                        else_=0,
                    )
                ).label("empty_comment_count"),
                func.max(
                    func.coalesce(
                        mapping_field.c.updated_at,
                        mapping_table.c.updated_at,
                        func.current_timestamp(),
                    )
                ).label("updated_at"),
            )
            .select_from(self._base_from())
            .where(*where)
            .group_by(
                data_source.c.source_id,
                mapping_table.c.upstream_system_id,
                upstream_system.c.system_pk,
                upstream_system.c.system_abbr,
                upstream_system.c.system_name,
                mapping_table.c.source_table_name,
                mapping_table.c.source_table_cn,
                mapping_table.c.target_layer_code,
                mapping_table.c.target_table_name,
                mapping_table.c.load_mode,
            )
            .order_by(*self._table_default_order_terms())
            .limit(page_size)
            .offset(offset)
        )
        items = []
        for row in self._fetch_rows_logged(
            statement,
            purpose="mapping table page",
            method="get_table_mappings",
            page=page,
            page_size=page_size,
            keyword=(params or {}).get("keyword"),
        ):
            source_system_id = row.get(
                "source_system_id", row.get("upstream_system_id")
            )
            data_source_id = row.get("data_source_id", source_system_id)
            system_name = row.get("system_name", row.get("src_system"))
            system_code = row.get("system_code", row.get("system_abbr"))
            field_count = self._safe_int(row.get("field_count"))
            empty_comment_count = self._safe_int(row.get("empty_comment_count"))
            items.append(
                {
                    "dataSourceId": data_source_id,
                    "sourceSystemId": source_system_id,
                    "upstreamSystemId": source_system_id,
                    "systemName": system_name,
                    "systemCode": system_code,
                    "srcSystem": system_name,
                    "systemAbbr": row.get("system_abbr", system_code),
                    "srcTable": row["source_table_name"],
                    "srcTableCn": row["source_table_cn"],
                    "targetLayer": row["target_layer_code"],
                    "targetTable": row["target_table_name"],
                    "loadMode": row["load_mode"],
                    "fieldCount": field_count,
                    "mappedCount": self._safe_int(row.get("mapped_count")),
                    "emptyCommentCount": empty_comment_count,
                    "emptyCommentRate": round(empty_comment_count * 100 / field_count)
                    if field_count
                    else 0,
                    "updatedAt": self._format_date(row["updated_at"]),
                }
            )
        return {"items": items, "total": total, "page": page, "pageSize": page_size}


field_mapping_service = FieldMappingService()
