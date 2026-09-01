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

from sqlalchemy import delete, exists, func, insert, or_, select, update  # pyright: ignore[reportMissingImports]

from ..application import AuditActorMixin, actor_aware
from ..db.facade import database_transaction, get_db_profile, resolve_db_profile_name
from ..db.service import CoreAccess
from ..db.tables import asset_change_log, asset_domain, asset_field, asset_layer, asset_table
from ..settings import get_page_size_limits
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
LOGGER = logging.getLogger(__name__)

ASSET_SORT_COLUMNS = {
    "name": asset_table.c.table_name,
    "table_name": asset_table.c.table_name,
    "cn": asset_table.c.table_cn_name,
    "table_cn_name": asset_table.c.table_cn_name,
    "schema": asset_table.c.schema_name,
    "schema_name": asset_table.c.schema_name,
    "layer": asset_table.c.layer_code,
    "layer_code": asset_table.c.layer_code,
    "domain": asset_domain.c.domain_name,
    "domain_code": asset_table.c.domain_code,
    "owner": asset_table.c.owner_name,
    "owner_name": asset_table.c.owner_name,
    "updated_at": asset_table.c.updated_at,
    "created_at": asset_table.c.created_at,
}


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


class AssetsService(AuditActorMixin):
    def __init__(self):
        self._db_profile = os.getenv("ASSET_DB_PROFILE", "").strip()
        self._default_schema_prefix = os.getenv("ASSET_SCHEMA_PREFIX", "DWS_").strip() or "DWS_"
        self._db = CoreAccess(
            profile_getter=lambda: self._db_profile,
            error_factory=AssetDataSourceError,
        )

    def _fetch_rows(self, statement):
        return self._db.fetch_rows(statement)

    def _fetch_rows_logged(self, statement, *, purpose, method, page=None, page_size=None, keyword=None):
        started_at = perf_counter()
        try:
            return self._fetch_rows(statement)
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

    def _execute_statements(self, statements):
        return self._db.execute_statements(statements)

    def _flag(self, value):
        return "Y" if value else "N"

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
        text = str(order_by or "").strip()
        if not text:
            return (asset_table.c.layer_code.asc(), asset_table.c.table_name.asc())
        parts = text.split()
        column = ASSET_SORT_COLUMNS.get(parts[0].lower())
        if column is None:
            return (asset_table.c.layer_code.asc(), asset_table.c.table_name.asc())
        direction = column.desc() if len(parts) > 1 and parts[1].lower() == "desc" else column.asc()
        return (direction, asset_table.c.table_name.asc())

    def _resolve_active_profile_name(self):
        return self._db_profile or resolve_db_profile_name()

    def _resolve_ddl_dialect(self):
        try:
            profile_name = self._resolve_active_profile_name()
            config = get_db_profile(profile_name)
            return normalize_db_dialect(config, profile_name=profile_name)
        except FileNotFoundError as error:
            raise AssetDataSourceError("数据库配置文件不存在") from error
        except KeyError as error:
            raise AssetDataSourceError("数据库服务暂不可用，请稍后重试") from error
        except RuntimeError as error:
            raise AssetDataSourceError("数据库服务暂不可用，请稍后重试") from error
        except ValueError as error:
            raise AssetDataSourceError("数据库服务暂不可用，请稍后重试") from error

    def _ensure_safe_name(self, value, field_name="name"):
        if not isinstance(value, str) or not NAME_PATTERN.fullmatch(value):
            raise AssetValidationError(
                [{"field": field_name, "message": "只允许字母、数字和下划线，且必须以字母开头"}]
            )
        return value

    def _get_next_id(self, table, column):
        return self._db.next_pk(table, column)

    def _like(self, column, value):
        return func.lower(func.coalesce(column, "")).like(f"%{str(value or '').strip().lower()}%")

    def _load_domain_rows(self, layer=None):
        counted = select(asset_table.c.domain_code, func.count().label("table_count"))
        if str(layer or "").strip():
            counted = counted.where(func.upper(asset_table.c.layer_code) == str(layer).strip().upper())
        counted = counted.group_by(asset_table.c.domain_code).subquery()
        return self._fetch_rows(
            select(
                asset_domain.c.domain_code,
                asset_domain.c.domain_name,
                asset_domain.c.display_order,
                asset_domain.c.is_active,
                func.coalesce(counted.c.table_count, 0).label("table_count"),
            )
            .select_from(asset_domain.outerjoin(counted, asset_domain.c.domain_code == counted.c.domain_code))
            .order_by(asset_domain.c.display_order, asset_domain.c.domain_code)
        )

    def _load_layer_rows(self, domain=None):
        counted = select(asset_table.c.layer_code, func.count().label("table_count")).select_from(asset_table)
        if str(domain or "").strip():
            counted = counted.join(asset_domain, asset_domain.c.domain_code == asset_table.c.domain_code).where(
                func.lower(asset_domain.c.domain_name) == str(domain).strip().lower()
            )
        counted = counted.group_by(asset_table.c.layer_code).subquery()
        return self._fetch_rows(
            select(
                asset_layer.c.layer_code,
                asset_layer.c.layer_name,
                asset_layer.c.display_order,
                asset_layer.c.is_active,
                func.coalesce(counted.c.table_count, 0).label("table_count"),
            )
            .select_from(asset_layer.outerjoin(counted, asset_layer.c.layer_code == counted.c.layer_code))
            .order_by(asset_layer.c.display_order, asset_layer.c.layer_code)
        )

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

    def _build_asset_filters(self, *, keyword=None, schema_name=None, layer=None, domain=None, owner=None):
        code_to_name, name_to_code = self._load_domain_mappings()
        clauses = []
        normalized_keyword = str(keyword or "").strip().lower()
        if normalized_keyword:
            like = f"%{normalized_keyword}%"
            field_match = exists(
                select(1).where(
                    asset_field.c.asset_id == asset_table.c.asset_id,
                    asset_field.c.is_deleted == "N",
                    or_(
                        func.lower(func.coalesce(asset_field.c.field_name, "")).like(like),
                        func.lower(func.coalesce(asset_field.c.field_cn_name, "")).like(like),
                        func.lower(func.coalesce(asset_field.c.field_desc, "")).like(like),
                    ),
                )
            )
            clauses.append(
                or_(
                    self._like(asset_table.c.table_name, keyword),
                    self._like(asset_table.c.table_cn_name, keyword),
                    self._like(asset_table.c.owner_name, keyword),
                    self._like(asset_table.c.schema_name, keyword),
                    self._like(asset_table.c.grain_desc, keyword),
                    self._like(asset_table.c.cycle_desc, keyword),
                    self._like(asset_table.c.table_desc, keyword),
                    self._like(asset_domain.c.domain_name, keyword),
                    field_match,
                )
            )
        if schema_name:
            clauses.append(asset_table.c.schema_name == schema_name)
        if layer:
            clauses.append(asset_table.c.layer_code == layer)
        if domain:
            clauses.append(asset_table.c.domain_code == name_to_code.get(domain, domain))
        if owner:
            clauses.append(asset_table.c.owner_name == owner)
        return clauses, code_to_name

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
        clauses, code_to_name = self._build_asset_filters(
            keyword=keyword,
            schema_name=schema_name,
            layer=layer,
            domain=domain,
            owner=owner,
        )
        normalized_keyword = str(keyword or "").strip().lower()
        field_match_sql = None
        if normalized_keyword:
            like = f"%{normalized_keyword}%"
            field_match_sql = (
                select(
                    asset_field.c.field_name.concat(" ").concat(
                        func.coalesce(asset_field.c.field_cn_name, asset_field.c.field_desc, "")
                    )
                )
                .where(
                    asset_field.c.asset_id == asset_table.c.asset_id,
                    asset_field.c.is_deleted == "N",
                    or_(
                        func.lower(func.coalesce(asset_field.c.field_name, "")).like(like),
                        func.lower(func.coalesce(asset_field.c.field_cn_name, "")).like(like),
                        func.lower(func.coalesce(asset_field.c.field_desc, "")).like(like),
                    ),
                )
                .order_by(asset_field.c.field_order, asset_field.c.field_name)
                .limit(1)
                .scalar_subquery()
                .label("field_match")
            )
        columns = [
            asset_table.c.asset_id,
            asset_table.c.table_name,
            asset_table.c.table_cn_name,
            asset_table.c.schema_name,
            asset_table.c.layer_code,
            asset_table.c.domain_code,
            asset_table.c.owner_name,
            asset_table.c.grain_desc,
            asset_table.c.cycle_desc,
            asset_table.c.table_desc,
            asset_table.c.field_count,
            asset_table.c.created_at,
            asset_table.c.updated_at,
            func.count().over().label("total_count"),
        ]
        if field_match_sql is not None:
            columns.append(field_match_sql)
        statement = select(*columns).select_from(
            asset_table.outerjoin(asset_domain, asset_domain.c.domain_code == asset_table.c.domain_code)
        )
        for clause in clauses:
            statement = statement.where(clause)
        statement = statement.order_by(*self._normalize_asset_order(order_by))
        if paginate:
            statement = statement.limit(page_size).offset(offset)
        rows = self._fetch_rows_logged(
            statement,
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
        clauses, _ = self._build_asset_filters(
            keyword=keyword,
            schema_name=schema_name,
            layer=layer,
            domain=domain,
            owner=owner,
        )
        statement = select(func.count().label("total_count")).select_from(
            asset_table.outerjoin(asset_domain, asset_domain.c.domain_code == asset_table.c.domain_code)
        )
        for clause in clauses:
            statement = statement.where(clause)
        rows = self._fetch_rows_logged(
            statement,
            purpose="asset table count",
            method="_count_asset_rows",
            keyword=keyword,
        )
        return int(rows[0].get("total_count") or 0)

    def _load_table_rows(self, layer=None, domain=None):
        clauses, code_to_name = self._build_asset_filters(layer=layer, domain=domain)
        statement = select(
            asset_table.c.asset_id,
            asset_table.c.table_name,
            asset_table.c.table_cn_name,
            asset_table.c.schema_name,
            asset_table.c.layer_code,
            asset_table.c.domain_code,
            asset_table.c.owner_name,
            asset_table.c.grain_desc,
            asset_table.c.cycle_desc,
            asset_table.c.table_desc,
            asset_table.c.field_count,
            asset_table.c.created_at,
            asset_table.c.updated_at,
        ).select_from(
            asset_table.outerjoin(asset_domain, asset_domain.c.domain_code == asset_table.c.domain_code)
        )
        for clause in clauses:
            statement = statement.where(clause)
        rows = self._fetch_rows_logged(
            statement.order_by(asset_table.c.layer_code, asset_table.c.table_name),
            purpose="legacy asset full load",
            method="_load_table_rows",
        )
        for row in rows:
            row["domain_name"] = code_to_name.get(row.get("domain_code"), row.get("domain_code") or "")
        return rows

    def _load_field_rows(self, asset_ids, *, purpose="asset field list", method="_load_field_rows"):
        if not asset_ids:
            return {}
        rows = self._fetch_rows_logged(
            select(
                asset_field.c.field_id,
                asset_field.c.asset_id,
                asset_field.c.field_name,
                asset_field.c.field_cn_name,
                asset_field.c.data_type,
                asset_field.c.field_order,
                asset_field.c.nullable_flag,
                asset_field.c.pk_flag,
                asset_field.c.partition_flag,
                asset_field.c.enum_desc,
                asset_field.c.field_desc,
            )
            .where(asset_field.c.asset_id.in_([int(asset_id) for asset_id in asset_ids]))
            .order_by(asset_field.c.asset_id, asset_field.c.field_order, asset_field.c.field_name),
            purpose=purpose,
            method=method,
        )
        grouped = {}
        for row in rows:
            grouped.setdefault(int(row["asset_id"]), []).append(
                {
                    "fieldId": int(row["field_id"]),
                    "assetId": int(row["asset_id"]),
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
            "assetId": int(row["asset_id"]),
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
        clauses = []
        if asset_id is not None:
            clauses.append(asset_table.c.asset_id == int(asset_id))
        if table_name is not None:
            clauses.append(asset_table.c.table_name == self._ensure_safe_name(table_name, "table_name"))
        if schema_name:
            clauses.append(asset_table.c.schema_name == schema_name)
        if not clauses:
            raise AssetValidationError([{"field": "table", "message": "missing table lookup condition"}])

        code_to_name, _ = self._load_domain_mappings()
        statement = select(
            asset_table.c.asset_id,
            asset_table.c.table_name,
            asset_table.c.table_cn_name,
            asset_table.c.schema_name,
            asset_table.c.layer_code,
            asset_table.c.domain_code,
            asset_table.c.owner_name,
            asset_table.c.grain_desc,
            asset_table.c.cycle_desc,
            asset_table.c.table_desc,
            asset_table.c.field_count,
            asset_table.c.created_at,
            asset_table.c.updated_at,
        )
        for clause in clauses:
            statement = statement.where(clause)
        rows = self._fetch_rows_logged(
            statement.limit(1),
            purpose="asset table detail",
            method="_load_single_table_row",
        )
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
        return self._load_single_table_row(table_name=self._ensure_safe_name(table_name))

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
        name_text = name.strip() if isinstance(name, str) else ""
        cn_text = cn.strip() if isinstance(cn, str) else ""
        domain_text = domain.strip() if isinstance(domain, str) else ""
        layer_text = layer.strip() if isinstance(layer, str) else ""
        field_items = fields if isinstance(fields, list) else []
        if not name_text:
            details.append({"field": "name", "message": "表英文名不能为空"})
        elif not NAME_PATTERN.fullmatch(name_text):
            details.append({"field": "name", "message": "表英文名格式不正确"})
        if not cn_text:
            details.append({"field": "cn", "message": "表中文名不能为空"})
        if not domain_text:
            details.append({"field": "domain", "message": "主题域不能为空"})
        if not layer_text:
            details.append({"field": "layer", "message": "分层不能为空"})
        if not field_items:
            details.append({"field": "fields", "message": "字段列表至少 1 项"})
        else:
            self._validate_fields(field_items, details)
        _, name_to_code = self._load_domain_mappings()
        if domain_text and domain_text not in name_to_code:
            details.append({"field": "domain", "message": f"主题域不存在: {domain_text}"})
        valid_layer_codes = {item["code"] for item in self.get_layers()}
        if layer_text and layer_text not in valid_layer_codes:
            details.append({"field": "layer", "message": f"分层不存在: {layer_text}"})
        if details:
            raise AssetValidationError(details)
        return {
            "name": name_text,
            "cn": cn_text,
            "domain": domain_text,
            "layer": layer_text,
            "schema": (payload.get("schema") or "").strip() or self._normalize_layer_schema(layer_text),
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
                for field in field_items
            ],
            "current_name": current_name,
        }

    def _ensure_db_table_absent(self, table_name, exclude_asset_id=None):
        safe_name = self._ensure_safe_name(table_name)
        rows = self._fetch_rows_logged(
            select(asset_table.c.asset_id).where(asset_table.c.table_name == safe_name).limit(1),
            purpose="asset uniqueness check",
            method="_ensure_db_table_absent",
        )
        if not rows:
            return
        if exclude_asset_id is not None and int(rows[0]["asset_id"]) == int(exclude_asset_id):
            return
        raise AssetAlreadyExistsError(table_name)

    def _insert_db_fields(self, asset_id, fields):
        field_id = self._get_next_id(asset_field, asset_field.c.field_id)
        statements = []
        for index, field in enumerate(fields, start=1):
            statements.append(
                insert(asset_field).values(
                    field_id=field_id,
                    asset_id=int(asset_id),
                    field_name=field["name"],
                    field_cn_name=field["cn"],
                    data_type=field["type"],
                    field_order=index,
                    nullable_flag=self._flag(field["nullable"]),
                    pk_flag=self._flag(field["pk"]),
                    partition_flag=self._flag(field["part"]),
                    enum_desc=field.get("enum"),
                    field_desc=field["cn"],
                    created_by=self._default_operator,
                    updated_by=self._default_operator,
                )
            )
            field_id += 1
        return statements

    def _insert_change_log(self, asset_id, table_name, change_type, before_data, after_data):
        change_id = self._get_next_id(asset_change_log, asset_change_log.c.change_id)
        summary = {
            "CREATE_TABLE": "创建资产表",
            "UPDATE_TABLE": "更新资产表",
            "UPDATE_FIELDS": "更新字段列表",
            "DELETE_TABLE": "删除资产表",
        }.get(change_type, change_type)
        return insert(asset_change_log).values(
            change_id=change_id,
            asset_id=asset_id,
            table_name=table_name,
            change_type=change_type,
            change_summary=summary,
            before_json=json.dumps(before_data, ensure_ascii=False) if before_data is not None else None,
            after_json=json.dumps(after_data, ensure_ascii=False) if after_data is not None else None,
            operator_name=self._default_operator,
        )

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

    @actor_aware
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
        asset_id = self._get_next_id(asset_table, asset_table.c.asset_id)
        domain_code = name_to_code[table["domain"]]
        after_data = {key: deepcopy(value) for key, value in table.items() if key != "current_name"}
        statements = [
            insert(asset_table).values(
                asset_id=asset_id,
                table_name=table["name"],
                table_cn_name=table["cn"],
                schema_name=table["schema"],
                layer_code=table["layer"],
                domain_code=domain_code,
                owner_name=table["owner"],
                grain_desc=table["grain"],
                cycle_desc=table["cycle"],
                table_desc=table["desc"],
                field_count=len(table["fields"]),
                created_by=self._default_operator,
                updated_by=self._default_operator,
            ),
            *self._insert_db_fields(asset_id, table["fields"]),
            self._insert_change_log(asset_id, table["name"], "CREATE_TABLE", None, after_data),
        ]
        self._execute_statements(statements)
        return self._with_empty_asset_risks(self._get_db_asset_detail(table["name"])), table, after_data

    @actor_aware
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
        try:
            asset_id = int(current_row["asset_id"])
        except (KeyError, TypeError, ValueError) as error:
            raise AssetDataSourceError("数据库查询失败") from error
        statements = [
            update(asset_table)
            .where(asset_table.c.asset_id == asset_id)
            .values(
                table_name=table["name"],
                table_cn_name=table["cn"],
                schema_name=table["schema"],
                layer_code=table["layer"],
                domain_code=name_to_code[table["domain"]],
                owner_name=table["owner"],
                grain_desc=table["grain"],
                cycle_desc=table["cycle"],
                table_desc=table["desc"],
                field_count=len(table["fields"]),
                updated_by=self._default_operator,
                updated_at=func.current_timestamp(),
            ),
            delete(asset_field).where(asset_field.c.asset_id == asset_id),
            *self._insert_db_fields(asset_id, table["fields"]),
            self._insert_change_log(asset_id, table["name"], "UPDATE_TABLE", current, after_data),
        ]
        self._execute_statements(statements)
        return self._with_empty_asset_risks(self._get_db_asset_detail(table["name"])), current, after_data, table["name"]

    @actor_aware
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
        field_items = fields if isinstance(fields, list) else []
        details = []
        if not field_items:
            details.append({"field": "fields", "message": "字段列表至少 1 项"})
        else:
            self._validate_fields(field_items, details)
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
            for field in field_items
        ]
        after_data = {**deepcopy(current), "fields": deepcopy(normalized_fields)}
        try:
            asset_id = int(current_row["asset_id"])
        except (KeyError, TypeError, ValueError) as error:
            raise AssetDataSourceError("数据库查询失败") from error
        statements = [
            delete(asset_field).where(asset_field.c.asset_id == asset_id),
            *self._insert_db_fields(asset_id, normalized_fields),
            update(asset_table)
            .where(asset_table.c.asset_id == asset_id)
            .values(
                field_count=len(normalized_fields),
                updated_by=self._default_operator,
                updated_at=func.current_timestamp(),
            ),
            self._insert_change_log(asset_id, table_name, "UPDATE_FIELDS", current, after_data),
        ]
        self._execute_statements(statements)
        return {"tableName": table_name, "fields": deepcopy(normalized_fields)}, current, after_data

    @actor_aware
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
        try:
            asset_id = int(current_row["asset_id"])
        except (KeyError, TypeError, ValueError) as error:
            raise AssetDataSourceError("数据库查询失败") from error
        self._execute_statements([
            self._insert_change_log(asset_id, table_name, "DELETE_TABLE", current, None),
            delete(asset_field).where(asset_field.c.asset_id == asset_id),
            delete(asset_table).where(asset_table.c.asset_id == asset_id),
        ])
        return current


assets_service = AssetsService()
