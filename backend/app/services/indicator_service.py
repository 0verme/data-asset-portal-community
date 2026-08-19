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
import os
import re
from copy import deepcopy
from datetime import date

from .common_code_service import (
    CommonCodeCategoryNotFoundError,
    CommonCodeDataSourceError,
    common_code_service,
)
from ..db.gaussdb import execute_statements, fetch_all, resolve_db_profile_name
from ..settings import get_default_operator
from .operation_log_service import (
    OPERATION_TYPE_CREATE,
    OPERATION_TYPE_DELETE,
    OPERATION_TYPE_DISABLE,
    OPERATION_TYPE_ENABLE,
    OPERATION_TYPE_UPDATE,
    operation_log_service,
)


INDICATOR_ID_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]*$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
ALLOWED_DIMENSIONS = {
    "cus", "con", "due", "emp", "org",  # finance/corporate dimensions
    "prd", "mem", "ord", "str", "inv", "mkt", "ful", "svc",  # retail demo dimensions
}
DIMENSION_CODE_MAP = {
    "CUS": "cus", "CON": "con", "DUE": "due", "EMP": "emp", "ORG": "org",
    "PRD": "prd", "MEM": "mem", "ORD": "ord", "STR": "str",
    "INV": "inv", "MKT": "mkt", "FUL": "ful", "SVC": "svc",
}
DIMENSION_LABEL_MAP = {
    "客户维度": "cus", "合同维度": "con", "借据维度": "due", "员工维度": "emp", "机构维度": "org",
    "商品维度": "prd", "会员维度": "mem", "交易维度": "ord", "门店维度": "str",
    "库存维度": "inv", "营销维度": "mkt", "履约维度": "ful", "售后维度": "svc",
}
DEFAULT_STATUS = {"enabled", "disabled"}
TABLE_INDICATOR_ITEM = "dwp.p_indicator_item"
TABLE_INDICATOR_CHANGE_LOG = "dwp.p_indicator_change_log"


class IndicatorNotFoundError(Exception):
    def __init__(self, indicator_id):
        self.indicator_id = indicator_id
        super().__init__(f"Indicator not found: {indicator_id}")

    def to_dict(self):
        return {"code": "INDICATOR_NOT_FOUND", "message": f"Indicator not found: {self.indicator_id}"}


class IndicatorAlreadyExistsError(Exception):
    def __init__(self, indicator_id):
        self.indicator_id = indicator_id
        super().__init__(f"Indicator already exists: {indicator_id}")

    def to_dict(self):
        return {"code": "INDICATOR_ALREADY_EXISTS", "message": f"Indicator already exists: {self.indicator_id}"}


class IndicatorValidationError(Exception):
    def __init__(self, details):
        self.details = details
        super().__init__("Indicator validation failed")

    def to_dict(self):
        return {"code": "INDICATOR_VALIDATION_FAILED", "message": "Indicator validation failed", "details": self.details}


class IndicatorDataSourceError(Exception):
    def __init__(self, message):
        self.message = message
        super().__init__(message)

    def to_dict(self):
        return {"code": "INDICATOR_DATA_SOURCE_ERROR", "message": self.message}


class IndicatorService:
    def __init__(self):
        self._db_profile = os.getenv("ASSET_DB_PROFILE", "").strip()
        self._default_operator = get_default_operator()

    def _fetch_rows(self, sql):
        try:
            columns, rows = fetch_all(self._db_profile or resolve_db_profile_name(), sql)
        except FileNotFoundError as error:
            raise IndicatorDataSourceError("数据库配置文件不存在") from error
        except KeyError as error:
            raise IndicatorDataSourceError("数据库服务暂不可用，请稍后重试") from error
        except RuntimeError as error:
            raise IndicatorDataSourceError("数据库服务暂不可用，请稍后重试") from error
        except Exception as error:
            raise IndicatorDataSourceError("数据库查询失败") from error
        return [dict(zip(columns, row)) for row in rows]

    def _execute(self, statements):
        try:
            return execute_statements(self._db_profile or resolve_db_profile_name(), statements)
        except FileNotFoundError as error:
            raise IndicatorDataSourceError("数据库配置文件不存在") from error
        except KeyError as error:
            raise IndicatorDataSourceError("数据库服务暂不可用，请稍后重试") from error
        except RuntimeError as error:
            raise IndicatorDataSourceError("数据库服务暂不可用，请稍后重试") from error
        except Exception as error:
            raise IndicatorDataSourceError("数据库执行失败") from error

    def _quote(self, value):
        if value is None:
            return "NULL"
        return "'" + str(value).replace("'", "''") + "'"

    def _next_id(self, table_name, id_column):
        rows = self._fetch_rows(f"SELECT COALESCE(MAX({id_column}), 0) + 1 AS next_id FROM {table_name}")
        return int(rows[0]["next_id"])

    def _allowed_status_values(self):
        try:
            return {value for value in common_code_service.get_item_values("SYSTEM_STATUS") if value}
        except (CommonCodeCategoryNotFoundError, CommonCodeDataSourceError):
            return set(DEFAULT_STATUS)

    def _normalize_dimension(self, value):
        raw = str(value or "").strip()
        if not raw:
            return ""
        lower = raw.lower()
        if lower in ALLOWED_DIMENSIONS:
            return lower
        upper = raw.upper()
        if upper in DIMENSION_CODE_MAP:
            return DIMENSION_CODE_MAP[upper]
        return DIMENSION_LABEL_MAP.get(raw, "")

    def _derive_dimension_from_path(self, path):
        raw = str(path or "").strip()
        if not raw:
            return ""
        root = raw.split(" > ", 1)[0].strip()
        return self._normalize_dimension(root)

    def _normalize_payload(self, payload):
        if not isinstance(payload, dict):
            raise IndicatorValidationError([{"field": "body", "message": "Request body must be a JSON object"}])

        details = []
        indicator_id = str(payload.get("id") or "").strip()
        name = str(payload.get("name") or "").strip()
        meaning = str(payload.get("meaning") or "").strip()
        result_table_name = str(payload.get("resultTableName") or payload.get("result_table_name") or "").strip()
        result_field_name = str(payload.get("resultFieldName") or payload.get("result_field_name") or "").strip()
        path = str(payload.get("path") or "").strip()
        dimension = self._normalize_dimension(payload.get("dimension")) or self._derive_dimension_from_path(path)
        caliber = str(payload.get("caliber") or "").strip()
        status = str(payload.get("status") or "").strip()
        registrar = str(payload.get("registrar") or "").strip()
        registered_at = str(payload.get("registeredAt") or "").strip()
        allowed_status = self._allowed_status_values()

        if not indicator_id:
            details.append({"field": "id", "message": "id is required"})
        elif not INDICATOR_ID_RE.fullmatch(indicator_id):
            details.append({"field": "id", "message": "id format is invalid"})
        if not name:
            details.append({"field": "name", "message": "name is required"})
        if dimension not in ALLOWED_DIMENSIONS:
            details.append({"field": "dimension", "message": f"dimension must be one of: {', '.join(sorted(ALLOWED_DIMENSIONS))}"})
        if status not in allowed_status:
            details.append({"field": "status", "message": f"status is not allowed: {status}"})
        if not registrar:
            details.append({"field": "registrar", "message": "registrar is required"})
        if not registered_at:
            registered_at = date.today().isoformat()
        elif not DATE_RE.fullmatch(registered_at):
            details.append({"field": "registeredAt", "message": "registeredAt must use yyyy-mm-dd"})

        if details:
            raise IndicatorValidationError(details)

        return {
            "id": indicator_id.upper(),
            "name": name,
            "meaning": meaning,
            "resultTableName": result_table_name,
            "resultFieldName": result_field_name,
            "dimension": dimension,
            "caliber": caliber,
            "path": path,
            "status": status,
            "registrar": registrar,
            "registeredAt": registered_at,
        }

    def _filter_items(self, items, keyword=None, dimension=None, status=None):
        next_items = items
        normalized_dimension = self._normalize_dimension(dimension)
        if dimension:
            next_items = [item for item in next_items if item["dimension"] == normalized_dimension]
        if status:
            next_items = [item for item in next_items if item["status"] == status]
        if keyword:
            query = keyword.strip().lower()
            next_items = [
                item for item in next_items
                if any(
                    query in str(item[key] or "").lower()
                    for key in ("id", "name", "meaning", "resultTableName", "resultFieldName", "caliber", "path", "registrar")
                )
            ]
        return next_items

    def _db_items(self, keyword=None, dimension=None, status=None):
        where = ["is_deleted = 'N'"]
        if dimension:
            normalized_dimension = self._normalize_dimension(dimension)
            where.append(f"LOWER(dimension_code) = {self._quote(normalized_dimension)}")
        if status:
            where.append(f"status_code = {self._quote(status)}")
        sql = f"""
SELECT
    indicator_pk,
    indicator_id,
    indicator_name,
    meaning_desc,
    result_table_name,
    result_field_name,
    dimension_code,
    caliber_desc,
    path_desc,
    status_code,
    registrar_name,
    registered_date
FROM {TABLE_INDICATOR_ITEM}
WHERE {' AND '.join(where)}
ORDER BY indicator_id
"""
        rows = self._fetch_rows(sql)
        items = [{
            "id": row["indicator_id"],
            "name": row["indicator_name"],
            "meaning": row.get("meaning_desc") or "",
            "resultTableName": row.get("result_table_name") or "",
            "resultFieldName": row.get("result_field_name") or "",
            "dimension": self._normalize_dimension(row["dimension_code"]),
            "caliber": row.get("caliber_desc") or "",
            "path": row.get("path_desc") or "",
            "status": row["status_code"],
            "registrar": row["registrar_name"],
            "registeredAt": row["registered_date"],
        } for row in rows]
        return self._filter_items(items, keyword=keyword)

    def get_indicators(self, keyword=None, dimension=None, status=None):
        return self._db_items(keyword=keyword, dimension=dimension, status=status)

    def get_indicator_detail(self, indicator_id):
        item = next((current for current in self.get_indicators() if current["id"] == indicator_id), None)
        if not item:
            raise IndicatorNotFoundError(indicator_id)
        return deepcopy(item)

    def create_indicator(self, payload):
        with operation_log_service.audit(
            module_name="指标维护",
            operation_type=OPERATION_TYPE_CREATE,
            operation_object=str((payload or {}).get("id") or "") if isinstance(payload, dict) else "",
            operation_desc="新增指标",
        ) as audit:
            item = self._create_indicator(payload)
            audit.operation_object = item["id"]
            audit.after = item
            return item

    def _create_indicator(self, payload):
        item = self._normalize_payload(payload)
        if any(current["id"] == item["id"] for current in self.get_indicators()):
            raise IndicatorAlreadyExistsError(item["id"])

        indicator_pk = self._next_id(TABLE_INDICATOR_ITEM, "indicator_pk")
        change_id = self._next_id(TABLE_INDICATOR_CHANGE_LOG, "change_id")
        statements = [
            f"""
INSERT INTO {TABLE_INDICATOR_ITEM} (
  indicator_pk, indicator_id, indicator_name, meaning_desc, result_table_name, result_field_name, dimension_code, caliber_desc, path_desc,
  status_code, registrar_name, registered_date, created_by, updated_by
) VALUES (
  {indicator_pk}, {self._quote(item['id'])}, {self._quote(item['name'])}, {self._quote(item['meaning'])},
  {self._quote(item['resultTableName'])}, {self._quote(item['resultFieldName'])}, {self._quote(item['dimension'])}, {self._quote(item['caliber'])}, {self._quote(item['path'])},
  {self._quote(item['status'])}, {self._quote(item['registrar'])}, {self._quote(item['registeredAt'])},
  {self._quote(self._default_operator)}, {self._quote(self._default_operator)}
)
""".strip(),
            f"""
INSERT INTO {TABLE_INDICATOR_CHANGE_LOG} (
  change_id, indicator_pk, indicator_id, change_type, change_summary, after_json, operator_name
) VALUES (
  {change_id}, {indicator_pk}, {self._quote(item['id'])}, 'CREATE_INDICATOR', 'create indicator',
  {self._quote(json.dumps(item, ensure_ascii=False))}, {self._quote(self._default_operator)}
)
""".strip(),
        ]
        self._execute(statements)
        return item

    def update_indicator(self, indicator_id, payload):
        with operation_log_service.audit(
            module_name="指标维护",
            operation_type=OPERATION_TYPE_UPDATE,
            operation_object=indicator_id,
            operation_desc="编辑指标",
        ) as audit:
            current, item = self._update_indicator(indicator_id, payload)
            audit.operation_object = item["id"]
            audit.before = current
            audit.after = item
            return item

    def _update_indicator(self, indicator_id, payload):
        item = self._normalize_payload(payload)
        rows = self._fetch_rows(f"SELECT indicator_pk FROM {TABLE_INDICATOR_ITEM} WHERE indicator_id = {self._quote(indicator_id)} AND is_deleted = 'N'")
        if not rows:
            raise IndicatorNotFoundError(indicator_id)
        if item["id"] != indicator_id and any(current["id"] == item["id"] for current in self.get_indicators()):
            raise IndicatorAlreadyExistsError(item["id"])

        current = self.get_indicator_detail(indicator_id)
        indicator_pk = int(rows[0]["indicator_pk"])
        change_id = self._next_id(TABLE_INDICATOR_CHANGE_LOG, "change_id")
        statements = [
            f"""
UPDATE {TABLE_INDICATOR_ITEM}
SET
  indicator_id = {self._quote(item['id'])},
  indicator_name = {self._quote(item['name'])},
  meaning_desc = {self._quote(item['meaning'])},
  result_table_name = {self._quote(item['resultTableName'])},
  result_field_name = {self._quote(item['resultFieldName'])},
  dimension_code = {self._quote(item['dimension'])},
  caliber_desc = {self._quote(item['caliber'])},
  path_desc = {self._quote(item['path'])},
  status_code = {self._quote(item['status'])},
  registrar_name = {self._quote(item['registrar'])},
  registered_date = {self._quote(item['registeredAt'])},
  updated_by = {self._quote(self._default_operator)},
  updated_at = CURRENT_TIMESTAMP
WHERE indicator_pk = {indicator_pk}
""".strip(),
            f"""
INSERT INTO {TABLE_INDICATOR_CHANGE_LOG} (
  change_id, indicator_pk, indicator_id, change_type, change_summary, before_json, after_json, operator_name
) VALUES (
  {change_id}, {indicator_pk}, {self._quote(item['id'])}, 'UPDATE_INDICATOR', 'update indicator',
  {self._quote(json.dumps(current, ensure_ascii=False))},
  {self._quote(json.dumps(item, ensure_ascii=False))},
  {self._quote(self._default_operator)}
)
""".strip(),
        ]
        self._execute(statements)
        return current, item

    def patch_status(self, indicator_id, status):
        normalized = str(status or "").strip()
        if normalized not in self._allowed_status_values():
            raise IndicatorValidationError([{"field": "status", "message": f"status is not allowed: {normalized}"}])
        current = self.get_indicator_detail(indicator_id)
        operation_type = OPERATION_TYPE_DISABLE if normalized == "disabled" else OPERATION_TYPE_ENABLE
        with operation_log_service.audit(
            module_name="指标维护",
            operation_type=operation_type,
            operation_object=indicator_id,
            operation_desc=f"{operation_type}指标",
        ) as audit:
            rows = self._fetch_rows(f"SELECT indicator_pk FROM {TABLE_INDICATOR_ITEM} WHERE indicator_id = {self._quote(indicator_id)} AND is_deleted = 'N'")
            if not rows:
                raise IndicatorNotFoundError(indicator_id)
            indicator_pk = int(rows[0]["indicator_pk"])
            item = {**current, "status": normalized}
            change_id = self._next_id(TABLE_INDICATOR_CHANGE_LOG, "change_id")
            self._execute([
                f"UPDATE {TABLE_INDICATOR_ITEM} SET status_code = {self._quote(normalized)}, updated_by = {self._quote(self._default_operator)}, updated_at = CURRENT_TIMESTAMP WHERE indicator_pk = {indicator_pk}",
                f"""
INSERT INTO {TABLE_INDICATOR_CHANGE_LOG} (
  change_id, indicator_pk, indicator_id, change_type, change_summary, before_json, after_json, operator_name
) VALUES (
  {change_id}, {indicator_pk}, {self._quote(indicator_id)}, 'UPDATE_STATUS', 'update indicator status',
  {self._quote(json.dumps(current, ensure_ascii=False))},
  {self._quote(json.dumps(item, ensure_ascii=False))},
  {self._quote(self._default_operator)}
)
""".strip(),
            ])
            audit.operation_object = item["id"]
            audit.before = current
            audit.after = item
            return item

    def delete_indicator(self, indicator_id):
        with operation_log_service.audit(
            module_name="指标维护",
            operation_type=OPERATION_TYPE_DELETE,
            operation_object=indicator_id,
            operation_desc="删除指标",
        ) as audit:
            audit.before = self._delete_indicator(indicator_id)

    def _delete_indicator(self, indicator_id):
        rows = self._fetch_rows(f"SELECT indicator_pk FROM {TABLE_INDICATOR_ITEM} WHERE indicator_id = {self._quote(indicator_id)} AND is_deleted = 'N'")
        if not rows:
            raise IndicatorNotFoundError(indicator_id)
        current = self.get_indicator_detail(indicator_id)
        indicator_pk = int(rows[0]["indicator_pk"])
        change_id = self._next_id(TABLE_INDICATOR_CHANGE_LOG, "change_id")
        statements = [
            f"""
UPDATE {TABLE_INDICATOR_ITEM}
SET is_deleted = 'Y', updated_by = {self._quote(self._default_operator)}, updated_at = CURRENT_TIMESTAMP
WHERE indicator_pk = {indicator_pk}
""".strip(),
            f"""
INSERT INTO {TABLE_INDICATOR_CHANGE_LOG} (
  change_id, indicator_pk, indicator_id, change_type, change_summary, before_json, operator_name
) VALUES (
  {change_id}, {indicator_pk}, {self._quote(indicator_id)}, 'DELETE_INDICATOR', 'delete indicator',
  {self._quote(json.dumps(current, ensure_ascii=False))}, {self._quote(self._default_operator)}
)
""".strip(),
        ]
        self._execute(statements)
        return current


indicator_service = IndicatorService()
