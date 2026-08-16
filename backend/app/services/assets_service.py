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
import re
from copy import deepcopy
from time import perf_counter

from ..db.gaussdb import (
    database_transaction,
    execute_sql,
    execute_statements,
    fetch_all,
    get_db_profile,
    resolve_db_profile_name,
)
from ..settings import get_default_operator, get_page_size_limits
from ..utils.data_types import DEFAULT_DATA_TYPE, normalize_data_type
from ..utils.ddl_generator import generate_table_ddl, get_ddl_dialect_label, normalize_db_dialect
from ..utils.service_perf import log_slow_service_call
from .operation_log_service import (
    OPERATION_TYPE_CREATE,
    OPERATION_TYPE_DELETE,
    OPERATION_TYPE_UPDATE,
    operation_log_service,
)


NAME_PATTERN = re.compile(r"^[A-Za-z][A-Za-z0-9_]*$")

DEFAULT_LAYER_OPTIONS = [
    {"code": "ODS", "cn": "贴源层", "active": False},
    {"code": "DWD", "cn": "明细层", "active": False},
    {"code": "DWA", "cn": "应用明细层", "active": True},
    {"code": "DWM", "cn": "中间层", "active": True},
    {"code": "DWS", "cn": "汇总层", "active": False},
    {"code": "DM", "cn": "数据集市层", "active": True},
    {"code": "ADS", "cn": "应用层", "active": False},
]

TABLE_DOMAIN = "dwp.p_asset_domain"
TABLE_LAYER = "dwp.p_asset_layer"
TABLE_ASSET = "dwp.p_asset_table"
TABLE_FIELD = "dwp.p_asset_field"
TABLE_CHANGE_LOG = "dwp.p_asset_change_log"
LOGGER = logging.getLogger(__name__)


class AssetNotFoundError(Exception):
    def __init__(self, table_name):
        self.table_name = table_name
        super().__init__(f"未找到数据表: {table_name}")

    def to_dict(self):
        return {
            "code": "ASSET_NOT_FOUND",
            "message": f"未找到数据表: {self.table_name}",
        }


class AssetAlreadyExistsError(Exception):
    def __init__(self, table_name):
        self.table_name = table_name
        super().__init__(f"数据表已存在: {table_name}")

    def to_dict(self):
        return {
            "code": "ASSET_ALREADY_EXISTS",
            "message": f"数据表已存在: {self.table_name}",
        }


class AssetValidationError(Exception):
    def __init__(self, details):
        self.details = details
        super().__init__("请求参数校验失败")

    def to_dict(self):
        return {
            "code": "ASSET_VALIDATION_FAILED",
            "message": "请求参数校验失败",
            "details": self.details,
        }


class AssetDataSourceError(Exception):
    def __init__(self, message):
        self.message = message
        super().__init__(message)

    def to_dict(self):
        return {
            "code": "ASSET_DATA_SOURCE_ERROR",
            "message": self.message,
        }


class AssetsService:
    def __init__(self):
        self._db_profile = os.getenv("ASSET_DB_PROFILE", "").strip()
        self._default_schema_prefix = os.getenv("ASSET_SCHEMA_PREFIX", "DWS_").strip() or "DWS_"
        self._default_operator = get_default_operator()

    def _fetch_rows(self, sql):
        try:
            columns, rows = fetch_all(self._db_profile or resolve_db_profile_name(), sql)
        except FileNotFoundError as error:
            raise AssetDataSourceError(f"数据库配置文件不存在: {error.filename}") from error
        except KeyError as error:
            raise AssetDataSourceError(str(error)) from error
        except RuntimeError as error:
            raise AssetDataSourceError(str(error)) from error
        except Exception as error:
            raise AssetDataSourceError(f"数据库查询失败: {error}") from error

        return [dict(zip(columns, row)) for row in rows]

    def _fetch_rows_logged(self, sql, *, purpose, method, page=None, page_size=None, keyword=None):
        started_at = perf_counter()
        try:
            return self._fetch_rows(sql)
        finally:
            log_slow_service_call(
                LOGGER,
                service="AssetsService",
                method=method,
                purpose=purpose,
                started_at=started_at,
                page=page,
                page_size=page_size,
                keyword=keyword,
            )

    def _execute_sql(self, sql):
        try:
            return execute_sql(self._db_profile or resolve_db_profile_name(), sql)
        except FileNotFoundError as error:
            raise AssetDataSourceError(f"数据库配置文件不存在: {error.filename}") from error
        except KeyError as error:
            raise AssetDataSourceError(str(error)) from error
        except RuntimeError as error:
            raise AssetDataSourceError(str(error)) from error
        except Exception as error:
            raise AssetDataSourceError(f"数据库执行失败: {error}") from error

    def _execute_statements(self, statements):
        try:
            return execute_statements(self._db_profile or resolve_db_profile_name(), statements)
        except FileNotFoundError as error:
            raise AssetDataSourceError(f"数据库配置文件不存在: {error.filename}") from error
        except KeyError as error:
            raise AssetDataSourceError(str(error)) from error
        except RuntimeError as error:
            raise AssetDataSourceError(str(error)) from error
        except Exception as error:
            raise AssetDataSourceError(f"数据库执行失败: {error}") from error

    def _quote(self, value):
        if value is None:
            return "NULL"
        return "'" + str(value).replace("'", "''") + "'"

    def _flag(self, value):
        return "'Y'" if value else "'N'"

    def _escape_comment(self, value):
        return str(value or "").replace("'", "''")

    def _normalize_layer_schema(self, layer):
        return f"{self._default_schema_prefix}{layer.upper()}"

    def _normalize_field_type(self, raw_type):
        return normalize_data_type(raw_type)

    def _resolve_paging(self, page=None, page_size=None):
        default_page_size, max_page_size = get_page_size_limits(20)
        try:
            normalized_page = int(page or 1)
        except (TypeError, ValueError):
            normalized_page = 1
        try:
            normalized_page_size = int(page_size or default_page_size)
        except (TypeError, ValueError):
            normalized_page_size = default_page_size
        normalized_page = max(1, normalized_page)
        normalized_page_size = max(1, min(max_page_size, normalized_page_size))
        return normalized_page, normalized_page_size

    def _normalize_asset_order(self, order_by=None):
        sort_map = {
            "name": "t.table_name",
            "table_name": "t.table_name",
            "cn": "t.table_cn_name",
            "table_cn_name": "t.table_cn_name",
            "schema": "t.schema_name",
            "schema_name": "t.schema_name",
            "layer": "t.layer_code",
            "layer_code": "t.layer_code",
            "domain": "d.domain_name",
            "domain_code": "t.domain_code",
            "owner": "t.owner_name",
            "owner_name": "t.owner_name",
            "updated_at": "t.updated_at",
            "created_at": "t.created_at",
        }
        text = str(order_by or "").strip()
        if not text:
            return "ORDER BY t.layer_code, t.table_name"
        parts = text.split()
        column = sort_map.get(parts[0].lower())
        if not column:
            return "ORDER BY t.layer_code, t.table_name"
        direction = "DESC" if len(parts) > 1 and parts[1].lower() == "desc" else "ASC"
        return f"ORDER BY {column} {direction}, t.table_name ASC"

    def _resolve_active_profile_name(self):
        return self._db_profile or resolve_db_profile_name()

    def _resolve_ddl_dialect(self):
        try:
            profile_name = self._resolve_active_profile_name()
            config = get_db_profile(profile_name)
            return normalize_db_dialect(config, profile_name=profile_name)
        except FileNotFoundError as error:
            raise AssetDataSourceError(f"鏁版嵁搴撻厤缃枃浠朵笉瀛樺湪: {error.filename}") from error
        except KeyError as error:
            raise AssetDataSourceError(str(error)) from error
        except RuntimeError as error:
            raise AssetDataSourceError(str(error)) from error
        except ValueError as error:
            raise AssetDataSourceError(str(error)) from error

    def _ensure_safe_name(self, value, field_name="name"):
        if not isinstance(value, str) or not NAME_PATTERN.fullmatch(value):
            raise AssetValidationError(
                [{"field": field_name, "message": "只允许字母、数字和下划线，且必须以字母开头"}]
            )
        return value

    def _get_next_id(self, table_name, id_column):
        sql = f"SELECT COALESCE(MAX({id_column}), 0) + 1 AS next_id FROM {table_name}"
        rows = self._fetch_rows(sql)
        return int(rows[0]["next_id"])

    def _load_domain_rows(self, layer=None):
        layer_filter = ""
        if str(layer or "").strip():
            layer_filter = f"WHERE UPPER(layer_code) = {self._quote(str(layer).strip().upper())}"
        sql = f"""
SELECT
    d.domain_code,
    d.domain_name,
    d.display_order,
    d.is_active,
    COALESCE(t.table_count, 0) AS table_count
FROM {TABLE_DOMAIN} d
LEFT JOIN (
    SELECT domain_code, COUNT(1) AS table_count
    FROM {TABLE_ASSET}
    {layer_filter}
    GROUP BY domain_code
) t
  ON d.domain_code = t.domain_code
ORDER BY d.display_order, d.domain_code
"""
        return self._fetch_rows(sql)

    def _load_layer_rows(self, domain=None):
        domain_filter = ""
        if str(domain or "").strip():
            domain_filter = (
                f"JOIN {TABLE_DOMAIN} d ON d.domain_code = a.domain_code "
                f"WHERE LOWER(d.domain_name) = {self._quote(str(domain).strip().lower())}"
            )
        sql = f"""
SELECT
    l.layer_code,
    l.layer_name,
    l.display_order,
    l.is_active,
    COALESCE(t.table_count, 0) AS table_count
FROM {TABLE_LAYER} l
LEFT JOIN (
    SELECT a.layer_code, COUNT(1) AS table_count
    FROM {TABLE_ASSET} a
    {domain_filter}
    GROUP BY a.layer_code
) t
  ON l.layer_code = t.layer_code
ORDER BY l.display_order, l.layer_code
"""
        return self._fetch_rows(sql)

    def _load_domain_mappings(self):
        code_to_name = {}
        name_to_code = {}
        for row in self._load_domain_rows():
            code = (row.get("domain_code") or "").strip()
            name = (row.get("domain_name") or "").strip()
            if not code or not name:
                continue
            code_to_name[code] = name
            name_to_code[name] = code
        return code_to_name, name_to_code

    def _build_asset_where(self, *, keyword=None, schema_name=None, layer=None, domain=None, owner=None):
        code_to_name, name_to_code = self._load_domain_mappings()
        where = []
        normalized_keyword = str(keyword or "").strip().lower()
        if normalized_keyword:
            like = self._quote(f"%{normalized_keyword}%")
            where.append(
                "("
                f"LOWER(COALESCE(t.table_name, '')) LIKE {like} OR "
                f"LOWER(COALESCE(t.table_cn_name, '')) LIKE {like} OR "
                f"LOWER(COALESCE(t.owner_name, '')) LIKE {like} OR "
                f"LOWER(COALESCE(t.schema_name, '')) LIKE {like} OR "
                f"LOWER(COALESCE(t.grain_desc, '')) LIKE {like} OR "
                f"LOWER(COALESCE(t.cycle_desc, '')) LIKE {like} OR "
                f"LOWER(COALESCE(t.table_desc, '')) LIKE {like} OR "
                f"LOWER(COALESCE(d.domain_name, '')) LIKE {like} OR "
                f"EXISTS ("
                f"SELECT 1 FROM {TABLE_FIELD} f "
                f"WHERE f.asset_id = t.asset_id AND f.is_deleted = 'N' "
                f"AND ("
                f"LOWER(COALESCE(f.field_name, '')) LIKE {like} OR "
                f"LOWER(COALESCE(f.field_cn_name, '')) LIKE {like} OR "
                f"LOWER(COALESCE(f.field_desc, '')) LIKE {like}"
                f")"
                f")"
                ")"
            )
        if schema_name:
            where.append(f"t.schema_name = {self._quote(schema_name)}")
        if layer:
            where.append(f"t.layer_code = {self._quote(layer)}")
        if domain:
            domain_code = name_to_code.get(domain, domain)
            where.append(f"t.domain_code = {self._quote(domain_code)}")
        if owner:
            where.append(f"t.owner_name = {self._quote(owner)}")
        return where, code_to_name

    def _select_asset_rows(
        self,
        *,
        keyword=None,
        schema_name=None,
        layer=None,
        domain=None,
        owner=None,
        page=None,
        page_size=None,
        order_by=None,
    ):
        paginate = page is not None or page_size is not None
        page, page_size = self._resolve_paging(page=page, page_size=page_size)
        offset = (page - 1) * page_size
        where, code_to_name = self._build_asset_where(
            keyword=keyword,
            schema_name=schema_name,
            layer=layer,
            domain=domain,
            owner=owner,
        )
        where_sql = f"WHERE {' AND '.join(where)}" if where else ""
        normalized_keyword = str(keyword or "").strip().lower()
        field_match_sql = "NULL AS field_match"
        if normalized_keyword:
            field_like = self._quote(f"%{normalized_keyword}%")
            field_match_sql = f"""
(
    SELECT f.field_name || ' ' || COALESCE(f.field_cn_name, f.field_desc, '')
    FROM {TABLE_FIELD} f
    WHERE f.asset_id = t.asset_id
      AND f.is_deleted = 'N'
      AND (
        LOWER(COALESCE(f.field_name, '')) LIKE {field_like}
        OR LOWER(COALESCE(f.field_cn_name, '')) LIKE {field_like}
        OR LOWER(COALESCE(f.field_desc, '')) LIKE {field_like}
      )
    ORDER BY f.field_order, f.field_name
    LIMIT 1
) AS field_match
""".strip()
        sql = f"""
SELECT
    t.asset_id,
    t.table_name,
    t.table_cn_name,
    t.schema_name,
    t.layer_code,
    t.domain_code,
    t.owner_name,
    t.grain_desc,
    t.cycle_desc,
    t.table_desc,
    t.field_count,
    t.created_at,
    t.updated_at,
    COUNT(*) OVER() AS total_count,
    {field_match_sql}
FROM {TABLE_ASSET} t
LEFT JOIN {TABLE_DOMAIN} d
  ON d.domain_code = t.domain_code
{where_sql}
{self._normalize_asset_order(order_by)}
"""
        if paginate:
            sql += f"\nLIMIT {page_size} OFFSET {offset}"
        rows = self._fetch_rows_logged(
            sql,
            purpose="asset table list",
            method="_select_asset_rows",
            page=page,
            page_size=page_size,
            keyword=keyword,
        )
        for row in rows:
            row["domain_name"] = code_to_name.get(row.get("domain_code"), row.get("domain_code") or "")
        return rows, page, page_size

    def _count_asset_rows(self, *, keyword=None, schema_name=None, layer=None, domain=None, owner=None):
        where, _ = self._build_asset_where(
            keyword=keyword,
            schema_name=schema_name,
            layer=layer,
            domain=domain,
            owner=owner,
        )
        where_sql = f"WHERE {' AND '.join(where)}" if where else ""
        rows = self._fetch_rows_logged(
            f"""
SELECT COUNT(1) AS total_count
FROM {TABLE_ASSET} t
LEFT JOIN {TABLE_DOMAIN} d
  ON d.domain_code = t.domain_code
{where_sql}
""",
            purpose="asset table count",
            method="_count_asset_rows",
            keyword=keyword,
        )
        return int(rows[0].get("total_count") or 0)

    def _load_table_rows(self, layer=None, domain=None):
        # Legacy helper for explicitly small datasets only.
        # Detail/edit/DDL flows must use precise lookup methods instead.
        where, code_to_name = self._build_asset_where(layer=layer, domain=domain)
        where_sql = f"WHERE {' AND '.join(where)}" if where else ""
        sql = f"""
SELECT
    t.asset_id,
    t.table_name,
    t.table_cn_name,
    t.schema_name,
    t.layer_code,
    t.domain_code,
    t.owner_name,
    t.grain_desc,
    t.cycle_desc,
    t.table_desc,
    t.field_count,
    t.created_at,
    t.updated_at
FROM {TABLE_ASSET} t
LEFT JOIN {TABLE_DOMAIN} d
  ON d.domain_code = t.domain_code
{where_sql}
ORDER BY t.layer_code, t.table_name
"""
        rows = self._fetch_rows_logged(sql, purpose="legacy asset full load", method="_load_table_rows")
        for row in rows:
            row["domain_name"] = code_to_name.get(row.get("domain_code"), row.get("domain_code") or "")
        return rows

    def _load_field_rows(self, asset_ids, *, purpose="asset field list", method="_load_field_rows"):
        if not asset_ids:
            return {}
        ids_sql = ", ".join(str(int(asset_id)) for asset_id in asset_ids)
        sql = f"""
SELECT
    asset_id,
    field_name,
    field_cn_name,
    data_type,
    field_order,
    nullable_flag,
    pk_flag,
    partition_flag,
    enum_desc,
    field_desc
FROM {TABLE_FIELD}
WHERE asset_id IN ({ids_sql})
ORDER BY asset_id, field_order, field_name
"""
        rows = self._fetch_rows_logged(sql, purpose=purpose, method=method)
        grouped = {}
        for row in rows:
            grouped.setdefault(int(row["asset_id"]), []).append(
                {
                    "name": row["field_name"],
                    "cn": row["field_cn_name"] or row["field_desc"] or row["field_name"],
                    "type": self._normalize_field_type(row.get("data_type")),
                    "nullable": str(row["nullable_flag"]).upper() == "Y",
                    "pk": str(row["pk_flag"]).upper() == "Y",
                    "part": str(row["partition_flag"]).upper() == "Y",
                    "enum": row["enum_desc"],
                }
            )
        return grouped

    def _to_asset_table(self, row, fields):
        return {
            "name": row["table_name"],
            "cn": row["table_cn_name"] or row["table_name"],
            "domain": row.get("domain_name") or "",
            "layer": row["layer_code"],
            "owner": row.get("owner_name") or "",
            "grain": row.get("grain_desc") or "",
            "cycle": row.get("cycle_desc") or "",
            "desc": row.get("table_desc") or "",
            "schema": row.get("schema_name") or self._normalize_layer_schema(row["layer_code"]),
            "fieldCount": int(row.get("field_count") or len(fields)),
            "_fieldMatch": row.get("field_match") or None,
            "fields": deepcopy(fields),
        }

    def _with_empty_asset_risks(self, table):
        return {**table, "assetRisks": []}

    def _build_metadata_ddl(self, table):
        dialect = self._resolve_ddl_dialect()
        ddl = generate_table_ddl(table, table["fields"], dialect)
        return {
            "ddl": ddl,
            "ddlDialect": dialect,
            "ddlDialectLabel": get_ddl_dialect_label(dialect),
        }

    def _load_single_table_row(self, *, asset_id=None, table_name=None, schema_name=None):
        where = []
        if asset_id is not None:
            where.append(f"t.asset_id = {int(asset_id)}")
        if table_name is not None:
            safe_name = self._ensure_safe_name(table_name, "table_name")
            where.append(f"t.table_name = {self._quote(safe_name)}")
        if schema_name:
            where.append(f"t.schema_name = {self._quote(schema_name)}")
        if not where:
            raise AssetValidationError([{"field": "table", "message": "missing table lookup condition"}])

        code_to_name, _ = self._load_domain_mappings()
        sql = f"""
SELECT
    t.asset_id,
    t.table_name,
    t.table_cn_name,
    t.schema_name,
    t.layer_code,
    t.domain_code,
    t.owner_name,
    t.grain_desc,
    t.cycle_desc,
    t.table_desc,
    t.field_count,
    t.created_at,
    t.updated_at
FROM {TABLE_ASSET} t
WHERE {' AND '.join(where)}
LIMIT 1
"""
        rows = self._fetch_rows_logged(sql, purpose="asset table detail", method="_load_single_table_row")
        if not rows:
            raise AssetNotFoundError(table_name or asset_id)
        row = rows[0]
        row["domain_name"] = code_to_name.get(row.get("domain_code"), row.get("domain_code") or "")
        return row

    def get_table_by_id(self, table_id):
        return self._load_single_table_row(asset_id=table_id)

    def get_table_by_name(self, schema_name, table_name):
        return self._load_single_table_row(table_name=table_name, schema_name=schema_name)

    def get_table_fields(self, table_id):
        return deepcopy(
            self._load_field_rows([table_id], purpose="asset detail fields", method="get_table_fields").get(int(table_id), [])
        )

    def get_table_detail(self, table_id):
        row = self.get_table_by_id(table_id)
        return self._to_asset_table(row, self.get_table_fields(table_id))

    def get_table_ddl_metadata(self, table_id):
        return self._build_metadata_ddl(self.get_table_detail(table_id))

    def _get_db_asset_detail_row(self, table_name):
        safe_name = self._ensure_safe_name(table_name)
        return self._load_single_table_row(table_name=safe_name)

    def _get_db_asset_detail(self, table_name):
        row = self._get_db_asset_detail_row(table_name)
        fields = self._load_field_rows(
            [row["asset_id"]],
            purpose="asset detail fields",
            method="_get_db_asset_detail",
        ).get(int(row["asset_id"]), [])
        return self._to_asset_table(row, fields)

    def _validate_fields(self, fields, details):
        names = set()

        for index, field in enumerate(fields):
            prefix = f"fields[{index}]"

            if not isinstance(field, dict):
                details.append({"field": prefix, "message": "字段项必须为对象"})
                continue

            name = field.get("name")
            cn = field.get("cn")
            field_type = field.get("type")
            nullable = field.get("nullable")
            pk = field.get("pk")
            part = field.get("part")

            if not isinstance(name, str) or not name.strip():
                details.append({"field": f"{prefix}.name", "message": "字段英文名不能为空"})
            elif not NAME_PATTERN.fullmatch(name.strip()):
                details.append({"field": f"{prefix}.name", "message": "字段英文名格式不正确"})
            elif name.strip() in names:
                details.append({"field": f"{prefix}.name", "message": "同一张表内字段名必须唯一"})
            else:
                names.add(name.strip())

            if not isinstance(cn, str) or not cn.strip():
                details.append({"field": f"{prefix}.cn", "message": "字段中文注释不能为空"})

            if not isinstance(field_type, str) or not field_type.strip():
                details.append({"field": f"{prefix}.type", "message": "字段类型不能为空"})

            if not isinstance(nullable, bool):
                details.append({"field": f"{prefix}.nullable", "message": "nullable 必须为布尔值"})

            if not isinstance(pk, bool):
                details.append({"field": f"{prefix}.pk", "message": "pk 必须为布尔值"})
            elif pk and nullable is not False:
                details.append({"field": f"{prefix}.nullable", "message": "主键字段 nullable 必须为 false"})

            if not isinstance(part, bool):
                details.append({"field": f"{prefix}.part", "message": "part 必须为布尔值"})

    def _validate_table_payload(self, payload, current_name=None):
        details = []

        if not isinstance(payload, dict):
            raise AssetValidationError([{"field": "body", "message": "请求体必须为 JSON 对象"}])

        name = payload.get("name")
        cn = payload.get("cn")
        domain = payload.get("domain")
        layer = payload.get("layer")
        fields = payload.get("fields")

        if not isinstance(name, str) or not name.strip():
            details.append({"field": "name", "message": "表英文名不能为空"})
        elif not NAME_PATTERN.fullmatch(name.strip()):
            details.append({"field": "name", "message": "表英文名格式不正确"})

        if not isinstance(cn, str) or not cn.strip():
            details.append({"field": "cn", "message": "表中文名不能为空"})

        if not isinstance(domain, str) or not domain.strip():
            details.append({"field": "domain", "message": "主题域不能为空"})

        if not isinstance(layer, str) or not layer.strip():
            details.append({"field": "layer", "message": "分层不能为空"})

        if not isinstance(fields, list) or not fields:
            details.append({"field": "fields", "message": "字段列表至少 1 项"})
        else:
            self._validate_fields(fields, details)

        _, name_to_code = self._load_domain_mappings()
        if isinstance(domain, str) and domain.strip() and domain.strip() not in name_to_code:
            details.append({"field": "domain", "message": f"主题域不存在: {domain.strip()}"})

        valid_layer_codes = {item["code"] for item in self.get_layers()}
        if isinstance(layer, str) and layer.strip() and layer.strip() not in valid_layer_codes:
            details.append({"field": "layer", "message": f"分层不存在: {layer.strip()}"})

        if details:
            raise AssetValidationError(details)

        return {
            "name": name.strip(),
            "cn": cn.strip(),
            "domain": domain.strip(),
            "layer": layer.strip(),
            "schema": (payload.get("schema") or "").strip() or self._normalize_layer_schema(layer.strip()),
            "owner": (payload.get("owner") or "").strip(),
            "grain": (payload.get("grain") or "").strip(),
            "cycle": (payload.get("cycle") or "").strip(),
            "desc": (payload.get("desc") or "").strip(),
            "fields": [
                {
                    "name": field["name"].strip(),
                    "cn": field["cn"].strip(),
                    "type": self._normalize_field_type(field.get("type")),
                    "nullable": bool(field["nullable"]),
                    "pk": bool(field["pk"]),
                    "part": bool(field["part"]),
                    "enum": field.get("enum"),
                }
                for field in fields
            ],
            "current_name": current_name,
        }

    def _ensure_db_table_absent(self, table_name, exclude_asset_id=None):
        safe_name = self._ensure_safe_name(table_name)
        sql = f"""
SELECT asset_id
FROM {TABLE_ASSET}
WHERE table_name = {self._quote(safe_name)}
LIMIT 1
"""
        rows = self._fetch_rows_logged(sql, purpose="asset uniqueness check", method="_ensure_db_table_absent")
        if not rows:
            return
        if exclude_asset_id is not None and int(rows[0]["asset_id"]) == int(exclude_asset_id):
            return
        raise AssetAlreadyExistsError(table_name)

    def _insert_db_fields(self, asset_id, fields):
        field_id = self._get_next_id(TABLE_FIELD, "field_id")
        statements = []
        for index, field in enumerate(fields, start=1):
            statements.append(
                f"""
INSERT INTO {TABLE_FIELD} (
    field_id,
    asset_id,
    field_name,
    field_cn_name,
    data_type,
    field_order,
    nullable_flag,
    pk_flag,
    partition_flag,
    enum_desc,
    field_desc,
    created_by,
    updated_by
) VALUES (
    {field_id},
    {int(asset_id)},
    {self._quote(field['name'])},
    {self._quote(field['cn'])},
    {self._quote(field['type'])},
    {index},
    {self._flag(field['nullable'])},
    {self._flag(field['pk'])},
    {self._flag(field['part'])},
    {self._quote(field.get('enum'))},
    {self._quote(field['cn'])},
    {self._quote(self._default_operator)},
    {self._quote(self._default_operator)}
)
""".strip()
            )
            field_id += 1
        return statements

    def _insert_change_log(self, asset_id, table_name, change_type, before_data, after_data):
        change_id = self._get_next_id(TABLE_CHANGE_LOG, "change_id")
        before_json = json.dumps(before_data, ensure_ascii=False) if before_data is not None else None
        after_json = json.dumps(after_data, ensure_ascii=False) if after_data is not None else None
        summary = {
            "CREATE_TABLE": "创建资产表",
            "UPDATE_TABLE": "更新资产表",
            "UPDATE_FIELDS": "更新字段列表",
            "DELETE_TABLE": "删除资产表",
        }.get(change_type, change_type)
        return f"""
INSERT INTO {TABLE_CHANGE_LOG} (
    change_id,
    asset_id,
    table_name,
    change_type,
    change_summary,
    before_json,
    after_json,
    operator_name
) VALUES (
    {change_id},
    {self._quote(asset_id) if asset_id is not None else 'NULL'},
    {self._quote(table_name)},
    {self._quote(change_type)},
    {self._quote(summary)},
    {self._quote(before_json)},
    {self._quote(after_json)},
    {self._quote(self._default_operator)}
)
""".strip()

    def get_asset_tables(
        self,
        layer=None,
        domain=None,
        keyword=None,
        schema=None,
        owner=None,
        page=None,
        page_size=None,
        order_by=None,
    ):
        with database_transaction():
            table_rows, _, _ = self._select_asset_rows(
                keyword=keyword,
                schema_name=schema,
                layer=layer,
                domain=domain,
                owner=owner,
                page=page,
                page_size=page_size,
                order_by=order_by,
            )
            fields_by_asset = self._load_field_rows(
                [row["asset_id"] for row in table_rows],
                purpose="asset list fields",
                method="get_asset_tables",
            )
            return [self._to_asset_table(row, fields_by_asset.get(int(row["asset_id"]), [])) for row in table_rows]

    def get_asset_table_page(
        self,
        *,
        layer=None,
        domain=None,
        keyword=None,
        schema=None,
        owner=None,
        page=None,
        page_size=None,
        order_by=None,
    ):
        with database_transaction():
            rows, normalized_page, normalized_page_size = self._select_asset_rows(
                keyword=keyword,
                schema_name=schema,
                layer=layer,
                domain=domain,
                owner=owner,
                page=page or 1,
                page_size=page_size,
                order_by=order_by,
            )
            total = int(rows[0].get("total_count") or 0) if rows else 0
            if not rows and normalized_page > 1:
                total = self._count_asset_rows(
                    keyword=keyword,
                    schema_name=schema,
                    layer=layer,
                    domain=domain,
                    owner=owner,
                )
            return {
                "items": [self._to_asset_table(row, []) for row in rows],
                "page": normalized_page,
                "pageSize": normalized_page_size,
                "total": total,
            }

    def get_asset_detail(self, table_name):
        with database_transaction():
            return self._with_empty_asset_risks(self._get_db_asset_detail(table_name))

    def get_asset_fields(self, table_name):
        with database_transaction():
            return deepcopy(self._get_db_asset_detail(table_name)["fields"])

    def get_asset_ddl(self, table_name):
        with database_transaction():
            return self._build_metadata_ddl(self._get_db_asset_detail(table_name))

    def get_domains(self, layer=None):
        return [
            {"name": row["domain_name"], "count": int(row["table_count"] or 0)}
            for row in self._load_domain_rows(layer=layer)
            if row.get("domain_name")
        ]

    def get_layers(self, domain=None):
        return [
            {
                "code": row["layer_code"],
                "cn": row["layer_name"] or row["layer_code"],
                "active": str(row["is_active"]).upper() == "Y",
                "count": int(row["table_count"] or 0),
            }
            for row in self._load_layer_rows(domain=domain)
        ]

    def create_asset_table(self, payload):
        with operation_log_service.audit(
            module_name="数据仓库",
            operation_type=OPERATION_TYPE_CREATE,
            operation_object=str((payload or {}).get("name") or "") if isinstance(payload, dict) else "",
            operation_desc="新增数据表",
        ) as audit:
            result, table, after_data = self._create_asset_table(payload)
            audit.operation_object = table["name"]
            audit.after = after_data
            return result

    def _create_asset_table(self, payload):
        table = self._validate_table_payload(payload)
        self._ensure_db_table_absent(table["name"])

        _, name_to_code = self._load_domain_mappings()
        asset_id = self._get_next_id(TABLE_ASSET, "asset_id")
        domain_code = name_to_code[table["domain"]]
        after_data = {key: deepcopy(value) for key, value in table.items() if key != "current_name"}

        statements = [
            f"""
INSERT INTO {TABLE_ASSET} (
    asset_id,
    table_name,
    table_cn_name,
    schema_name,
    layer_code,
    domain_code,
    owner_name,
    grain_desc,
    cycle_desc,
    table_desc,
    source_type,
    storage_type,
    status_code,
    field_count,
    created_by,
    updated_by
) VALUES (
    {asset_id},
    {self._quote(table['name'])},
    {self._quote(table['cn'])},
    {self._quote(table['schema'])},
    {self._quote(table['layer'])},
    {self._quote(domain_code)},
    {self._quote(table['owner'])},
    {self._quote(table['grain'])},
    {self._quote(table['cycle'])},
    {self._quote(table['desc'])},
    'MANUAL',
    'DWS',
    'ACTIVE',
    {len(table['fields'])},
    {self._quote(self._default_operator)},
    {self._quote(self._default_operator)}
)
""".strip(),
            *self._insert_db_fields(asset_id, table["fields"]),
            self._insert_change_log(asset_id, table["name"], "CREATE_TABLE", None, after_data),
        ]
        self._execute_statements(statements)
        return self._with_empty_asset_risks(self._get_db_asset_detail(table["name"])), table, after_data

    def update_asset_table(self, table_name, payload):
        with operation_log_service.audit(
            module_name="数据仓库",
            operation_type=OPERATION_TYPE_UPDATE,
            operation_object=table_name,
            operation_desc="编辑数据表",
        ) as audit:
            result, current, after_data, new_name = self._update_asset_table(table_name, payload)
            audit.operation_object = new_name
            audit.before = current
            audit.after = after_data
            return result

    def _update_asset_table(self, table_name, payload):
        current = self._get_db_asset_detail(table_name)
        current_row = self._get_db_asset_detail_row(table_name)
        table = self._validate_table_payload(payload, current_name=table_name)
        self._ensure_db_table_absent(table["name"], exclude_asset_id=current_row["asset_id"])

        _, name_to_code = self._load_domain_mappings()
        after_data = {key: deepcopy(value) for key, value in table.items() if key != "current_name"}
        asset_id = int(current_row["asset_id"])

        statements = [
            f"""
UPDATE {TABLE_ASSET}
SET
    table_name = {self._quote(table['name'])},
    table_cn_name = {self._quote(table['cn'])},
    schema_name = {self._quote(table['schema'])},
    layer_code = {self._quote(table['layer'])},
    domain_code = {self._quote(name_to_code[table['domain']])},
    owner_name = {self._quote(table['owner'])},
    grain_desc = {self._quote(table['grain'])},
    cycle_desc = {self._quote(table['cycle'])},
    table_desc = {self._quote(table['desc'])},
    field_count = {len(table['fields'])},
    updated_by = {self._quote(self._default_operator)},
    updated_at = CURRENT_TIMESTAMP
WHERE asset_id = {asset_id}
""".strip(),
            f"DELETE FROM {TABLE_FIELD} WHERE asset_id = {asset_id}",
            *self._insert_db_fields(asset_id, table["fields"]),
            self._insert_change_log(asset_id, table["name"], "UPDATE_TABLE", current, after_data),
        ]
        self._execute_statements(statements)
        return self._with_empty_asset_risks(self._get_db_asset_detail(table["name"])), current, after_data, table["name"]

    def update_asset_fields(self, table_name, payload):
        with operation_log_service.audit(
            module_name="数据仓库",
            operation_type=OPERATION_TYPE_UPDATE,
            operation_object=table_name,
            operation_desc="编辑数据表字段",
        ) as audit:
            result, current, after_data = self._update_asset_fields(table_name, payload)
            audit.before = current
            audit.after = after_data
            return result

    def _update_asset_fields(self, table_name, payload):
        if not isinstance(payload, dict):
            raise AssetValidationError([{"field": "body", "message": "请求体必须为 JSON 对象"}])

        fields = payload.get("fields")
        details = []
        if not isinstance(fields, list) or not fields:
            details.append({"field": "fields", "message": "字段列表至少 1 项"})
        else:
            self._validate_fields(fields, details)
        if details:
            raise AssetValidationError(details)

        current = self._get_db_asset_detail(table_name)
        current_row = self._get_db_asset_detail_row(table_name)
        normalized_fields = [
            {
                "name": field["name"].strip(),
                "cn": field["cn"].strip(),
                "type": self._normalize_field_type(field.get("type") or DEFAULT_DATA_TYPE),
                "nullable": bool(field["nullable"]),
                "pk": bool(field["pk"]),
                "part": bool(field["part"]),
                "enum": field.get("enum"),
            }
            for field in fields
        ]
        after_data = {**deepcopy(current), "fields": deepcopy(normalized_fields)}
        asset_id = int(current_row["asset_id"])

        statements = [
            f"DELETE FROM {TABLE_FIELD} WHERE asset_id = {asset_id}",
            *self._insert_db_fields(asset_id, normalized_fields),
            f"""
UPDATE {TABLE_ASSET}
SET
    field_count = {len(normalized_fields)},
    updated_by = {self._quote(self._default_operator)},
    updated_at = CURRENT_TIMESTAMP
WHERE asset_id = {asset_id}
""".strip(),
            self._insert_change_log(asset_id, table_name, "UPDATE_FIELDS", current, after_data),
        ]
        self._execute_statements(statements)
        return {"tableName": table_name, "fields": deepcopy(normalized_fields)}, current, after_data

    def delete_asset_table(self, table_name):
        with operation_log_service.audit(
            module_name="数据仓库",
            operation_type=OPERATION_TYPE_DELETE,
            operation_object=table_name,
            operation_desc="删除数据表",
        ) as audit:
            audit.before = self._delete_asset_table(table_name)

    def _delete_asset_table(self, table_name):
        current = self._get_db_asset_detail(table_name)
        current_row = self._get_db_asset_detail_row(table_name)
        asset_id = int(current_row["asset_id"])

        statements = [
            self._insert_change_log(asset_id, table_name, "DELETE_TABLE", current, None),
            f"DELETE FROM {TABLE_FIELD} WHERE asset_id = {asset_id}",
            f"DELETE FROM {TABLE_ASSET} WHERE asset_id = {asset_id}",
        ]
        self._execute_statements(statements)
        return current


assets_service = AssetsService()
