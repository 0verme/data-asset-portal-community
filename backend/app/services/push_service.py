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

from sqlalchemy import delete, func, insert, or_, select, update

from ..application import AuditActorMixin, actor_aware
from .common_code_service import (
    CommonCodeCategoryNotFoundError,
    CommonCodeDataSourceError,
    common_code_service,
)
from ..db.facade import database_transaction
from ..db.service import CoreAccess
from ..db.tables import (
    push_change_log,
    push_job,
    push_job_field,
    push_system,
    system_table,
)
from ..settings import get_page_size_limits
from ..utils.service_perf import log_slow_service_call
from .operation_log_service import (
    OPERATION_TYPE_CREATE,
    OPERATION_TYPE_DELETE,
    OPERATION_TYPE_UPDATE,
    operation_log_service,
)


def _payload_id(payload):
    return str((payload or {}).get("id") or "") if isinstance(payload, dict) else ""


ID_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
SYSTEM_ID_PATTERN = re.compile(r"^[A-Za-z0-9_]+$")
TIME_PATTERN = re.compile(r"^(?:[01]\d|2[0-3]):[0-5]\d$")
DEFAULT_SYSTEM_STATUS = {"enabled", "disabled"}
DEFAULT_IMPORTANCE_LEVELS = {"normal", "important"}
DEFAULT_PUSH_PROTOCOLS = {"SFTP", "FTP", "FTPS", "HTTP", "OSS"}
DEFAULT_PUSH_DELIMITERS = {"|", ",", "\\t", ";", "\\u0001"}
DEFAULT_PUSH_ENCODINGS = {"UTF-8", "GBK", "GB2312", "ISO-8859-1"}
DEFAULT_PUSH_FREQ_TYPES = {"T+1", "T+0", "准实时", "每周", "每月"}
DEFAULT_PUSH_DEPTS = set()
DEFAULT_PUSH_AUTH_TYPES = {"密钥认证", "账号密码"}

LOGGER = logging.getLogger(__name__)


class PushSystemNotFoundError(Exception):
    def __init__(self, system_id):
        self.system_id = system_id
        super().__init__(f"未找到下游系统: {system_id}")

    def to_dict(self):
        return {
            "code": "PUSH_SYSTEM_NOT_FOUND",
            "message": f"未找到下游系统: {self.system_id}",
        }


class PushJobNotFoundError(Exception):
    def __init__(self, system_id, job_id):
        self.system_id = system_id
        self.job_id = job_id
        super().__init__(f"未找到推送作业: {system_id}/{job_id}")

    def to_dict(self):
        return {
            "code": "PUSH_JOB_NOT_FOUND",
            "message": f"未找到推送作业: {self.system_id}/{self.job_id}",
        }


class PushSystemAlreadyExistsError(Exception):
    def __init__(self, system_id):
        self.system_id = system_id
        super().__init__(f"下游系统已存在: {system_id}")

    def to_dict(self):
        return {
            "code": "PUSH_SYSTEM_ALREADY_EXISTS",
            "message": f"下游系统已存在: {self.system_id}",
        }


class PushSystemInUseError(Exception):
    def __init__(self, system_id, api_count):
        self.system_id, self.api_count = system_id, api_count
        super().__init__(f"该下游系统仍关联 {api_count} 个 API，无法删除，请先解除关联。")

    def to_dict(self):
        return {"code": "PUSH_SYSTEM_IN_USE", "message": str(self)}


class PushJobAlreadyExistsError(Exception):
    def __init__(self, system_id, job_id):
        self.system_id = system_id
        self.job_id = job_id
        super().__init__(f"推送作业已存在: {system_id}/{job_id}")

    def to_dict(self):
        return {
            "code": "PUSH_JOB_ALREADY_EXISTS",
            "message": f"推送作业已存在: {self.system_id}/{self.job_id}",
        }


class PushValidationError(Exception):
    def __init__(self, details):
        self.details = details
        super().__init__("请求参数校验失败")

    def to_dict(self):
        return {
            "code": "PUSH_VALIDATION_FAILED",
            "message": "请求参数校验失败",
            "details": self.details,
        }


class PushDataSourceError(Exception):
    def __init__(self, message):
        self.message = message
        super().__init__(message)

    def to_dict(self):
        return {
            "code": "PUSH_DATA_SOURCE_ERROR",
            "message": self.message,
        }


class PushService(AuditActorMixin):
    def __init__(self):
        self._db_profile = os.getenv("ASSET_DB_PROFILE", "").strip()
        self._db = CoreAccess(
            profile_getter=lambda: self._db_profile,
            error_factory=PushDataSourceError,
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
                service="PushService",
                method=method,
                purpose=purpose,
                started_at=started_at,
                page=page,
                page_size=page_size,
                keyword=keyword,
            )

    def _execute_statements(self, statements):
        return self._db.execute_statements(statements)

    def _validate_id(self, value, field_name, details, allow_numeric_prefix=False):
        if not isinstance(value, str) or not value.strip():
            details.append({"field": field_name, "message": f"{field_name} 不能为空"})
            return None
        normalized = value.strip()
        pattern = SYSTEM_ID_PATTERN if allow_numeric_prefix else ID_PATTERN
        if not pattern.fullmatch(normalized):
            suffix = "" if allow_numeric_prefix else "，且不能以数字开头"
            details.append(
                {
                    "field": field_name,
                    "message": f"{field_name} 仅支持字母、数字和下划线{suffix}",
                }
            )
            return None
        return normalized

    def _get_allowed_values(self, category_code, fallback):
        try:
            return {value for value in common_code_service.get_item_values(category_code) if value}
        except (CommonCodeCategoryNotFoundError, CommonCodeDataSourceError):
            return set(fallback)

    def _normalize_job_fields(self, fields, details):
        if not isinstance(fields, list) or not fields:
            details.append({"field": "fields", "message": "fields 至少包含 1 个字段"})
            return []

        names = set()
        normalized_fields = []
        for index, field in enumerate(fields):
            prefix = f"fields[{index}]"
            if not isinstance(field, dict):
                details.append({"field": prefix, "message": "字段项必须为对象"})
                continue

            name = self._validate_id(field.get("name"), f"{prefix}.name", details)
            cn = field.get("cn")
            if not isinstance(cn, str) or not cn.strip():
                details.append({"field": f"{prefix}.cn", "message": "字段中文名不能为空"})

            if name:
                if name in names:
                    details.append({"field": f"{prefix}.name", "message": "同一作业内字段名必须唯一"})
                else:
                    names.add(name)

            normalized_fields.append(
                {
                    "name": name or "",
                    "cn": cn.strip() if isinstance(cn, str) else "",
                    "meaning": (field.get("meaning") or "").strip() if isinstance(field.get("meaning"), str) else "",
                    "src": (field.get("src") or "DWM").strip() if isinstance(field.get("src"), str) else "DWM",
                    "type": (field.get("type") or "string").strip() if isinstance(field.get("type"), str) else "string",
                }
            )

        return normalized_fields

    def _normalize_job_payload(self, payload, current_job=None):
        details = []
        if not isinstance(payload, dict):
            raise PushValidationError([{"field": "body", "message": "请求体必须为 JSON 对象"}])

        job_id = self._validate_id(payload.get("id"), "id", details)
        cn = payload.get("cn")
        source_file_name = payload.get("sourceFileName")
        if source_file_name is None:
            source_file_name = payload.get("fileName")
        target_file_name = payload.get("targetFileName")
        if target_file_name is None:
            target_file_name = payload.get("fileName")
        delimiter = (payload.get("delimiter") or "").strip() if isinstance(payload.get("delimiter"), str) else ""
        encoding = (payload.get("encoding") or "").strip() if isinstance(payload.get("encoding"), str) else ""
        freq_type = (payload.get("freqType") or "").strip() if isinstance(payload.get("freqType"), str) else ""
        allowed_delimiters = self._get_allowed_values("PUSH_DELIMITER", DEFAULT_PUSH_DELIMITERS)
        allowed_encodings = self._get_allowed_values("FILE_ENCODING", DEFAULT_PUSH_ENCODINGS)
        allowed_freq_types = self._get_allowed_values("FREQ_TYPE", DEFAULT_PUSH_FREQ_TYPES)
        if not isinstance(cn, str) or not cn.strip():
            details.append({"field": "cn", "message": "作业名称不能为空"})
        if not isinstance(source_file_name, str) or not source_file_name.strip():
            details.append({"field": "sourceFileName", "message": "sourceFileName 不能为空"})

        normalized_source_file_name = source_file_name.strip() if isinstance(source_file_name, str) else ""
        normalized_target_file_name = (
            target_file_name.strip() if isinstance(target_file_name, str) else ""
        ) or normalized_source_file_name
        source_path = payload.get("sourcePath")
        if source_path is None:
            source_path = payload.get("lakePath")
        normalized_source_path = source_path.strip() if isinstance(source_path, str) else ""

        if not normalized_target_file_name:
            details.append({"field": "targetFileName", "message": "目标推送文件名不能为空"})

        if not delimiter:
            details.append({"field": "delimiter", "message": "delimiter 不能为空"})
        elif delimiter not in allowed_delimiters and (current_job or {}).get("delimiter") != delimiter:
            details.append({"field": "delimiter", "message": f"delimiter 不在允许范围内: {delimiter}"})
        if not encoding:
            details.append({"field": "encoding", "message": "encoding 不能为空"})
        elif encoding not in allowed_encodings and (current_job or {}).get("encoding") != encoding:
            details.append({"field": "encoding", "message": f"encoding 不在允许范围内: {encoding}"})
        if not freq_type:
            details.append({"field": "freqType", "message": "freqType 不能为空"})
        elif freq_type not in allowed_freq_types and (current_job or {}).get("freqType") != freq_type:
            details.append({"field": "freqType", "message": f"freqType 不在允许范围内: {freq_type}"})

        enabled = payload.get("enabled")
        if not isinstance(enabled, bool):
            details.append({"field": "enabled", "message": "enabled 必须为布尔值"})

        normalized_fields = self._normalize_job_fields(payload.get("fields"), details)

        if details:
            raise PushValidationError(details)

        return {
            "id": job_id,
            "cn": cn.strip(),
            "sourcePath": normalized_source_path,
            "sourceFileName": normalized_source_file_name,
            "targetPath": (payload.get("targetPath") or "").strip() if isinstance(payload.get("targetPath"), str) else "",
            "targetFileName": normalized_target_file_name,
            "freq": (payload.get("freq") or "").strip() if isinstance(payload.get("freq"), str) else "",
            "freqType": freq_type,
            "delimiter": delimiter,
            "encoding": encoding,
            "rowCnt": (payload.get("rowCnt") or "").strip() if isinstance(payload.get("rowCnt"), str) else "",
            "enabled": enabled,
            "desc": (payload.get("desc") or "").strip() if isinstance(payload.get("desc"), str) else "",
            "fields": normalized_fields,
        }

    def _normalize_system_payload(self, payload, existing_jobs=None, current_system=None):
        details = []
        if not isinstance(payload, dict):
            raise PushValidationError([{"field": "body", "message": "请求体必须为 JSON 对象"}])

        system_id = self._validate_id(payload.get("id"), "id", details, allow_numeric_prefix=True)
        name = payload.get("name")
        abbr = payload.get("abbr")
        host = payload.get("host")
        protocol = payload.get("protocol")
        auth_type = payload.get("auth")
        status = payload.get("status")
        port = payload.get("port")
        importance_level = payload.get(
            "importanceLevel",
            (current_system or {}).get("importanceLevel", "normal"),
        )
        latest_output_time = payload.get(
            "latestOutputTime",
            (current_system or {}).get("latestOutputTime", ""),
        )
        allowed_status = self._get_allowed_values("SYSTEM_STATUS", DEFAULT_SYSTEM_STATUS)
        allowed_protocols = self._get_allowed_values("PUSH_PROTOCOL", DEFAULT_PUSH_PROTOCOLS)
        allowed_auth_types = self._get_allowed_values("PUSH_AUTH_TYPE", DEFAULT_PUSH_AUTH_TYPES)
        allowed_depts = self._get_allowed_values("UPSTREAM_DEPT", DEFAULT_PUSH_DEPTS)
        protocol_error = None
        auth_error = None
        if not isinstance(protocol, str) or not protocol.strip():
            protocol_error = {"field": "protocol", "message": "protocol 不能为空"}
        elif protocol.strip() not in allowed_protocols:
            protocol_error = {"field": "protocol", "message": f"protocol 不在允许范围内: {protocol.strip()}"}
        if not isinstance(auth_type, str) or not auth_type.strip():
            auth_error = {"field": "auth", "message": "auth 不能为空"}
        elif auth_type.strip() not in allowed_auth_types:
            auth_error = {"field": "auth", "message": f"auth 不在允许范围内: {auth_type.strip()}"}

        if not isinstance(name, str) or not name.strip():
            details.append({"field": "name", "message": "系统名称不能为空"})
        if not isinstance(abbr, str) or not abbr.strip():
            details.append({"field": "abbr", "message": "系统简称不能为空"})
        if not isinstance(host, str) or not host.strip():
            details.append({"field": "host", "message": "服务器地址不能为空"})
        if protocol_error:
            details.append(protocol_error)
        if auth_error:
            details.append(auth_error)
        dept = (payload.get("dept") or "").strip() if isinstance(payload.get("dept"), str) else ""
        if dept and dept not in allowed_depts and (current_system or {}).get("dept") != dept:
            details.append({"field": "dept", "message": f"dept 不在允许范围内: {dept}"})
        if not isinstance(port, int):
            details.append({"field": "port", "message": "port 必须为整数"})
        if status not in allowed_status:
            details.append({"field": "status", "message": f"status 不在允许范围内: {status}"})
        if importance_level not in DEFAULT_IMPORTANCE_LEVELS:
            details.append(
                {
                    "field": "importanceLevel",
                    "message": f"importanceLevel 不在允许范围内: {importance_level}",
                }
            )
        if not isinstance(latest_output_time, str):
            details.append({"field": "latestOutputTime", "message": "latestOutputTime 必须为字符串"})
            normalized_latest_output_time = ""
        else:
            normalized_latest_output_time = latest_output_time.strip()
            if (
                importance_level == "important"
                and normalized_latest_output_time
                and not TIME_PATTERN.fullmatch(normalized_latest_output_time)
            ):
                details.append(
                    {
                        "field": "latestOutputTime",
                        "message": "latestOutputTime 必须为 HH:mm 24 小时制",
                    }
                )
        if importance_level == "normal":
            normalized_latest_output_time = ""

        jobs_payload = payload.get("jobs", existing_jobs if existing_jobs is not None else [])
        normalized_jobs = []
        if jobs_payload is None:
            jobs_payload = []
        if not isinstance(jobs_payload, list):
            details.append({"field": "jobs", "message": "jobs 必须为数组"})
        else:
            job_ids = set()
            for index, job in enumerate(jobs_payload):
                try:
                    current_job = None
                    if isinstance(job, dict):
                        current_job = next((item for item in (current_system or {}).get("jobs", []) if item["id"] == job.get("id")), None)
                    normalized_job = self._normalize_job_payload(job, current_job=current_job)
                except PushValidationError as error:
                    for item in error.details:
                        details.append(
                            {
                                "field": f"jobs[{index}].{item['field']}",
                                "message": item["message"],
                            }
                        )
                    continue
                if normalized_job["id"] in job_ids:
                    details.append({"field": f"jobs[{index}].id", "message": "同一系统内作业 ID 必须唯一"})
                else:
                    job_ids.add(normalized_job["id"])
                normalized_jobs.append(normalized_job)

        if details:
            raise PushValidationError(details)

        return {
            "id": system_id,
            "name": name.strip(),
            "abbr": abbr.strip().upper(),
            "desc": (payload.get("desc") or "").strip() if isinstance(payload.get("desc"), str) else "",
            "protocol": (payload.get("protocol") or "").strip() if isinstance(payload.get("protocol"), str) else "",
            "host": host.strip(),
            "port": port,
            "account": (payload.get("account") or "").strip() if isinstance(payload.get("account"), str) else "",
            "auth": (payload.get("auth") or "").strip() if isinstance(payload.get("auth"), str) else "",
            "downstreamContact": (
                payload.get("downstreamContact", payload.get("contact")) or ""
            ).strip() if isinstance(payload.get("downstreamContact", payload.get("contact")), str) else "",
            "dataDeveloperContact": (payload.get("dataDeveloperContact") or "").strip()
            if isinstance(payload.get("dataDeveloperContact"), str) else "",
            "dept": dept,
            "status": status,
            "importanceLevel": importance_level,
            "latestOutputTime": normalized_latest_output_time,
            "jobs": normalized_jobs,
        }

    def _find_system_index(self, systems, system_id):
        for index, system in enumerate(systems):
            if system["id"] == system_id:
                return index
        raise PushSystemNotFoundError(system_id)

    def _find_job_index(self, system, job_id):
        for index, job in enumerate(system["jobs"]):
            if job["id"] == job_id:
                return index
        raise PushJobNotFoundError(system["id"], job_id)

    def _get_next_id(self, table, column):
        return self._db.next_pk(table, column)

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

    def _build_system_where(self, status=None, protocol=None, dept=None, keyword=None):
        where = [push_system.c.is_deleted == "N"]
        if status:
            where.append(push_system.c.status_code == status)
        if protocol:
            where.append(push_system.c.protocol_type == protocol)
        if dept:
            where.append(push_system.c.dept_name == dept)
        normalized_keyword = str(keyword or "").strip().lower()
        if normalized_keyword:
            like = f"%{normalized_keyword}%"
            system_searchable = (
                push_system.c.system_code,
                push_system.c.system_name,
                push_system.c.system_abbr,
                push_system.c.dept_name,
                push_system.c.system_desc,
            )
            job_searchable = (
                push_job.c.job_code,
                push_job.c.job_name,
                push_job.c.source_file_name,
                push_job.c.target_file_name,
                push_job.c.job_desc,
            )
            job_match = select(1).select_from(push_job).where(
                push_job.c.system_id == push_system.c.system_id,
                push_job.c.is_deleted == "N",
                or_(*(func.lower(func.coalesce(column, "")).like(like) for column in job_searchable)),
            ).exists()
            where.append(
                or_(
                    *(func.lower(func.coalesce(column, "")).like(like) for column in system_searchable),
                    job_match,
                )
            )
        return where

    def _load_system_rows(self, status=None, protocol=None, dept=None, keyword=None, page=None, page_size=None):
        paginate = page is not None or page_size is not None
        page, page_size = self._resolve_paging(page=page, page_size=page_size)
        offset = (page - 1) * page_size
        statement = (
            select(
                push_system.c.system_id,
                push_system.c.system_code,
                push_system.c.system_name,
                push_system.c.system_abbr,
                push_system.c.protocol_type,
                push_system.c.host_name,
                push_system.c.port_no,
                push_system.c.account_name,
                push_system.c.auth_type,
                push_system.c.contact_name,
                push_system.c.data_developer_contact_name,
                push_system.c.dept_name,
                push_system.c.system_desc,
                push_system.c.status_code,
                push_system.c.importance_level_code,
                push_system.c.latest_output_time,
                push_system.c.job_count,
                push_system.c.created_at,
                push_system.c.updated_at,
            )
            .where(*self._build_system_where(status=status, protocol=protocol, dept=dept, keyword=keyword))
            .order_by(push_system.c.system_code)
        )
        if paginate:
            statement = statement.limit(page_size).offset(offset)
        return self._fetch_rows_logged(
            statement,
            purpose="push system list",
            method="_load_system_rows",
            page=page,
            page_size=page_size,
            keyword=keyword,
        )

    def _load_job_rows(self, system_ids):
        if not system_ids:
            return {}
        normalized_ids = [int(system_id) for system_id in system_ids]
        statement = (
            select(
                push_job.c.job_id,
                push_job.c.system_id,
                push_job.c.job_code,
                push_job.c.job_name,
                push_job.c.source_path,
                push_job.c.source_file_name,
                push_job.c.target_path,
                push_job.c.target_file_name,
                push_job.c.freq_desc,
                push_job.c.freq_type,
                push_job.c.delimiter_code,
                push_job.c.encoding_type,
                push_job.c.row_count_desc,
                push_job.c.enabled_flag,
                push_job.c.job_desc,
                push_job.c.field_count,
                push_job.c.created_at,
                push_job.c.updated_at,
            )
            .where(
                push_job.c.is_deleted == "N",
                push_job.c.system_id.in_(normalized_ids),
            )
            .order_by(push_job.c.system_id, push_job.c.created_at.desc(), push_job.c.job_code)
        )
        rows = self._fetch_rows_logged(statement, purpose="push job list", method="_load_job_rows")
        grouped = {}
        for row in rows:
            grouped.setdefault(int(row["system_id"]), []).append(row)
        return grouped

    def _load_field_rows(self, job_ids):
        if not job_ids:
            return {}
        normalized_ids = [int(job_id) for job_id in job_ids]
        statement = (
            select(
                push_job_field.c.field_id,
                push_job_field.c.job_id,
                push_job_field.c.field_name,
                push_job_field.c.field_cn_name,
                push_job_field.c.field_order,
                push_job_field.c.source_code,
                push_job_field.c.data_type,
                push_job_field.c.field_meaning,
            )
            .where(
                push_job_field.c.is_deleted == "N",
                push_job_field.c.job_id.in_(normalized_ids),
            )
            .order_by(
                push_job_field.c.job_id,
                push_job_field.c.field_order,
                push_job_field.c.field_name,
            )
        )
        rows = self._fetch_rows_logged(statement, purpose="push job field list", method="_load_field_rows")
        grouped = {}
        for row in rows:
            grouped.setdefault(int(row["job_id"]), []).append(
                {
                    "name": row["field_name"],
                    "cn": row["field_cn_name"] or row["field_name"],
                    "meaning": row.get("field_meaning") or "",
                    "src": row.get("source_code") or "DWM",
                    "type": row.get("data_type") or "string",
                }
            )
        return grouped

    def _to_job(self, row, fields):
        return {
            "id": row["job_code"],
            "cn": row["job_name"],
            "sourcePath": row.get("source_path") or "",
            "sourceFileName": row.get("source_file_name") or row.get("target_file_name") or "",
            "targetPath": row.get("target_path") or "",
            "targetFileName": row.get("target_file_name") or row.get("source_file_name") or "",
            "freq": row.get("freq_desc") or "",
            "freqType": row.get("freq_type") or "",
            "delimiter": row.get("delimiter_code") or "",
            "encoding": row.get("encoding_type") or "",
            "rowCnt": row.get("row_count_desc") or "",
            "enabled": str(row.get("enabled_flag") or "").upper() == "Y",
            "desc": row.get("job_desc") or "",
            "fields": deepcopy(fields),
        }

    def _to_system(self, row, jobs):
        return {
            "systemId": int(row["system_id"]) if row.get("system_id") is not None else None,
            "id": row["system_code"],
            "name": row["system_name"],
            "abbr": row["system_abbr"],
            "desc": row.get("system_desc") or "",
            "protocol": row["protocol_type"],
            "host": row["host_name"],
            "port": int(row["port_no"]),
            "account": row.get("account_name") or "",
            "auth": row.get("auth_type") or "",
            "downstreamContact": row.get("contact_name") or "",
            "dataDeveloperContact": row.get("data_developer_contact_name") or "",
            "dept": row.get("dept_name") or "",
            "status": row["status_code"],
            "importanceLevel": row.get("importance_level_code") or "normal",
            "latestOutputTime": row.get("latest_output_time") or "",
            "jobs": deepcopy(jobs),
        }

    def _to_public_job(self, row):
        return {
            "id": row["job_code"],
            "cn": row["job_name"],
            "sourcePath": row.get("source_path") or "",
            "sourceFileName": row.get("source_file_name") or row.get("target_file_name") or "",
            "targetPath": row.get("target_path") or "",
            "targetFileName": row.get("target_file_name") or row.get("source_file_name") or "",
            "freq": row.get("freq_desc") or "",
            "freqType": row.get("freq_type") or "",
            "enabled": str(row.get("enabled_flag") or "").upper() == "Y",
            "desc": row.get("job_desc") or "",
        }

    def _to_public_system(self, row, jobs):
        return {
            "systemId": int(row["system_id"]) if row.get("system_id") is not None else None,
            "id": row["system_code"],
            "name": row["system_name"],
            "abbr": row["system_abbr"],
            "desc": row.get("system_desc") or "",
            "protocol": row["protocol_type"],
            "host": row.get("host_name") or "",
            "downstreamContact": row.get("contact_name") or "",
            "dataDeveloperContact": row.get("data_developer_contact_name") or "",
            "dept": row.get("dept_name") or "",
            "status": row["status_code"],
            "importanceLevel": row.get("importance_level_code") or "normal",
            "latestOutputTime": row.get("latest_output_time") or "",
            "jobs": [self._to_public_job(job) for job in jobs],
        }

    def _load_public_job_rows(self, system_ids):
        if not system_ids:
            return {}
        normalized_ids = [int(system_id) for system_id in system_ids]
        statement = (
            select(
                push_job.c.job_id,
                push_job.c.system_id,
                push_job.c.job_code,
                push_job.c.job_name,
                push_job.c.source_path,
                push_job.c.source_file_name,
                push_job.c.target_path,
                push_job.c.target_file_name,
                push_job.c.freq_desc,
                push_job.c.freq_type,
                push_job.c.enabled_flag,
                push_job.c.job_desc,
            )
            .where(
                push_job.c.is_deleted == "N",
                push_job.c.system_id.in_(normalized_ids),
            )
            .order_by(push_job.c.system_id, push_job.c.created_at.desc(), push_job.c.job_code)
        )
        rows = self._fetch_rows_logged(
            statement,
            purpose="public push job list",
            method="_load_public_job_rows",
        )
        grouped = {}
        for row in rows:
            grouped.setdefault(int(row["system_id"]), []).append(row)
        return grouped

    def _load_public_system_rows(self, status=None, protocol=None, dept=None, keyword=None, page=None, page_size=None):
        paginate = page is not None or page_size is not None
        page, page_size = self._resolve_paging(page=page, page_size=page_size)
        offset = (page - 1) * page_size
        statement = (
            select(
                push_system.c.system_id,
                push_system.c.system_code,
                push_system.c.system_name,
                push_system.c.system_abbr,
                push_system.c.protocol_type,
                push_system.c.host_name,
                push_system.c.contact_name,
                push_system.c.data_developer_contact_name,
                push_system.c.dept_name,
                push_system.c.system_desc,
                push_system.c.status_code,
                push_system.c.importance_level_code,
                push_system.c.latest_output_time,
            )
            .where(*self._build_system_where(status=status, protocol=protocol, dept=dept, keyword=keyword))
            .order_by(push_system.c.system_code)
        )
        if paginate:
            statement = statement.limit(page_size).offset(offset)
        return self._fetch_rows_logged(
            statement,
            purpose="public push system list",
            method="_load_public_system_rows",
            page=page,
            page_size=page_size,
            keyword=keyword,
        )

    def _load_public_systems(self, **filters):
        rows = self._load_public_system_rows(**filters)
        jobs_by_system = self._load_public_job_rows([row["system_id"] for row in rows])
        return [self._to_public_system(row, jobs_by_system.get(int(row["system_id"]), [])) for row in rows]

    def _load_db_systems(self, status=None, protocol=None, dept=None, keyword=None, page=None, page_size=None):
        system_rows = self._load_system_rows(
            status=status,
            protocol=protocol,
            dept=dept,
            keyword=keyword,
            page=page,
            page_size=page_size,
        )
        jobs_by_system = self._load_job_rows([row["system_id"] for row in system_rows])
        job_rows = [job for jobs in jobs_by_system.values() for job in jobs]
        fields_by_job = self._load_field_rows([row["job_id"] for row in job_rows])

        systems = []
        for row in system_rows:
            jobs = [
                self._to_job(job_row, fields_by_job.get(int(job_row["job_id"]), []))
                for job_row in jobs_by_system.get(int(row["system_id"]), [])
            ]
            systems.append(self._to_system(row, jobs))
        return systems

    def _get_db_system_detail_row(self, system_code):
        statement = (
            select(
                push_system.c.system_id,
                push_system.c.master_system_id,
                push_system.c.system_code,
                push_system.c.system_name,
                push_system.c.system_abbr,
                push_system.c.protocol_type,
                push_system.c.host_name,
                push_system.c.port_no,
                push_system.c.account_name,
                push_system.c.auth_type,
                push_system.c.contact_name,
                push_system.c.data_developer_contact_name,
                push_system.c.dept_name,
                push_system.c.system_desc,
                push_system.c.status_code,
                push_system.c.importance_level_code,
                push_system.c.latest_output_time,
                push_system.c.job_count,
                push_system.c.created_at,
                push_system.c.updated_at,
            )
            .where(
                push_system.c.is_deleted == "N",
                push_system.c.system_code == system_code,
            )
            .limit(1)
        )
        rows = self._fetch_rows_logged(
            statement,
            purpose="push system detail row",
            method="_get_db_system_detail_row",
        )
        if not rows:
            raise PushSystemNotFoundError(system_code)
        return rows[0]

    def _get_db_system_detail(self, system_code):
        row = self._get_db_system_detail_row(system_code)
        jobs_by_system = self._load_job_rows([row["system_id"]])
        job_rows = jobs_by_system.get(int(row["system_id"]), [])
        fields_by_job = self._load_field_rows([job["job_id"] for job in job_rows])
        jobs = [self._to_job(job_row, fields_by_job.get(int(job_row["job_id"]), [])) for job_row in job_rows]
        return self._to_system(row, jobs)

    def _get_public_system_detail(self, system_code):
        systems = self._load_public_systems(keyword=None)
        system = next((item for item in systems if item["id"] == system_code), None)
        if not system:
            raise PushSystemNotFoundError(system_code)
        return system

    def _get_db_job_row(self, system_id, job_code):
        job_rows = self._load_job_rows([system_id]).get(int(system_id), [])
        row = next((item for item in job_rows if item["job_code"] == job_code), None)
        if not row:
            system_row = self._get_db_system_detail_row(self._get_system_code_by_id(system_id))
            raise PushJobNotFoundError(system_row["system_code"], job_code)
        return row

    def _get_system_code_by_id(self, system_id):
        statement = select(push_system.c.system_code).where(
            push_system.c.system_id == int(system_id),
            push_system.c.is_deleted == "N",
        )
        rows = self._fetch_rows(statement)
        if not rows:
            raise PushSystemNotFoundError(str(system_id))
        return rows[0]["system_code"]

    def _ensure_db_system_absent(self, system_code, exclude_system_id=None):
        statement = (
            select(push_system.c.system_id)
            .where(
                push_system.c.is_deleted == "N",
                push_system.c.system_code == system_code,
            )
            .limit(1)
        )
        rows = self._fetch_rows_logged(
            statement,
            purpose="push system uniqueness check",
            method="_ensure_db_system_absent",
        )
        if not rows:
            return
        if exclude_system_id is not None and int(rows[0]["system_id"]) == int(exclude_system_id):
            return
        raise PushSystemAlreadyExistsError(system_code)

    def _ensure_db_job_absent(self, system_id, job_code, system_code, exclude_job_id=None):
        rows = self._load_job_rows([system_id]).get(int(system_id), [])
        for row in rows:
            if row["job_code"] != job_code:
                continue
            if exclude_job_id is not None and int(row["job_id"]) == int(exclude_job_id):
                continue
            raise PushJobAlreadyExistsError(system_code, job_code)

    def _insert_db_job_fields(self, job_id, fields):
        field_id = self._get_next_id(push_job_field, push_job_field.c.field_id)
        statements = []
        for index, field in enumerate(fields, start=1):
            statements.append(
                insert(push_job_field).values(
                    field_id=field_id,
                    job_id=int(job_id),
                    field_name=field["name"],
                    field_cn_name=field["cn"],
                    field_order=index,
                    source_code=field.get("src"),
                    data_type=field["type"],
                    field_meaning=field.get("meaning"),
                    created_by=self._default_operator,
                    updated_by=self._default_operator,
                )
            )
            field_id += 1
        return statements

    def _insert_db_jobs(self, system_id, jobs):
        if not jobs:
            return []
        job_id = self._get_next_id(push_job, push_job.c.job_id)
        statements = []
        for job in jobs:
            current_job_id = job_id
            statements.append(
                insert(push_job).values(
                    job_id=current_job_id,
                    system_id=int(system_id),
                    job_code=job["id"],
                    job_name=job["cn"],
                    source_path=job["sourcePath"],
                    source_file_name=job["sourceFileName"],
                    target_path=job["targetPath"],
                    target_file_name=job["targetFileName"],
                    freq_desc=job["freq"],
                    freq_type=job["freqType"],
                    delimiter_code=job["delimiter"],
                    encoding_type=job["encoding"],
                    row_count_desc=job["rowCnt"],
                    enabled_flag="Y" if job["enabled"] else "N",
                    job_desc=job["desc"],
                    field_count=len(job["fields"]),
                    created_by=self._default_operator,
                    updated_by=self._default_operator,
                )
            )
            statements.extend(self._insert_db_job_fields(current_job_id, job["fields"]))
            job_id += 1
        return statements

    def _insert_change_log(self, system_id, job_id, object_type, object_code, change_type, summary, before_data, after_data):
        change_id = self._get_next_id(push_change_log, push_change_log.c.change_id)
        before_json = json.dumps(before_data, ensure_ascii=False) if before_data is not None else None
        after_json = json.dumps(after_data, ensure_ascii=False) if after_data is not None else None
        return insert(push_change_log).values(
            change_id=change_id,
            system_id=system_id,
            job_id=job_id,
            object_type=object_type,
            object_code=object_code,
            change_type=change_type,
            change_summary=summary,
            before_json=before_json,
            after_json=after_json,
            operator_name=self._default_operator,
        )

    def _refresh_system_job_count_statement(self, system_id):
        job_count = (
            select(func.count())
            .select_from(push_job)
            .where(
                push_job.c.system_id == int(system_id),
                push_job.c.is_deleted == "N",
            )
            .scalar_subquery()
        )
        return (
            update(push_system)
            .where(push_system.c.system_id == int(system_id))
            .values(
                job_count=job_count,
                updated_by=self._default_operator,
                updated_at=func.current_timestamp(),
            )
        )

    def _delete_db_jobs_statements(self, system_id):
        job_rows = self._load_job_rows([system_id]).get(int(system_id), [])
        if not job_rows:
            return []
        job_ids = [int(row["job_id"]) for row in job_rows]
        return [
            delete(push_job_field).where(push_job_field.c.job_id.in_(job_ids)),
            delete(push_job).where(push_job.c.system_id == int(system_id)),
        ]

    def get_push_systems(self, status=None, protocol=None, dept=None, keyword=None, page=None, page_size=None):
        with database_transaction():
            return self._load_public_systems(
                status=status,
                protocol=protocol,
                dept=dept,
                keyword=keyword,
                page=page,
                page_size=page_size,
            )

    def get_push_system_detail(self, system_id):
        with database_transaction():
            return self._get_public_system_detail(system_id)

    def get_push_system_admin_detail(self, system_id):
        with database_transaction():
            return self._get_db_system_detail(system_id)

    @actor_aware
    def create_push_system(self, payload):
        with operation_log_service.audit(
            module_name="下游推送",
            operation_type=OPERATION_TYPE_CREATE,
            operation_object=_payload_id(payload),
            operation_desc="新增下游系统",
        ) as audit:
            result, after_data = self._create_push_system(payload)
            audit.operation_object = after_data["id"]
            audit.after = after_data
            return result

    def _create_push_system(self, payload):
        system = self._normalize_system_payload(payload)
        self._ensure_db_system_absent(system["id"])
        system_id = self._get_next_id(push_system, push_system.c.system_id)
        master_system_id = self._get_next_id(system_table, system_table.c.system_id)
        after_data = deepcopy(system)

        statements = [
            insert(system_table).values(
                system_id=master_system_id,
                system_code=system["id"],
                system_name=system["name"],
                system_abbr=system["abbr"],
                description_text=system["desc"],
                system_type="downstream",
                department_name=system["dept"],
                status_code=system["status"],
                created_by=self._default_operator,
                updated_by=self._default_operator,
            ),
            insert(push_system).values(
                system_id=system_id,
                master_system_id=master_system_id,
                system_code=system["id"],
                system_name=system["name"],
                system_abbr=system["abbr"],
                protocol_type=system["protocol"],
                host_name=system["host"],
                port_no=int(system["port"]),
                account_name=system["account"],
                auth_type=system["auth"],
                contact_name=system["downstreamContact"],
                data_developer_contact_name=system["dataDeveloperContact"],
                dept_name=system["dept"],
                system_desc=system["desc"],
                status_code=system["status"],
                importance_level_code=system["importanceLevel"],
                latest_output_time=system["latestOutputTime"] or None,
                job_count=len(system["jobs"]),
                created_by=self._default_operator,
                updated_by=self._default_operator,
            ),
            *self._insert_db_jobs(system_id, system["jobs"]),
            self._insert_change_log(
                system_id,
                None,
                "SYSTEM",
                system["id"],
                "CREATE_SYSTEM",
                "创建下游系统",
                None,
                after_data,
            ),
        ]
        self._execute_statements(statements)
        return self._get_public_system_detail(system["id"]), after_data

    @actor_aware
    def update_push_system(self, system_id, payload):
        with operation_log_service.audit(
            module_name="下游推送",
            operation_type=OPERATION_TYPE_UPDATE,
            operation_object=system_id,
            operation_desc="编辑下游系统",
        ) as audit:
            result, current, after_data = self._update_push_system(system_id, payload)
            audit.operation_object = after_data["id"]
            audit.before = current
            audit.after = after_data
            return result

    def _update_push_system(self, system_id, payload):
        current = self._get_db_system_detail(system_id)
        current_row = self._get_db_system_detail_row(system_id)
        system = self._normalize_system_payload(payload, existing_jobs=current.get("jobs", []), current_system=current)
        self._ensure_db_system_absent(system["id"], exclude_system_id=current_row["system_id"])
        system_pk = int(current_row["system_id"])
        master_system_id = int(current_row["master_system_id"])
        after_data = deepcopy(system)

        statements = [
            update(system_table)
            .where(system_table.c.system_id == master_system_id)
            .values(
                system_code=system["id"],
                system_name=system["name"],
                system_abbr=system["abbr"],
                description_text=system["desc"],
                department_name=system["dept"],
                status_code=system["status"],
                updated_by=self._default_operator,
                updated_at=func.current_timestamp(),
            ),
            update(push_system)
            .where(push_system.c.system_id == system_pk)
            .values(
                system_code=system["id"],
                system_name=system["name"],
                system_abbr=system["abbr"],
                protocol_type=system["protocol"],
                host_name=system["host"],
                port_no=int(system["port"]),
                account_name=system["account"],
                auth_type=system["auth"],
                contact_name=system["downstreamContact"],
                data_developer_contact_name=system["dataDeveloperContact"],
                dept_name=system["dept"],
                system_desc=system["desc"],
                status_code=system["status"],
                importance_level_code=system["importanceLevel"],
                latest_output_time=system["latestOutputTime"] or None,
                job_count=len(system["jobs"]),
                updated_by=self._default_operator,
                updated_at=func.current_timestamp(),
            ),
            *self._delete_db_jobs_statements(system_pk),
            *self._insert_db_jobs(system_pk, system["jobs"]),
            self._insert_change_log(
                system_pk,
                None,
                "SYSTEM",
                system["id"],
                "UPDATE_SYSTEM",
                "更新下游系统",
                current,
                after_data,
            ),
        ]
        self._execute_statements(statements)
        return self._get_public_system_detail(system["id"]), current, after_data

    @actor_aware
    def delete_push_system(self, system_id):
        with operation_log_service.audit(
            module_name="下游推送",
            operation_type=OPERATION_TYPE_DELETE,
            operation_object=system_id,
            operation_desc="删除下游系统",
        ) as audit:
            current = self._delete_push_system(system_id)
            audit.operation_object = current["id"]
            audit.before = current

    def _delete_push_system(self, system_id):
        current = self._get_db_system_detail(system_id)
        current_row = self._get_db_system_detail_row(system_id)
        system_pk = int(current_row["system_id"])
        statements = [
            self._insert_change_log(
                system_pk,
                None,
                "SYSTEM",
                current["id"],
                "DELETE_SYSTEM",
                "删除下游系统",
                current,
                None,
            ),
            *self._delete_db_jobs_statements(system_pk),
            delete(push_system).where(push_system.c.system_id == system_pk),
        ]
        self._execute_statements(statements)
        return current

    @actor_aware
    def create_push_job(self, system_id, payload):
        with operation_log_service.audit(
            module_name="下游推送",
            operation_type=OPERATION_TYPE_CREATE,
            operation_object=f"{system_id} / {_payload_id(payload)}",
            operation_desc="新增推送作业",
        ) as audit:
            result, after_data = self._create_push_job(system_id, payload)
            audit.operation_object = f"{system_id} / {after_data['id']}"
            audit.after = after_data
            return result

    def _create_push_job(self, system_id, payload):
        system_row = self._get_db_system_detail_row(system_id)
        job = self._normalize_job_payload(payload)
        system_pk = int(system_row["system_id"])
        self._ensure_db_job_absent(system_pk, job["id"], system_id)
        job_pk = self._get_next_id(push_job, push_job.c.job_id)
        after_data = deepcopy(job)

        statements = [
            insert(push_job).values(
                job_id=job_pk,
                system_id=system_pk,
                job_code=job["id"],
                job_name=job["cn"],
                source_path=job["sourcePath"],
                source_file_name=job["sourceFileName"],
                target_path=job["targetPath"],
                target_file_name=job["targetFileName"],
                freq_desc=job["freq"],
                freq_type=job["freqType"],
                delimiter_code=job["delimiter"],
                encoding_type=job["encoding"],
                row_count_desc=job["rowCnt"],
                enabled_flag="Y" if job["enabled"] else "N",
                job_desc=job["desc"],
                field_count=len(job["fields"]),
                created_by=self._default_operator,
                updated_by=self._default_operator,
            ),
            *self._insert_db_job_fields(job_pk, job["fields"]),
            self._refresh_system_job_count_statement(system_pk),
            self._insert_change_log(
                system_pk,
                job_pk,
                "JOB",
                job["id"],
                "CREATE_JOB",
                "创建推送作业",
                None,
                after_data,
            ),
        ]
        self._execute_statements(statements)
        return self._get_public_system_detail(system_id)["jobs"][0], after_data

    @actor_aware
    def update_push_job(self, system_id, job_id, payload):
        with operation_log_service.audit(
            module_name="下游推送",
            operation_type=OPERATION_TYPE_UPDATE,
            operation_object=f"{system_id} / {job_id}",
            operation_desc="编辑推送作业",
        ) as audit:
            result, current_job, after_data = self._update_push_job(system_id, job_id, payload)
            audit.operation_object = f"{system_id} / {after_data['id']}"
            audit.before = current_job
            audit.after = after_data
            return result

    def _update_push_job(self, system_id, job_id, payload):
        current_system = self._get_db_system_detail(system_id)
        current_job = next((item for item in current_system["jobs"] if item["id"] == job_id), None)
        if not current_job:
            raise PushJobNotFoundError(system_id, job_id)

        system_row = self._get_db_system_detail_row(system_id)
        system_pk = int(system_row["system_id"])
        job_row = self._get_db_job_row(system_pk, job_id)
        job = self._normalize_job_payload(payload, current_job=current_job)
        self._ensure_db_job_absent(system_pk, job["id"], system_id, exclude_job_id=job_row["job_id"])
        after_data = deepcopy(job)
        job_pk = int(job_row["job_id"])

        statements = [
            update(push_job)
            .where(push_job.c.job_id == job_pk)
            .values(
                job_code=job["id"],
                job_name=job["cn"],
                source_path=job["sourcePath"],
                source_file_name=job["sourceFileName"],
                target_path=job["targetPath"],
                target_file_name=job["targetFileName"],
                freq_desc=job["freq"],
                freq_type=job["freqType"],
                delimiter_code=job["delimiter"],
                encoding_type=job["encoding"],
                row_count_desc=job["rowCnt"],
                enabled_flag="Y" if job["enabled"] else "N",
                job_desc=job["desc"],
                field_count=len(job["fields"]),
                updated_by=self._default_operator,
                updated_at=func.current_timestamp(),
            ),
            delete(push_job_field).where(push_job_field.c.job_id == job_pk),
            *self._insert_db_job_fields(job_pk, job["fields"]),
            self._refresh_system_job_count_statement(system_pk),
            self._insert_change_log(
                system_pk,
                job_pk,
                "JOB",
                job["id"],
                "UPDATE_JOB",
                "更新推送作业",
                current_job,
                after_data,
            ),
        ]
        self._execute_statements(statements)
        next_system = self._get_public_system_detail(system_id)
        next_job = next((item for item in next_system["jobs"] if item["id"] == job["id"]), None)
        if not next_job:
            raise PushJobNotFoundError(system_id, job["id"])
        return next_job, current_job, after_data

    @actor_aware
    def delete_push_job(self, system_id, job_id):
        with operation_log_service.audit(
            module_name="下游推送",
            operation_type=OPERATION_TYPE_DELETE,
            operation_object=f"{system_id} / {job_id}",
            operation_desc="删除推送作业",
        ) as audit:
            audit.before = self._delete_push_job(system_id, job_id)

    def _delete_push_job(self, system_id, job_id):
        current_system = self._get_db_system_detail(system_id)
        current_job = next((item for item in current_system["jobs"] if item["id"] == job_id), None)
        if not current_job:
            raise PushJobNotFoundError(system_id, job_id)

        system_row = self._get_db_system_detail_row(system_id)
        system_pk = int(system_row["system_id"])
        job_row = self._get_db_job_row(system_pk, job_id)
        job_pk = int(job_row["job_id"])

        statements = [
            self._insert_change_log(
                system_pk,
                job_pk,
                "JOB",
                job_id,
                "DELETE_JOB",
                "删除推送作业",
                current_job,
                None,
            ),
            delete(push_job_field).where(push_job_field.c.job_id == job_pk),
            delete(push_job).where(push_job.c.job_id == job_pk),
            self._refresh_system_job_count_statement(system_pk),
        ]
        self._execute_statements(statements)
        return current_job


push_service = PushService()
