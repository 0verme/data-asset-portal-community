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

from ..db.facade import database_transaction, fetch_all, resolve_db_profile_name
from ..settings import get_int_env, get_page_size_limits
from ..utils.service_perf import log_slow_service_call


TABLE_DATA_SOURCE = "dwp.p_data_source"
TABLE_MAPPING_TABLE = "dwp.p_field_mapping_table"
TABLE_MAPPING_FIELD = "dwp.p_field_mapping_field"
LOGGER = logging.getLogger(__name__)

FIELD_SORT_COLUMNS = {
    "srcSystem": "u.system_name",
    "srcTable": "t.source_table_name",
    "srcField": "f.source_field_name",
    "srcType": "f.source_field_type",
    "srcComment": "f.source_field_comment",
    "targetTable": "t.target_table_name",
    "targetField": "f.target_field_name",
    "mappingRule": "f.mapping_rule",
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

    def _profile(self):
        return self._db_profile or resolve_db_profile_name()

    def _fetch_rows(self, sql):
        try:
            columns, rows = fetch_all(self._profile(), sql)
        except FileNotFoundError as error:
            raise FieldMappingDataSourceError(f"database config file not found: {error.filename}") from error
        except KeyError as error:
            raise FieldMappingDataSourceError(str(error)) from error
        except RuntimeError as error:
            raise FieldMappingDataSourceError(str(error)) from error
        except Exception as error:
            raise FieldMappingDataSourceError(f"database query failed: {error}") from error
        return [dict(zip(columns, row)) for row in rows]

    def _fetch_rows_logged(self, sql, *, purpose, method, page=None, page_size=None, keyword=None):
        started_at = time.perf_counter()
        try:
            return self._fetch_rows(sql)
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

    def _quote(self, value):
        return "'" + str(value or "").replace("'", "''") + "'"

    def _format_date(self, value):
        if isinstance(value, datetime):
            return value.strftime("%Y-%m-%d")
        if isinstance(value, date):
            return value.strftime("%Y-%m-%d")
        text = str(value or "").strip()
        return text[:10] if len(text) >= 10 else text

    def _base_from(self):
        return (
            f"FROM {TABLE_DATA_SOURCE} u "
            f"JOIN {TABLE_MAPPING_TABLE} t "
            "  ON u.source_id = t.data_source_id "
            " AND t.is_deleted = 'N' "
            f"JOIN {TABLE_MAPPING_FIELD} f "
            "  ON t.table_pk = f.table_pk "
            " AND f.is_deleted = 'N' "
            "WHERE u.is_deleted = 'N'"
        )

    def _append_like(self, clauses, column, value):
        text = str(value or "").strip().lower()
        if text:
            clauses.append(f"LOWER(COALESCE({column}, '')) LIKE {self._quote(f'%{text}%')}")

    def _build_where(self, params=None):
        params = params or {}
        clauses = []

        upstream_system_id = str(params.get("upstreamSystemId") or "").strip()
        if upstream_system_id.isdigit():
            clauses.append(f"u.source_id = {int(upstream_system_id)}")

        src_system = str(params.get("srcSystem") or "").strip()
        if src_system:
            clauses.append(f"u.source_name = {self._quote(src_system)}")

        self._append_like(clauses, "t.source_table_name", params.get("srcTable"))
        self._append_like(clauses, "f.source_field_name", params.get("srcField"))
        self._append_like(clauses, "t.target_table_name", params.get("targetTable"))
        self._append_like(clauses, "f.target_field_name", params.get("targetField"))

        empty_comment = str(params.get("emptyComment") or "").strip()
        if empty_comment == "yes":
            clauses.append("TRIM(COALESCE(f.source_field_comment, '')) = ''")
        elif empty_comment == "no":
            clauses.append("TRIM(COALESCE(f.source_field_comment, '')) <> ''")

        keyword = str(params.get("keyword") or "").strip().lower()
        if keyword:
            like = self._quote(f"%{keyword}%")
            clauses.append(
                "("
                "LOWER(COALESCE(u.source_name, '')) LIKE {0} OR "
                "LOWER(COALESCE(t.source_table_name, '')) LIKE {0} OR "
                "LOWER(COALESCE(t.source_table_cn, '')) LIKE {0} OR "
                "LOWER(COALESCE(f.source_field_name, '')) LIKE {0} OR "
                "LOWER(COALESCE(f.source_field_type, '')) LIKE {0} OR "
                "LOWER(COALESCE(f.source_field_comment, '')) LIKE {0} OR "
                "LOWER(COALESCE(t.target_table_name, '')) LIKE {0} OR "
                "LOWER(COALESCE(f.target_field_name, '')) LIKE {0} OR "
                "LOWER(COALESCE(f.mapping_rule, '')) LIKE {0}"
                ")".format(like)
            )

        if not clauses:
            return ""
        return " AND " + " AND ".join(clauses)

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
        page = max(1, page)
        page_size = max(1, min(max_page_size, page_size))
        return page, page_size

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
        if time.time() - entry["ts"] > get_int_env("FIELD_MAPPING_STATS_CACHE_TTL_SECONDS", 300, minimum=1):
            self._stats_cache.pop(key, None)
            return None
        return entry["value"]

    def _set_cached_stats(self, params, value):
        self._stats_cache[self._stats_cache_key(params)] = {"ts": time.time(), "value": value}

    def clear_stats_cache(self):
        self._stats_cache.clear()

    def _resolve_field_order(self, params=None):
        params = params or {}
        sort_key = str(params.get("sortKey") or "").strip()
        sort_direction = "DESC" if str(params.get("sortDirection") or "").strip().lower() == "desc" else "ASC"
        sort_column = FIELD_SORT_COLUMNS.get(sort_key)
        if not sort_column:
            return "ORDER BY " + ", ".join(self._field_default_order_terms())

        return "ORDER BY " + ", ".join(
            self._null_last_text_order_terms(sort_column, sort_direction)
            + self._field_default_order_terms()
        )

    def _null_last_text_order_terms(self, column, direction="ASC"):
        normalized_direction = "DESC" if str(direction).upper() == "DESC" else "ASC"
        return [
            f"CASE WHEN {column} IS NULL OR TRIM({column}) = '' THEN 1 ELSE 0 END ASC",
            f"{column} {normalized_direction}",
        ]

    def _null_last_numeric_order_terms(self, column):
        return [
            f"CASE WHEN {column} IS NULL THEN 1 ELSE 0 END ASC",
            f"{column} ASC",
        ]

    def _table_default_order_terms(self):
        return (
            self._null_last_text_order_terms("u.source_name")
            + self._null_last_text_order_terms("t.source_table_name")
            + self._null_last_text_order_terms("t.target_table_name")
        )

    def _field_default_order_terms(self):
        return (
            self._null_last_text_order_terms("u.source_name")
            + self._null_last_text_order_terms("t.source_table_name")
            + self._null_last_numeric_order_terms("f.field_order")
            + self._null_last_text_order_terms("f.source_field_name")
            + self._null_last_text_order_terms("t.target_table_name")
            + self._null_last_text_order_terms("f.target_field_name")
            + ["t.table_pk ASC", "f.field_pk ASC"]
        )

    def _field_select(self):
        return """
SELECT
    u.source_id AS upstream_system_id,
    u.source_code AS system_code,
    u.source_name AS system_name,
    COALESCE(u.source_type, '') AS system_abbr,
    t.source_table_name,
    t.source_table_cn,
    COALESCE(t.target_layer_code, 'DWF') AS target_layer_code,
    COALESCE(t.target_table_name, '') AS target_table_name,
    COALESCE(t.load_mode, '') AS load_mode,
    f.source_field_name,
    COALESCE(f.source_field_type, '') AS source_field_type,
    COALESCE(f.source_field_comment, '') AS source_field_comment,
    COALESCE(f.target_field_name, '') AS target_field_name,
    COALESCE(f.mapping_rule, '待补充') AS mapping_rule,
    COALESCE(f.updated_at, t.updated_at, CURRENT_TIMESTAMP) AS updated_at
"""

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
        sql = f"""
SELECT
    u.source_name AS name,
    COUNT(*) AS count,
    u.source_id AS upstream_system_id,
    u.source_code AS system_code,
    COALESCE(u.source_type, '') AS system_abbr
{self._base_from()}
GROUP BY u.source_id, u.source_code, u.source_name, u.source_type
ORDER BY u.source_name
"""
        return [
            {
                "name": row["name"],
                "count": int(row["count"] or 0),
                "dataSourceId": row["upstream_system_id"],
                "upstreamSystemId": row["upstream_system_id"],
                "systemCode": row["system_code"],
                "systemAbbr": row["system_abbr"],
            }
            for row in self._fetch_rows_logged(sql, purpose="mapping source systems", method="get_source_systems")
        ]

    def get_stats(self, params=None):
        cached = self._get_cached_stats(params)
        if cached is not None:
            return cached
        sql = f"""
SELECT
    COUNT(DISTINCT u.source_id) AS source_system_count,
    COUNT(DISTINCT t.table_pk) AS source_table_count,
    COUNT(DISTINCT f.field_pk) AS field_count,
    COUNT(DISTINCT CASE WHEN TRIM(COALESCE(f.target_field_name, '')) <> '' THEN f.field_pk END) AS mapped_field_count,
    COUNT(DISTINCT CASE WHEN TRIM(COALESCE(f.source_field_comment, '')) = '' THEN f.field_pk END) AS empty_comment_count
{self._base_from()}{self._build_where(params)}
"""
        row = (self._fetch_rows_logged(sql, purpose="mapping stats", method="get_stats", keyword=(params or {}).get("keyword")) or [{}])[0]
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

        total_rows = self._fetch_rows_logged(
            f"SELECT COUNT(*) AS total {self._base_from()}{where}",
            purpose="mapping field total",
            method="get_field_mappings",
            page=page,
            page_size=page_size,
            keyword=(params or {}).get("keyword"),
        )
        total = int(total_rows[0]["total"]) if total_rows else 0

        sql = (
            self._field_select()
            + "\n"
            + self._base_from()
            + where
            + "\n"
            + self._resolve_field_order(params)
            + f"\nLIMIT {page_size} OFFSET {offset}"
        )
        items = [
            self._row_to_field_mapping(row)
            for row in self._fetch_rows_logged(
                sql,
                purpose="mapping field page",
                method="get_field_mappings",
                page=page,
                page_size=page_size,
                keyword=(params or {}).get("keyword"),
            )
        ]
        return {"items": items, "total": total, "page": page, "pageSize": page_size}

    def get_table_mappings(self, params=None):
        with database_transaction():
            return self._get_table_mappings(params)

    def _get_table_mappings(self, params=None):
        page, page_size = self._resolve_paging(params)
        offset = (page - 1) * page_size
        count_sql = f"""
SELECT COUNT(*) AS total
FROM (
    SELECT t.table_pk
    {self._base_from()}{self._build_where(params)}
    GROUP BY t.table_pk
) counted
"""
        total_rows = self._fetch_rows_logged(
            count_sql,
            purpose="mapping table total",
            method="get_table_mappings",
            page=page,
            page_size=page_size,
            keyword=(params or {}).get("keyword"),
        )
        total = int(total_rows[0]["total"]) if total_rows else 0

        sql = f"""
SELECT
    u.source_id AS upstream_system_id,
    u.source_code AS system_code,
    u.source_name AS system_name,
    COALESCE(u.source_type, '') AS system_abbr,
    t.source_table_name,
    COALESCE(t.source_table_cn, t.source_table_name) AS source_table_cn,
    COALESCE(t.target_layer_code, 'DWF') AS target_layer_code,
    COALESCE(t.target_table_name, '') AS target_table_name,
    COALESCE(t.load_mode, '') AS load_mode,
    COUNT(*) AS field_count,
    SUM(CASE WHEN TRIM(COALESCE(f.target_field_name, '')) <> '' THEN 1 ELSE 0 END) AS mapped_count,
    SUM(CASE WHEN TRIM(COALESCE(f.source_field_comment, '')) = '' THEN 1 ELSE 0 END) AS empty_comment_count,
    MAX(COALESCE(f.updated_at, t.updated_at, CURRENT_TIMESTAMP)) AS updated_at
{self._base_from()}{self._build_where(params)}
GROUP BY
    u.source_id, u.source_code, u.source_name, u.source_type,
    t.source_table_name, t.source_table_cn, t.target_layer_code, t.target_table_name, t.load_mode
ORDER BY {", ".join(self._table_default_order_terms())}
LIMIT {page_size} OFFSET {offset}
"""
        items = []
        for row in self._fetch_rows_logged(
            sql,
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
