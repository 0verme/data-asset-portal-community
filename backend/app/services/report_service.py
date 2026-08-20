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
from json import JSONDecodeError
import os
import re
from copy import deepcopy
from typing import Any, cast

from sqlalchemy import and_, func, insert, or_, select, update

# pyright: reportMissingImports=false

from ..db.service import CoreAccess
from ..db.tables import asset_domain, asset_table, indicator_item, report_asset
from ..settings import get_default_operator
from .common_code_service import (
    CommonCodeCategoryNotFoundError,
    CommonCodeDataSourceError,
    common_code_service,
)
from .operation_log_service import (
    OPERATION_TYPE_CREATE,
    OPERATION_TYPE_DELETE,
    OPERATION_TYPE_UPDATE,
    operation_log_service,
)


REPORT_CODE_RE = re.compile(r"^[A-Z][A-Z0-9_-]{2,63}$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
DEFAULT_STATUS = {"enabled", "disabled"}
REPORT_TYPE_CATEGORY = "REPORT_TYPE"
REPORT_PERIOD_CATEGORY = "REPORT_STAT_PERIOD"
REPORT_DATE_CALIBER_CATEGORY = "REPORT_DATE_CALIBER"
REPORT_TIMELINESS_CATEGORY = "REPORT_DATA_TIMELINESS"
DEPARTMENT_CATEGORY = "UPSTREAM_DEPT"
DEFAULT_REPORT_TYPES = {"经营分析", "监管报送"}
DEFAULT_REPORT_PERIODS = {"实时", "5分钟", "15分钟", "30分钟", "小时", "日", "周", "月", "季", "年", "不定期"}
DEFAULT_REPORT_DATE_CALIBERS = {"当日", "T-1日", "自然周", "上一自然周", "自然月", "上一自然月", "自然季", "上一自然季", "自然年", "年初至今"}
DEFAULT_REPORT_TIMELINESS = {"实时", "T+0", "T+1", "T+2"}
LEGACY_COLUMNS = {
    "report_type": report_asset.c.report_type,
    "domain_name": report_asset.c.domain_name,
    "freq_code": report_asset.c.freq_code,
    "owner_dept_name": report_asset.c.owner_dept_name,
}


class ReportNotFoundError(Exception):
    def __init__(self, report_code):
        self.report_code = report_code
        super().__init__(f"Report not found: {report_code}")

    def to_dict(self):
        return {"code": "REPORT_NOT_FOUND", "message": f"Report not found: {self.report_code}"}


class ReportAlreadyExistsError(Exception):
    def __init__(self, report_code):
        self.report_code = report_code
        super().__init__(f"Report already exists: {report_code}")

    def to_dict(self):
        return {"code": "REPORT_ALREADY_EXISTS", "message": f"Report already exists: {self.report_code}"}


class ReportValidationError(Exception):
    def __init__(self, details):
        self.details = details
        super().__init__("Report validation failed")

    def to_dict(self):
        return {"code": "REPORT_VALIDATION_FAILED", "message": "Report validation failed", "details": self.details}


class ReportDataSourceError(Exception):
    def __init__(self, message):
        self.message = message
        super().__init__(message)

    def to_dict(self):
        return {"code": "REPORT_DATA_SOURCE_ERROR", "message": self.message}


class ReportService:
    def __init__(self):
        self._db_profile = os.getenv("ASSET_DB_PROFILE", "").strip()
        self._default_operator = get_default_operator()
        self._db = CoreAccess(
            profile_getter=lambda: self._db_profile,
            error_factory=ReportDataSourceError,
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
            raise ReportDataSourceError("数据库查询失败") from error

    def _allowed_status_values(self):
        try:
            return {value for value in common_code_service.get_item_values("SYSTEM_STATUS") if value}
        except (CommonCodeCategoryNotFoundError, CommonCodeDataSourceError):
            return set(DEFAULT_STATUS)

    def _allowed_code_values(self, category, fallback):
        try:
            values = {value for value in common_code_service.get_item_values(category) if value}
            return values or set(fallback)
        except (CommonCodeCategoryNotFoundError, CommonCodeDataSourceError):
            return set(fallback)

    def _domain_names(self):
        rows = self._fetch_rows(
            select(asset_domain.c.domain_name)
            .where(and_(asset_domain.c.is_active == "Y", asset_domain.c.is_deleted == "N"))
            .order_by(asset_domain.c.display_order, asset_domain.c.domain_name)
        )
        return {str(row.get("domain_name") or "").strip() for row in rows if row.get("domain_name")}

    def _legacy_values(self, column):
        mapped_column = LEGACY_COLUMNS[column]
        rows = self._fetch_rows(
            select(mapped_column.distinct().label("value")).where(report_asset.c.is_deleted == "N")
        )
        return {str(row.get("value") or "").strip() for row in rows if row.get("value")}

    @staticmethod
    def _legacy_time_fields(freq, time_caliber):
        period_map = {
            "日报": "日", "日": "日", "每日": "日", "每天": "日", "周报": "周", "周": "周",
            "每周": "周", "月报": "月", "月": "月", "每月": "月", "季报": "季", "季": "季",
            "每季": "季", "半年报": "半年", "年报": "年", "年": "年", "每年": "年", "实时": "实时",
            "不定期": "不定期",
        }
        period = period_map.get(str(freq or "").strip(), "")
        text = f"{freq or ''} {time_caliber or ''}"
        date_caliber = next((value for value in DEFAULT_REPORT_DATE_CALIBERS - {"其他"} if value in text), "")
        timeliness = next((value for value in ("T+3", "T+2", "T+1", "T+0") if value in text), "")
        return period, date_caliber, timeliness

    @staticmethod
    def _normalize_json_array(value):
        if isinstance(value, list):
            return value
        if isinstance(value, str) and value.strip():
            try:
                payload = json.loads(value)
            except JSONDecodeError:
                return []
            return payload if isinstance(payload, list) else []
        return []

    def _asset_lookup(self):
        rows = self._fetch_rows(
            select(
                asset_table.c.table_name,
                asset_table.c.table_cn_name,
                asset_table.c.layer_code,
                asset_table.c.domain_code,
            )
            .where(asset_table.c.is_deleted == "N")
            .order_by(asset_table.c.table_name)
        )
        return {
            str(row["table_name"]): {
                "tableName": str(row["table_name"]),
                "tableCn": row.get("table_cn_name") or row["table_name"],
                "layer": row.get("layer_code") or "",
                "domain": row.get("domain_code") or "",
            }
            for row in rows
            if row.get("table_name")
        }

    def _indicator_lookup(self):
        rows = self._fetch_rows(
            select(
                indicator_item.c.indicator_id,
                indicator_item.c.indicator_name,
                indicator_item.c.dimension_code,
                indicator_item.c.path_desc,
            )
            .where(indicator_item.c.is_deleted == "N")
            .order_by(indicator_item.c.indicator_id)
        )
        return {
            str(row["indicator_id"]): {
                "indicatorId": str(row["indicator_id"]),
                "indicatorName": row.get("indicator_name") or row["indicator_id"],
                "dimension": row.get("dimension_code") or "",
                "path": row.get("path_desc") or "",
            }
            for row in rows
            if row.get("indicator_id")
        }

    def _normalize_payload(self, payload):
        if not isinstance(payload, dict):
            raise ReportValidationError([{"field": "body", "message": "Request body must be a JSON object"}])

        details = []
        allowed_status = self._allowed_status_values()
        report_code = str(payload.get("code") or "").strip().upper()
        report_name = str(payload.get("name") or "").strip()
        report_type = str(payload.get("type") or "").strip()
        domain = str(payload.get("domain") or "").strip()
        stat_period = str(payload.get("statPeriod") or "").strip()
        date_caliber = str(payload.get("statCaliber") or payload.get("dateCaliberOther") or payload.get("dateCaliber") or payload.get("timeCaliber") or "").strip()
        data_timeliness = str(payload.get("dataDelay") or payload.get("dataTimelinessCustom") or payload.get("dataTimeliness") or "").strip()
        status = str(payload.get("status") or "").strip()
        owner_dept = str(payload.get("ownerDept") or "").strip()
        owner_name = str(payload.get("ownerName") or "").strip()
        maintainer_name = str(payload.get("maintainerName") or "").strip() or owner_name
        effective_date = str(payload.get("effectiveDate") or "").strip()
        expire_date = str(payload.get("expireDate") or "").strip()
        related_tables = payload.get("relatedTables")
        related_indicators = payload.get("relatedIndicators")

        if not report_code:
            details.append({"field": "code", "message": "code is required"})
        elif not REPORT_CODE_RE.fullmatch(report_code):
            details.append({"field": "code", "message": "code format is invalid"})
        if not report_name:
            details.append({"field": "name", "message": "name is required"})
        if not report_type:
            details.append({"field": "type", "message": "type is required"})
        elif report_type not in self._allowed_code_values(REPORT_TYPE_CATEGORY, DEFAULT_REPORT_TYPES) | self._legacy_values("report_type"):
            details.append({"field": "type", "message": f"type is not allowed: {report_type}"})
        if domain and domain not in self._domain_names() | self._legacy_values("domain_name"):
            details.append({"field": "domain", "message": f"domain does not exist: {domain}"})
        if stat_period not in self._allowed_code_values(REPORT_PERIOD_CATEGORY, DEFAULT_REPORT_PERIODS) | self._legacy_values("freq_code"):
            details.append({"field": "statPeriod", "message": f"statPeriod is not allowed: {stat_period}"})
        if not date_caliber:
            details.append({"field": "statCaliber", "message": "statCaliber is required"})
        elif len(date_caliber) > 32:
            details.append({"field": "statCaliber", "message": "statCaliber must not exceed 32 characters"})
        if len(data_timeliness) > 32:
            details.append({"field": "dataDelay", "message": "dataDelay must not exceed 32 characters"})
        if status not in allowed_status:
            details.append({"field": "status", "message": f"status is not allowed: {status}"})
        if not owner_dept:
            details.append({"field": "ownerDept", "message": "ownerDept is required"})
        elif owner_dept not in self._allowed_code_values(DEPARTMENT_CATEGORY, set()) | self._legacy_values("owner_dept_name"):
            details.append({"field": "ownerDept", "message": f"ownerDept is not allowed: {owner_dept}"})
        if not owner_name:
            details.append({"field": "ownerName", "message": "ownerName is required"})
        if effective_date and not DATE_RE.fullmatch(effective_date):
            details.append({"field": "effectiveDate", "message": "effectiveDate must use yyyy-mm-dd"})
        if expire_date and not DATE_RE.fullmatch(expire_date):
            details.append({"field": "expireDate", "message": "expireDate must use yyyy-mm-dd"})
        if effective_date and expire_date and expire_date < effective_date:
            details.append({"field": "expireDate", "message": "expireDate must be greater than or equal to effectiveDate"})
        if not isinstance(related_tables, list):
            details.append({"field": "relatedTables", "message": "relatedTables must be an array"})
        if not isinstance(related_indicators, list):
            details.append({"field": "relatedIndicators", "message": "relatedIndicators must be an array"})
        if details:
            raise ReportValidationError(details)

        related_tables = cast(list[dict[str, Any]], related_tables)
        related_indicators = cast(list[dict[str, Any]], related_indicators)
        asset_lookup = self._asset_lookup()
        indicator_lookup = self._indicator_lookup()
        normalized_tables = []
        normalized_indicators = []
        seen_table_names = set()
        seen_indicator_ids = set()

        for index, item in enumerate(related_tables):
            table_name = str((item or {}).get("tableName") or "").strip()
            if not table_name:
                details.append({"field": f"relatedTables[{index}].tableName", "message": "tableName is required"})
                continue
            if table_name in seen_table_names:
                continue
            match = asset_lookup.get(table_name)
            if not match:
                details.append({"field": f"relatedTables[{index}].tableName", "message": f"related table does not exist: {table_name}"})
                continue
            seen_table_names.add(table_name)
            normalized_tables.append(match)

        for index, item in enumerate(related_indicators):
            indicator_id = str((item or {}).get("indicatorId") or "").strip().upper()
            if not indicator_id:
                details.append({"field": f"relatedIndicators[{index}].indicatorId", "message": "indicatorId is required"})
                continue
            if indicator_id in seen_indicator_ids:
                continue
            match = indicator_lookup.get(indicator_id)
            if not match:
                details.append({"field": f"relatedIndicators[{index}].indicatorId", "message": f"related indicator does not exist: {indicator_id}"})
                continue
            seen_indicator_ids.add(indicator_id)
            normalized_indicators.append(match)

        if details:
            raise ReportValidationError(details)

        return {
            "code": report_code,
            "name": report_name,
            "alias": str(payload.get("alias") or "").strip(),
            "type": report_type,
            "domain": domain,
            "freq": stat_period,
            "statPeriod": stat_period,
            "statCaliber": date_caliber,
            "dataDelay": data_timeliness,
            "status": status,
            "effectiveDate": effective_date,
            "expireDate": expire_date,
            "purpose": str(payload.get("purpose") or "").strip(),
            "statObject": str(payload.get("statObject") or "").strip(),
            "businessScopeTags": str(payload.get("businessScopeTags") or payload.get("statScope") or "").strip(),
            "filterCondition": str(payload.get("filterCondition") or "").strip(),
            "specialRule": str(payload.get("specialRule") or "").strip(),
            "ownerDept": owner_dept,
            "ownerName": owner_name,
            "maintainerName": maintainer_name,
            "relatedTables": normalized_tables,
            "relatedIndicators": normalized_indicators,
            "remark": str(payload.get("remark") or "").strip(),
        }

    def _build_report_filters(self, keyword=None, report_type=None, domain=None, status=None, owner_dept=None):
        clauses = [report_asset.c.is_deleted == "N"]
        if report_type:
            clauses.append(report_asset.c.report_type == report_type)
        if domain:
            clauses.append(report_asset.c.domain_name == domain)
        if status:
            clauses.append(report_asset.c.status_code == status)
        if owner_dept:
            clauses.append(report_asset.c.owner_dept_name == owner_dept)
        if keyword:
            query = str(keyword).strip().lower()
            escaped_query = query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            pattern = f"%{escaped_query}%"
            searchable = (
                report_asset.c.report_code,
                report_asset.c.report_name,
                report_asset.c.report_alias,
                report_asset.c.owner_name,
                report_asset.c.owner_dept_name,
                report_asset.c.domain_name,
                report_asset.c.purpose_desc,
            )
            clauses.append(or_(*(
                func.lower(func.coalesce(column, "")).like(pattern, escape="\\")
                for column in searchable
            )))
        return clauses

    def _row_to_item(self, row):
        related_tables = self._normalize_json_array(row.get("related_tables_json"))
        related_indicators = self._normalize_json_array(row.get("related_indicators_json"))
        legacy_period, legacy_date_caliber, legacy_timeliness = self._legacy_time_fields(
            row.get("freq_code"), row.get("time_caliber_desc")
        )
        item = {
            "code": row["report_code"],
            "name": row["report_name"],
            "alias": row.get("report_alias") or "",
            "type": row.get("report_type") or "",
            "domain": row.get("domain_name") or "",
            "freq": row.get("freq_code") or "",
            "statPeriod": row.get("stat_period_code") or legacy_period,
            "statCaliber": row.get("date_caliber_other_desc") or row.get("date_caliber_code") or legacy_date_caliber or row.get("time_caliber_desc") or "",
            "dataDelay": row.get("data_timeliness_custom_desc") or row.get("data_timeliness_code") or legacy_timeliness,
            "legacyFreq": row.get("freq_code") or "",
            "legacyTimeCaliber": row.get("time_caliber_desc") or "",
            "status": row.get("status_code") or "",
            "effectiveDate": row.get("effective_date") or "",
            "expireDate": row.get("expire_date") or "",
            "purpose": row.get("purpose_desc") or "",
            "statObject": row.get("stat_object_desc") or "",
            "businessScopeTags": row.get("stat_scope_desc") or "",
            "filterCondition": row.get("filter_condition_desc") or "",
            "specialRule": row.get("special_rule_desc") or "",
            "ownerDept": row.get("owner_dept_name") or "",
            "ownerName": row.get("owner_name") or "",
            "maintainerName": row.get("maintainer_name") or "",
            "relatedTables": related_tables,
            "relatedIndicators": related_indicators,
            "relatedTableCount": len(related_tables),
            "relatedIndicatorCount": len(related_indicators),
            "remark": row.get("remark_desc") or "",
            "updatedBy": row.get("updated_by") or "",
            "updatedAt": str(row.get("updated_at") or ""),
        }
        # Temporary response aliases keep existing import/export clients and mock data compatible.
        item["dateCaliber"] = item["statCaliber"]
        item["dateCaliberOther"] = ""
        item["dataTimeliness"] = item["dataDelay"]
        item["dataTimelinessCustom"] = ""
        item["statScope"] = item["businessScopeTags"]
        item["timeCaliber"] = row.get("time_caliber_desc") or ""
        return item

    def _db_reports(self, keyword=None, report_type=None, domain=None, status=None, owner_dept=None):
        columns = (
            report_asset.c.report_code,
            report_asset.c.report_name,
            report_asset.c.report_alias,
            report_asset.c.report_type,
            report_asset.c.domain_name,
            report_asset.c.freq_code,
            report_asset.c.stat_period_code,
            report_asset.c.date_caliber_code,
            report_asset.c.date_caliber_other_desc,
            report_asset.c.data_timeliness_code,
            report_asset.c.data_timeliness_custom_desc,
            report_asset.c.status_code,
            report_asset.c.effective_date,
            report_asset.c.expire_date,
            report_asset.c.purpose_desc,
            report_asset.c.stat_object_desc,
            report_asset.c.stat_scope_desc,
            report_asset.c.time_caliber_desc,
            report_asset.c.filter_condition_desc,
            report_asset.c.special_rule_desc,
            report_asset.c.owner_dept_name,
            report_asset.c.owner_name,
            report_asset.c.maintainer_name,
            report_asset.c.related_tables_json,
            report_asset.c.related_indicators_json,
            report_asset.c.remark_desc,
            report_asset.c.updated_by,
            report_asset.c.updated_at,
        )
        statement = select(*columns).where(
            *self._build_report_filters(keyword, report_type, domain, status, owner_dept)
        ).order_by(report_asset.c.report_code)
        return [self._row_to_item(row) for row in self._fetch_rows(statement)]

    def get_reports(self, keyword=None, report_type=None, domain=None, status=None, owner_dept=None):
        return self._db_reports(keyword=keyword, report_type=report_type, domain=domain, status=status, owner_dept=owner_dept)

    def get_report_detail(self, report_code):
        normalized_code = str(report_code or "").strip().upper()
        item = next((current for current in self.get_reports() if current["code"] == normalized_code), None)
        if not item:
            raise ReportNotFoundError(report_code)
        return deepcopy(item)

    def create_report(self, payload):
        with operation_log_service.audit(
            module_name="报表资产",
            operation_type=OPERATION_TYPE_CREATE,
            operation_object=str((payload or {}).get("code") or "") if isinstance(payload, dict) else "",
            operation_desc="新增报表资产",
        ) as audit:
            item = self._create_report(payload)
            audit.operation_object = item["code"]
            audit.after = item
            return item

    def _insert_report(self, item, report_pk):
        return insert(report_asset).values(
            report_pk=report_pk,
            report_code=item["code"],
            report_name=item["name"],
            report_alias=item["alias"],
            report_type=item["type"],
            domain_name=item["domain"],
            freq_code=item["freq"],
            stat_period_code=item["statPeriod"],
            date_caliber_code=item["statCaliber"],
            date_caliber_other_desc="",
            data_timeliness_code=item["dataDelay"],
            data_timeliness_custom_desc="",
            status_code=item["status"],
            effective_date=item["effectiveDate"],
            expire_date=item["expireDate"],
            purpose_desc=item["purpose"],
            stat_object_desc=item["statObject"],
            stat_scope_desc=item["businessScopeTags"],
            time_caliber_desc="",
            filter_condition_desc=item["filterCondition"],
            special_rule_desc=item["specialRule"],
            owner_dept_name=item["ownerDept"],
            owner_name=item["ownerName"],
            maintainer_name=item["maintainerName"],
            related_tables_json=json.dumps(item["relatedTables"], ensure_ascii=False),
            related_indicators_json=json.dumps(item["relatedIndicators"], ensure_ascii=False),
            remark_desc=item["remark"],
            is_deleted="N",
            created_by=self._default_operator,
            updated_by=self._default_operator,
        )

    def _create_report(self, payload):
        item = self._normalize_payload(payload)
        if any(current["code"] == item["code"] for current in self.get_reports()):
            raise ReportAlreadyExistsError(item["code"])
        report_pk = self._next_id(report_asset, report_asset.c.report_pk)
        self._execute([self._insert_report(item, report_pk)])
        return self.get_report_detail(item["code"])

    def update_report(self, report_code, payload):
        with operation_log_service.audit(
            module_name="报表资产",
            operation_type=OPERATION_TYPE_UPDATE,
            operation_object=report_code,
            operation_desc="编辑报表资产",
        ) as audit:
            current, item = self._update_report(report_code, payload)
            audit.operation_object = item["code"]
            audit.before = current
            audit.after = item
            return item

    def _update_report(self, report_code, payload):
        normalized_code = str(report_code or "").strip().upper()
        current = self.get_report_detail(normalized_code)
        item = self._normalize_payload(payload)
        rows = self._fetch_rows(
            select(report_asset.c.report_pk).where(
                and_(report_asset.c.report_code == normalized_code, report_asset.c.is_deleted == "N")
            )
        )
        if not rows:
            raise ReportNotFoundError(report_code)
        if item["code"] != normalized_code and any(current_item["code"] == item["code"] for current_item in self.get_reports()):
            raise ReportAlreadyExistsError(item["code"])
        report_pk = self._row_int(rows, "report_pk")
        self._execute([
            update(report_asset).where(report_asset.c.report_pk == report_pk).values(
                report_code=item["code"],
                report_name=item["name"],
                report_alias=item["alias"],
                report_type=item["type"],
                domain_name=item["domain"],
                freq_code=item["freq"],
                stat_period_code=item["statPeriod"],
                date_caliber_code=item["statCaliber"],
                date_caliber_other_desc="",
                data_timeliness_code=item["dataDelay"],
                data_timeliness_custom_desc="",
                status_code=item["status"],
                effective_date=item["effectiveDate"],
                expire_date=item["expireDate"],
                purpose_desc=item["purpose"],
                stat_object_desc=item["statObject"],
                stat_scope_desc=item["businessScopeTags"],
                time_caliber_desc="",
                filter_condition_desc=item["filterCondition"],
                special_rule_desc=item["specialRule"],
                owner_dept_name=item["ownerDept"],
                owner_name=item["ownerName"],
                maintainer_name=item["maintainerName"],
                related_tables_json=json.dumps(item["relatedTables"], ensure_ascii=False),
                related_indicators_json=json.dumps(item["relatedIndicators"], ensure_ascii=False),
                remark_desc=item["remark"],
                updated_by=self._default_operator,
                updated_at=func.current_timestamp(),
            )
        ])
        return current, self.get_report_detail(item["code"])

    def delete_report(self, report_code):
        with operation_log_service.audit(
            module_name="报表资产",
            operation_type=OPERATION_TYPE_DELETE,
            operation_object=report_code,
            operation_desc="删除报表资产",
        ) as audit:
            audit.before = self._delete_report(report_code)

    def _delete_report(self, report_code):
        normalized_code = str(report_code or "").strip().upper()
        rows = self._fetch_rows(
            select(report_asset.c.report_pk).where(
                and_(report_asset.c.report_code == normalized_code, report_asset.c.is_deleted == "N")
            )
        )
        if not rows:
            raise ReportNotFoundError(report_code)
        current = self.get_report_detail(normalized_code)
        report_pk = self._row_int(rows, "report_pk")
        self._execute([
            update(report_asset).where(report_asset.c.report_pk == report_pk).values(
                is_deleted="Y",
                updated_by=self._default_operator,
                updated_at=func.current_timestamp(),
            )
        ])
        return current


report_service = ReportService()
