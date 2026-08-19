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
from ..db.gaussdb import execute_statements, fetch_all, resolve_db_profile_name
from ..settings import get_default_operator


REPORT_CODE_RE = re.compile(r"^[A-Z][A-Z0-9_-]{2,63}$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TABLE_REPORT_ASSET = "dwp.p_report_asset"
TABLE_ASSET = "dwp.p_asset_table"
TABLE_INDICATOR = "dwp.p_indicator_item"
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

    def _fetch_rows(self, sql):
        try:
            columns, rows = fetch_all(self._db_profile or resolve_db_profile_name(), sql)
        except FileNotFoundError as error:
            raise ReportDataSourceError("数据库配置文件不存在") from error
        except KeyError as error:
            raise ReportDataSourceError("数据库服务暂不可用，请稍后重试") from error
        except RuntimeError as error:
            raise ReportDataSourceError("数据库服务暂不可用，请稍后重试") from error
        except Exception as error:
            raise ReportDataSourceError("数据库查询失败") from error
        return [dict(zip(columns, row)) for row in rows]

    def _execute(self, statements):
        try:
            return execute_statements(self._db_profile or resolve_db_profile_name(), statements)
        except FileNotFoundError as error:
            raise ReportDataSourceError("数据库配置文件不存在") from error
        except KeyError as error:
            raise ReportDataSourceError("数据库服务暂不可用，请稍后重试") from error
        except RuntimeError as error:
            raise ReportDataSourceError("数据库服务暂不可用，请稍后重试") from error
        except Exception as error:
            raise ReportDataSourceError("数据库执行失败") from error

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

    def _allowed_code_values(self, category, fallback):
        try:
            values = {value for value in common_code_service.get_item_values(category) if value}
            return values or set(fallback)
        except (CommonCodeCategoryNotFoundError, CommonCodeDataSourceError):
            return set(fallback)

    def _domain_names(self):
        rows = self._fetch_rows("""
SELECT domain_name FROM dwp.p_asset_domain WHERE is_active = 'Y' ORDER BY display_order, domain_name
""")
        return {str(row.get("domain_name") or "").strip() for row in rows if row.get("domain_name")}

    def _legacy_values(self, column):
        rows = self._fetch_rows(f"SELECT DISTINCT {column} AS value FROM {TABLE_REPORT_ASSET} WHERE is_deleted = 'N'")
        return {str(row.get("value") or "").strip() for row in rows if row.get("value")}

    @staticmethod
    def _legacy_time_fields(freq, time_caliber):
        period_map = {"日报": "日", "日": "日", "每日": "日", "每天": "日", "周报": "周", "周": "周", "每周": "周", "月报": "月", "月": "月", "每月": "月", "季报": "季", "季": "季", "每季": "季", "半年报": "半年", "年报": "年", "年": "年", "每年": "年", "实时": "实时", "不定期": "不定期"}
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
            except json.JSONDecodeError:
                return []
            return payload if isinstance(payload, list) else []
        return []

    def _asset_lookup(self):
        rows = self._fetch_rows(f"""
SELECT
  table_name,
  table_cn_name,
  layer_code,
  domain_code
FROM {TABLE_ASSET}
ORDER BY table_name
""")
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
        rows = self._fetch_rows(f"""
SELECT
  indicator_id,
  indicator_name,
  dimension_code,
  path_desc
FROM {TABLE_INDICATOR}
WHERE is_deleted = 'N'
ORDER BY indicator_id
""")
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

    def _db_reports(self, keyword=None, report_type=None, domain=None, status=None, owner_dept=None):
        where = ["is_deleted = 'N'"]
        if report_type:
            where.append(f"report_type = {self._quote(report_type)}")
        if domain:
            where.append(f"domain_name = {self._quote(domain)}")
        if status:
            where.append(f"status_code = {self._quote(status)}")
        if owner_dept:
            where.append(f"owner_dept_name = {self._quote(owner_dept)}")

        rows = self._fetch_rows(f"""
SELECT
  report_pk,
  report_code,
  report_name,
  report_alias,
  report_type,
  domain_name,
  freq_code,
  stat_period_code,
  date_caliber_code,
  date_caliber_other_desc,
  data_timeliness_code,
  data_timeliness_custom_desc,
  status_code,
  effective_date,
  expire_date,
  purpose_desc,
  stat_object_desc,
  stat_scope_desc,
  time_caliber_desc,
  filter_condition_desc,
  special_rule_desc,
  owner_dept_name,
  owner_name,
  maintainer_name,
  related_tables_json,
  related_indicators_json,
  remark_desc,
  updated_by,
  updated_at
FROM {TABLE_REPORT_ASSET}
WHERE {' AND '.join(where)}
ORDER BY report_code
""")
        items = []
        for row in rows:
            related_tables = self._normalize_json_array(row.get("related_tables_json"))
            related_indicators = self._normalize_json_array(row.get("related_indicators_json"))
            legacy_period, legacy_date_caliber, legacy_timeliness = self._legacy_time_fields(row.get("freq_code"), row.get("time_caliber_desc"))
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
            items.append(item)

        if keyword:
            query = keyword.strip().lower()
            items = [
                item for item in items
                if any(
                    query in str(item[key] or "").lower()
                    for key in ("code", "name", "alias", "ownerName", "ownerDept", "domain", "purpose")
                )
            ]
        return items

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

    def _create_report(self, payload):
        item = self._normalize_payload(payload)
        if any(current["code"] == item["code"] for current in self.get_reports()):
            raise ReportAlreadyExistsError(item["code"])

        report_pk = self._next_id(TABLE_REPORT_ASSET, "report_pk")
        statements = [
            f"""
INSERT INTO {TABLE_REPORT_ASSET} (
  report_pk, report_code, report_name, report_alias, report_type, domain_name, freq_code, stat_period_code, date_caliber_code, date_caliber_other_desc, data_timeliness_code, data_timeliness_custom_desc, status_code,
  effective_date, expire_date, purpose_desc, stat_object_desc, stat_scope_desc, time_caliber_desc,
  filter_condition_desc, special_rule_desc, owner_dept_name, owner_name, maintainer_name,
  related_tables_json, related_indicators_json, remark_desc, created_by, updated_by
) VALUES (
  {report_pk}, {self._quote(item['code'])}, {self._quote(item['name'])}, {self._quote(item['alias'])},
  {self._quote(item['type'])}, {self._quote(item['domain'])}, {self._quote(item['freq'])}, {self._quote(item['statPeriod'])}, {self._quote(item['statCaliber'])}, '', {self._quote(item['dataDelay'])}, '', {self._quote(item['status'])},
  {self._quote(item['effectiveDate'])}, {self._quote(item['expireDate'])}, {self._quote(item['purpose'])},
  {self._quote(item['statObject'])}, {self._quote(item['businessScopeTags'])}, '',
  {self._quote(item['filterCondition'])}, {self._quote(item['specialRule'])}, {self._quote(item['ownerDept'])},
  {self._quote(item['ownerName'])}, {self._quote(item['maintainerName'])},
  {self._quote(json.dumps(item['relatedTables'], ensure_ascii=False))},
  {self._quote(json.dumps(item['relatedIndicators'], ensure_ascii=False))},
  {self._quote(item['remark'])}, {self._quote(self._default_operator)}, {self._quote(self._default_operator)}
)
""".strip(),
        ]
        self._execute(statements)
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
        rows = self._fetch_rows(f"""
SELECT report_pk
FROM {TABLE_REPORT_ASSET}
WHERE report_code = {self._quote(normalized_code)} AND is_deleted = 'N'
""")
        if not rows:
            raise ReportNotFoundError(report_code)
        if item["code"] != normalized_code and any(current_item["code"] == item["code"] for current_item in self.get_reports()):
            raise ReportAlreadyExistsError(item["code"])
        report_pk = int(rows[0]["report_pk"])
        statements = [
            f"""
UPDATE {TABLE_REPORT_ASSET}
SET
  report_code = {self._quote(item['code'])},
  report_name = {self._quote(item['name'])},
  report_alias = {self._quote(item['alias'])},
  report_type = {self._quote(item['type'])},
  domain_name = {self._quote(item['domain'])},
  freq_code = {self._quote(item['freq'])},
  stat_period_code = {self._quote(item['statPeriod'])},
  date_caliber_code = {self._quote(item['statCaliber'])},
  date_caliber_other_desc = '',
  data_timeliness_code = {self._quote(item['dataDelay'])},
  data_timeliness_custom_desc = '',
  status_code = {self._quote(item['status'])},
  effective_date = {self._quote(item['effectiveDate'])},
  expire_date = {self._quote(item['expireDate'])},
  purpose_desc = {self._quote(item['purpose'])},
  stat_object_desc = {self._quote(item['statObject'])},
  stat_scope_desc = {self._quote(item['businessScopeTags'])},
  time_caliber_desc = '',
  filter_condition_desc = {self._quote(item['filterCondition'])},
  special_rule_desc = {self._quote(item['specialRule'])},
  owner_dept_name = {self._quote(item['ownerDept'])},
  owner_name = {self._quote(item['ownerName'])},
  maintainer_name = {self._quote(item['maintainerName'])},
  related_tables_json = {self._quote(json.dumps(item['relatedTables'], ensure_ascii=False))},
  related_indicators_json = {self._quote(json.dumps(item['relatedIndicators'], ensure_ascii=False))},
  remark_desc = {self._quote(item['remark'])},
  updated_by = {self._quote(self._default_operator)},
  updated_at = CURRENT_TIMESTAMP
WHERE report_pk = {report_pk}
""".strip(),
        ]
        self._execute(statements)
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
        rows = self._fetch_rows(f"""
SELECT report_pk
FROM {TABLE_REPORT_ASSET}
WHERE report_code = {self._quote(normalized_code)} AND is_deleted = 'N'
""")
        if not rows:
            raise ReportNotFoundError(report_code)
        current = self.get_report_detail(normalized_code)
        report_pk = int(rows[0]["report_pk"])
        statements = [
            f"""
UPDATE {TABLE_REPORT_ASSET}
SET is_deleted = 'Y', updated_by = {self._quote(self._default_operator)}, updated_at = CURRENT_TIMESTAMP
WHERE report_pk = {report_pk}
""".strip(),
        ]
        self._execute(statements)
        return current


report_service = ReportService()
