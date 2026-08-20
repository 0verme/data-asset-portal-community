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

from sqlalchemy import and_, case, distinct, func, or_, select

from ..db.facade import database_transaction
from ..db.service import CoreAccess
from ..db.tables import data_source, mapping_field, mapping_table
from ..settings import get_int_env, get_page_size_limits
from ..utils.service_perf import log_slow_service_call


LOGGER = logging.getLogger(__name__)

FIELD_SORT_COLUMNS = {
    "srcSystem": data_source.c.source_name,
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


class FieldMappingService:
    def __init__(self):
        self._db_profile = os.getenv("ASSET_DB_PROFILE", "").strip()
        self._stats_cache = {}
        self._db = CoreAccess(
            profile_getter=lambda: self._db_profile,
            error_factory=FieldMappingDataSourceError,
        )

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
        return data_source.join(
            mapping_table,
            and_(
                data_source.c.source_id == mapping_table.c.data_source_id,
                mapping_table.c.is_deleted == "N",
            ),
        ).join(
            mapping_field,
            and_(
                mapping_table.c.table_pk == mapping_field.c.table_pk,
                mapping_field.c.is_deleted == "N",
            ),
        )

    @staticmethod
    def _append_like(clauses, column, value):
        text = str(value or "").strip().lower()
        if text:
            escaped = text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            clauses.append(
                func.lower(func.coalesce(column, "")).like(
                    f"%{escaped}%", escape="\\"
                )
            )

    def _build_where(self, params=None):
        params = params or {}
        clauses = [data_source.c.is_deleted == "N"]

        upstream_system_id = str(params.get("upstreamSystemId") or "").strip()
        if upstream_system_id.isdigit():
            clauses.append(data_source.c.source_id == int(upstream_system_id))

        src_system = str(params.get("srcSystem") or "").strip()
        if src_system:
            clauses.append(data_source.c.source_name == src_system)

        self._append_like(clauses, mapping_table.c.source_table_name, params.get("srcTable"))
        self._append_like(clauses, mapping_field.c.source_field_name, params.get("srcField"))
        self._append_like(clauses, mapping_table.c.target_table_name, params.get("targetTable"))
        self._append_like(clauses, mapping_field.c.target_field_name, params.get("targetField"))

        empty_comment = str(params.get("emptyComment") or "").strip()
        comment = func.trim(func.coalesce(mapping_field.c.source_field_comment, ""))
        if empty_comment == "yes":
            clauses.append(comment == "")
        elif empty_comment == "no":
            clauses.append(comment != "")

        keyword = str(params.get("keyword") or "").strip().lower()
        if keyword:
            escaped = keyword.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            pattern = f"%{escaped}%"
            searchable = (
                data_source.c.source_name,
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
                        func.lower(func.coalesce(column, "")).like(
                            pattern, escape="\\"
                        )
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
            page_size = int(params.get("pageSize") or params.get("limit") or default_page_size)
        except (TypeError, ValueError):
            page_size = default_page_size
        return max(1, page), max(1, min(max_page_size, page_size))

    def _stats_cache_key(self, params=None):
        relevant = {
            "keyword": (params or {}).get("keyword"),
            "upstreamSystemId": (params or {}).get("upstreamSystemId"),
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
        self._stats_cache[self._stats_cache_key(params)] = {"ts": time.time(), "value": value}

    def clear_stats_cache(self):
        self._stats_cache.clear()

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
            self._null_last_text_order_terms(data_source.c.source_name)
            + self._null_last_text_order_terms(mapping_table.c.source_table_name)
            + self._null_last_text_order_terms(mapping_table.c.target_table_name)
        )

    def _field_default_order_terms(self):
        return (
            self._null_last_text_order_terms(data_source.c.source_name)
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
            data_source.c.source_id.label("upstream_system_id"),
            data_source.c.source_code.label("system_code"),
            data_source.c.source_name.label("system_name"),
            func.coalesce(data_source.c.source_type, "").label("system_abbr"),
            mapping_table.c.source_table_name,
            mapping_table.c.source_table_cn,
            func.coalesce(mapping_table.c.target_layer_code, "DWF").label("target_layer_code"),
            func.coalesce(mapping_table.c.target_table_name, "").label("target_table_name"),
            func.coalesce(mapping_table.c.load_mode, "").label("load_mode"),
            mapping_field.c.source_field_name,
            func.coalesce(mapping_field.c.source_field_type, "").label("source_field_type"),
            func.coalesce(mapping_field.c.source_field_comment, "").label("source_field_comment"),
            func.coalesce(mapping_field.c.target_field_name, "").label("target_field_name"),
            func.coalesce(mapping_field.c.mapping_rule, "待补充").label("mapping_rule"),
            func.coalesce(
                mapping_field.c.updated_at,
                mapping_table.c.updated_at,
                func.current_timestamp(),
            ).label("updated_at"),
        )

    def _row_to_field_mapping(self, row):
        return {
            "dataSourceId": row["upstream_system_id"],
            "upstreamSystemId": row["upstream_system_id"],
            "systemCode": row["system_code"],
            "srcSystem": row["system_name"],
            "systemAbbr": row["system_abbr"],
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
                data_source.c.source_name.label("name"),
                func.count().label("count"),
                data_source.c.source_id.label("upstream_system_id"),
                data_source.c.source_code.label("system_code"),
                func.coalesce(data_source.c.source_type, "").label("system_abbr"),
            )
            .select_from(self._base_from())
            .where(data_source.c.is_deleted == "N")
            .group_by(
                data_source.c.source_id,
                data_source.c.source_code,
                data_source.c.source_name,
                data_source.c.source_type,
            )
            .order_by(data_source.c.source_name)
        )
        return [
            {
                "name": row["name"],
                "count": int(row["count"] or 0),
                "dataSourceId": row["upstream_system_id"],
                "upstreamSystemId": row["upstream_system_id"],
                "systemCode": row["system_code"],
                "systemAbbr": row["system_abbr"],
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
                func.count(distinct(data_source.c.source_id)).label("source_system_count"),
                func.count(distinct(mapping_table.c.table_pk)).label("source_table_count"),
                func.count(distinct(mapping_field.c.field_pk)).label("field_count"),
                func.count(
                    distinct(
                        case(
                            (
                                func.trim(func.coalesce(mapping_field.c.target_field_name, ""))
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
                                func.trim(func.coalesce(mapping_field.c.source_field_comment, ""))
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
        total_count = int(row.get("field_count") or 0)
        mapped_count = int(row.get("mapped_field_count") or 0)
        empty_comment_count = int(row.get("empty_comment_count") or 0)
        result = {
            "sourceSystemCount": int(row.get("source_system_count") or 0),
            "sourceTableCount": int(row.get("source_table_count") or 0),
            "fieldCount": total_count,
            "mappedFieldCount": mapped_count,
            "unmappedFieldCount": total_count - mapped_count,
            "emptyCommentCount": empty_comment_count,
            "emptyCommentRate": round(empty_comment_count * 100 / total_count) if total_count else 0,
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
        total = int(total_rows[0]["total"]) if total_rows else 0

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
        sort_direction = "DESC" if str(params.get("sortDirection") or "").strip().lower() == "desc" else "ASC"
        sort_column = FIELD_SORT_COLUMNS.get(sort_key)
        if not sort_column:
            return self._field_default_order_terms()
        return self._null_last_text_order_terms(sort_column, sort_direction) + self._field_default_order_terms()

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
        total = int(total_rows[0]["total"]) if total_rows else 0

        source_table_cn = func.coalesce(
            mapping_table.c.source_table_cn, mapping_table.c.source_table_name
        ).label("source_table_cn")
        statement = (
            select(
                data_source.c.source_id.label("upstream_system_id"),
                data_source.c.source_code.label("system_code"),
                data_source.c.source_name.label("system_name"),
                func.coalesce(data_source.c.source_type, "").label("system_abbr"),
                mapping_table.c.source_table_name,
                source_table_cn,
                func.coalesce(mapping_table.c.target_layer_code, "DWF").label("target_layer_code"),
                func.coalesce(mapping_table.c.target_table_name, "").label("target_table_name"),
                func.coalesce(mapping_table.c.load_mode, "").label("load_mode"),
                func.count().label("field_count"),
                func.sum(
                    case(
                        (
                            func.trim(func.coalesce(mapping_field.c.target_field_name, "")) != "",
                            1,
                        ),
                        else_=0,
                    )
                ).label("mapped_count"),
                func.sum(
                    case(
                        (
                            func.trim(func.coalesce(mapping_field.c.source_field_comment, "")) == "",
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
                data_source.c.source_code,
                data_source.c.source_name,
                data_source.c.source_type,
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
            field_count = int(row["field_count"] or 0)
            empty_comment_count = int(row["empty_comment_count"] or 0)
            items.append(
                {
                    "dataSourceId": row["upstream_system_id"],
                    "upstreamSystemId": row["upstream_system_id"],
                    "systemCode": row["system_code"],
                    "srcSystem": row["system_name"],
                    "systemAbbr": row["system_abbr"],
                    "srcTable": row["source_table_name"],
                    "srcTableCn": row["source_table_cn"],
                    "targetLayer": row["target_layer_code"],
                    "targetTable": row["target_table_name"],
                    "loadMode": row["load_mode"],
                    "fieldCount": field_count,
                    "mappedCount": int(row["mapped_count"] or 0),
                    "emptyCommentCount": empty_comment_count,
                    "emptyCommentRate": round(empty_comment_count * 100 / field_count) if field_count else 0,
                    "updatedAt": self._format_date(row["updated_at"]),
                }
            )
        return {"items": items, "total": total, "page": page, "pageSize": page_size}


field_mapping_service = FieldMappingService()
