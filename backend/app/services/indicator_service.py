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

from sqlalchemy import and_, func, insert, or_, select, update

from ..db.service import CoreAccess
from ..db.tables import indicator_change_log, indicator_item
from ..settings import get_default_operator
from .common_code_service import (
    CommonCodeCategoryNotFoundError,
    CommonCodeDataSourceError,
    common_code_service,
)
from .operation_log_service import (
    OPERATION_TYPE_CREATE,
    OPERATION_TYPE_DELETE,
    OPERATION_TYPE_DISABLE,
    OPERATION_TYPE_ENABLE,
    OPERATION_TYPE_UPDATE,
    operation_log_service,
)

# pyright: reportMissingImports=false

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
        self._db = CoreAccess(
            profile_getter=lambda: self._db_profile,
            error_factory=IndicatorDataSourceError,
        )

    def _fetch_rows(self, statement):
        return self._db.fetch_rows(statement)

    def _execute(self, statements):
        return self._db.execute_statements(statements)

    def _next_id(self, table, column):
        return self._db.next_pk(table, column)

    def _row_int(self, rows, key):
        try:
            return int(rows[0][key])
        except (IndexError, KeyError, TypeError, ValueError) as error:
            raise IndicatorDataSourceError("数据库查询失败") from error

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

    def _build_indicator_filters(self, keyword=None, dimension=None, status=None):
        clauses = [indicator_item.c.is_deleted == "N"]
        if dimension:
            clauses.append(func.lower(indicator_item.c.dimension_code) == self._normalize_dimension(dimension))
        if status:
            clauses.append(indicator_item.c.status_code == status)
        if keyword:
            query = str(keyword).strip().lower()
            escaped_query = query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            pattern = f"%{escaped_query}%"
            searchable = (
                indicator_item.c.indicator_id,
                indicator_item.c.indicator_name,
                indicator_item.c.meaning_desc,
                indicator_item.c.result_table_name,
                indicator_item.c.result_field_name,
                indicator_item.c.caliber_desc,
                indicator_item.c.path_desc,
                indicator_item.c.registrar_name,
            )
            clauses.append(or_(*(
                func.lower(func.coalesce(column, "")).like(pattern, escape="\\")
                for column in searchable
            )))
        return clauses

    def _row_to_item(self, row):
        return {
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
        }

    def _db_items(self, keyword=None, dimension=None, status=None):
        statement = select(
            indicator_item.c.indicator_pk,
            indicator_item.c.indicator_id,
            indicator_item.c.indicator_name,
            indicator_item.c.meaning_desc,
            indicator_item.c.result_table_name,
            indicator_item.c.result_field_name,
            indicator_item.c.dimension_code,
            indicator_item.c.caliber_desc,
            indicator_item.c.path_desc,
            indicator_item.c.status_code,
            indicator_item.c.registrar_name,
            indicator_item.c.registered_date,
        ).where(*self._build_indicator_filters(keyword, dimension, status)).order_by(indicator_item.c.indicator_id)
        return [self._row_to_item(row) for row in self._fetch_rows(statement)]

    def get_indicators(self, keyword=None, dimension=None, status=None):
        return self._db_items(keyword=keyword, dimension=dimension, status=status)

    def get_indicator_detail(self, indicator_id):
        item = next((current for current in self.get_indicators() if current["id"] == indicator_id), None)
        if not item:
            raise IndicatorNotFoundError(indicator_id)
        return deepcopy(item)

    def _insert_item(self, item, indicator_pk):
        return insert(indicator_item).values(
            indicator_pk=indicator_pk,
            indicator_id=item["id"],
            indicator_name=item["name"],
            meaning_desc=item["meaning"],
            result_table_name=item["resultTableName"],
            result_field_name=item["resultFieldName"],
            dimension_code=item["dimension"],
            caliber_desc=item["caliber"],
            path_desc=item["path"],
            status_code=item["status"],
            registrar_name=item["registrar"],
            registered_date=item["registeredAt"],
            is_deleted="N",
            created_by=self._default_operator,
            updated_by=self._default_operator,
        )

    def _insert_change_log(self, *, change_id, indicator_pk, indicator_id, change_type, before=None, after=None):
        return insert(indicator_change_log).values(
            change_id=change_id,
            indicator_pk=indicator_pk,
            indicator_id=indicator_id,
            change_type=change_type,
            change_summary={
                "CREATE_INDICATOR": "create indicator",
                "UPDATE_INDICATOR": "update indicator",
                "UPDATE_STATUS": "update indicator status",
                "DELETE_INDICATOR": "delete indicator",
            }[change_type],
            before_json=json.dumps(before, ensure_ascii=False) if before is not None else None,
            after_json=json.dumps(after, ensure_ascii=False) if after is not None else None,
            operator_name=self._default_operator,
        )

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

        indicator_pk = self._next_id(indicator_item, indicator_item.c.indicator_pk)
        change_id = self._next_id(indicator_change_log, indicator_change_log.c.change_id)
        self._execute([
            self._insert_item(item, indicator_pk),
            self._insert_change_log(
                change_id=change_id,
                indicator_pk=indicator_pk,
                indicator_id=item["id"],
                change_type="CREATE_INDICATOR",
                after=item,
            ),
        ])
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
        rows = self._fetch_rows(
            select(indicator_item.c.indicator_pk).where(
                and_(indicator_item.c.indicator_id == indicator_id, indicator_item.c.is_deleted == "N")
            )
        )
        if not rows:
            raise IndicatorNotFoundError(indicator_id)
        if item["id"] != indicator_id and any(current["id"] == item["id"] for current in self.get_indicators()):
            raise IndicatorAlreadyExistsError(item["id"])

        current = self.get_indicator_detail(indicator_id)
        indicator_pk = self._row_int(rows, "indicator_pk")
        change_id = self._next_id(indicator_change_log, indicator_change_log.c.change_id)
        self._execute([
            update(indicator_item).where(indicator_item.c.indicator_pk == indicator_pk).values(
                indicator_id=item["id"],
                indicator_name=item["name"],
                meaning_desc=item["meaning"],
                result_table_name=item["resultTableName"],
                result_field_name=item["resultFieldName"],
                dimension_code=item["dimension"],
                caliber_desc=item["caliber"],
                path_desc=item["path"],
                status_code=item["status"],
                registrar_name=item["registrar"],
                registered_date=item["registeredAt"],
                updated_by=self._default_operator,
                updated_at=func.current_timestamp(),
            ),
            self._insert_change_log(
                change_id=change_id,
                indicator_pk=indicator_pk,
                indicator_id=item["id"],
                change_type="UPDATE_INDICATOR",
                before=current,
                after=item,
            ),
        ])
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
            rows = self._fetch_rows(
                select(indicator_item.c.indicator_pk).where(
                    and_(indicator_item.c.indicator_id == indicator_id, indicator_item.c.is_deleted == "N")
                )
            )
            if not rows:
                raise IndicatorNotFoundError(indicator_id)
            indicator_pk = self._row_int(rows, "indicator_pk")
            item = {**current, "status": normalized}
            change_id = self._next_id(indicator_change_log, indicator_change_log.c.change_id)
            self._execute([
                update(indicator_item).where(indicator_item.c.indicator_pk == indicator_pk).values(
                    status_code=normalized,
                    updated_by=self._default_operator,
                    updated_at=func.current_timestamp(),
                ),
                self._insert_change_log(
                    change_id=change_id,
                    indicator_pk=indicator_pk,
                    indicator_id=indicator_id,
                    change_type="UPDATE_STATUS",
                    before=current,
                    after=item,
                ),
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
        rows = self._fetch_rows(
            select(indicator_item.c.indicator_pk).where(
                and_(indicator_item.c.indicator_id == indicator_id, indicator_item.c.is_deleted == "N")
            )
        )
        if not rows:
            raise IndicatorNotFoundError(indicator_id)
        current = self.get_indicator_detail(indicator_id)
        indicator_pk = self._row_int(rows, "indicator_pk")
        change_id = self._next_id(indicator_change_log, indicator_change_log.c.change_id)
        self._execute([
            update(indicator_item).where(indicator_item.c.indicator_pk == indicator_pk).values(
                is_deleted="Y",
                updated_by=self._default_operator,
                updated_at=func.current_timestamp(),
            ),
            self._insert_change_log(
                change_id=change_id,
                indicator_pk=indicator_pk,
                indicator_id=indicator_id,
                change_type="DELETE_INDICATOR",
                before=current,
            ),
        ])
        return current


indicator_service = IndicatorService()
