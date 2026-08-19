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
from contextlib import contextmanager
from datetime import datetime

from flask import g, has_request_context, request

from ..auth import get_session_user
from ..db.gaussdb import (
    _commit_if_needed,
    _rollback_if_needed,
    active_transaction_connection,
    connect_with_profile,
    database_transaction,
    execute_sql,
    fetch_all,
    resolve_db_profile_name,
)
from ..settings import get_page_size_limits, get_trust_proxy_headers


logger = logging.getLogger(__name__)

TABLE_OPERATION_LOG = "dwp.p_operation_log"
OPERATION_TYPE_CREATE = "新增"
OPERATION_TYPE_UPDATE = "编辑"
OPERATION_TYPE_DELETE = "删除"
OPERATION_TYPE_ENABLE = "启用"
OPERATION_TYPE_DISABLE = "禁用"
OPERATION_TYPE_IMPORT = "导入"
OPERATION_TYPE_LOGIN = "登录"
OPERATION_TYPE_LOGOUT = "退出"
OPERATION_TYPE_RESET_PASSWORD = "重置密码"
REQUEST_START_KEY = "_audit_request_start"
RESULT_STATUSES = {"success", "failure"}

COLUMN_MAP = {
    "id": "id", "user_id": "userId", "user_name": "userName", "dept_name": "deptName",
    "module_name": "moduleName", "operation_type": "operationType",
    "operation_object": "operationObject", "operation_desc": "operationDesc",
    "request_method": "requestMethod", "request_url": "requestUrl",
    "request_params": "requestParams", "result_status": "resultStatus",
    "error_message": "errorMessage", "ip_address": "ipAddress", "user_agent": "userAgent",
    "cost_time_ms": "costTimeMs", "remark": "remark", "created_at": "createdAt",
}
SENSITIVE_FIELD_NAMES = {
    "password", "passwordhash", "token", "secret", "cookie", "authorization", "jdbcurl", "connectionstring",
}
REDACTED_VALUE = "[REDACTED]"


class OperationLogError(Exception):
    code = "OPERATION_LOG_ERROR"

    def __init__(self, message: str, details=None):
        self.message = message
        self.details = details
        super().__init__(message)

    def to_dict(self):
        data = {"code": self.code, "message": self.message}
        if self.details is not None:
            data["details"] = self.details
        return data


class OperationLogValidationError(OperationLogError):
    code = "OPERATION_LOG_VALIDATION_FAILED"


class OperationLogDataSourceError(OperationLogError):
    code = "OPERATION_LOG_DATA_SOURCE_ERROR"


class OperationLogNotFoundError(OperationLogError):
    code = "OPERATION_LOG_NOT_FOUND"


class AuditLogError(RuntimeError):
    """A required audit event could not be persisted."""

    def __init__(self, message: str = "Unable to persist required audit log."):
        super().__init__(message)


class OperationLogService:
    def __init__(self):
        self._db_profile = os.getenv("ASSET_DB_PROFILE", "").strip()

    def _profile(self):
        return self._db_profile or resolve_db_profile_name()

    def _quote(self, value):
        if value is None:
            return "NULL"
        return "'" + str(value).replace("'", "''") + "'"

    def _fetch_rows(self, sql: str):
        try:
            columns, rows = fetch_all(self._profile(), sql)
        except FileNotFoundError as error:
            raise OperationLogDataSourceError("Database config file not found") from error
        except (KeyError, RuntimeError) as error:
            raise OperationLogDataSourceError("数据库服务暂不可用，请稍后重试") from error
        except Exception as error:
            raise OperationLogDataSourceError("Database query failed") from error
        return [dict(zip(columns, row)) for row in rows]

    def _execute(self, sql: str):
        try:
            return execute_sql(self._profile(), sql)
        except FileNotFoundError as error:
            raise OperationLogDataSourceError("Database config file not found") from error
        except (KeyError, RuntimeError) as error:
            raise OperationLogDataSourceError("数据库服务暂不可用，请稍后重试") from error
        except Exception as error:
            raise OperationLogDataSourceError("Database execution failed") from error

    def _row_to_log(self, row: dict) -> dict:
        normalized = {column.lower(): value for column, value in row.items()}
        log = {}
        for column, field in COLUMN_MAP.items():
            value = normalized.get(column)
            if isinstance(value, datetime):
                value = value.strftime("%Y-%m-%d %H:%M:%S")
            if field == "costTimeMs":
                value = int(value) if value is not None else 0
            log[field] = value if value is not None else ("" if field != "id" else value)
        return log

    def _build_where(self, filters: dict) -> str:
        clauses = []
        keyword = str(filters.get("keyword") or "").strip()
        module = str(filters.get("module") or "").strip()
        operation_type = str(filters.get("operationType") or "").strip()
        result = str(filters.get("result") or "").strip().lower()
        start_time = str(filters.get("startTime") or "").strip()
        end_time = str(filters.get("endTime") or "").strip()
        if keyword:
            like = self._quote(f"%{keyword}%")
            clauses.append("(user_name LIKE {0} OR module_name LIKE {0} OR operation_object LIKE {0} OR operation_desc LIKE {0})".format(like))
        if module:
            clauses.append(f"module_name = {self._quote(module)}")
        if operation_type:
            clauses.append(f"operation_type = {self._quote(operation_type)}")
        if result in RESULT_STATUSES:
            clauses.append(f"result_status = {self._quote(result)}")
        if start_time:
            clauses.append(f"created_at >= {self._quote(start_time)}")
        if end_time:
            clauses.append(f"created_at <= {self._quote(end_time)}")
        return " WHERE " + " AND ".join(clauses) if clauses else ""

    def _resolve_paging(self, filters: dict):
        default_page_size, max_page_size = get_page_size_limits(20)
        try:
            page = int(filters.get("page") or 1)
        except (TypeError, ValueError):
            page = 1
        try:
            page_size = int(filters.get("pageSize") or default_page_size)
        except (TypeError, ValueError):
            page_size = default_page_size
        return max(1, page), max(1, min(max_page_size, page_size))

    def get_logs(self, filters: dict | None = None) -> dict:
        filters = filters or {}
        where = self._build_where(filters)
        page, page_size = self._resolve_paging(filters)
        with database_transaction():
            count_rows = self._fetch_rows(f"SELECT COUNT(*) AS total FROM {TABLE_OPERATION_LOG}{where}")
            rows = self._fetch_rows(
                f"SELECT * FROM {TABLE_OPERATION_LOG}{where} ORDER BY created_at DESC, id DESC "
                f"LIMIT {page_size} OFFSET {(page - 1) * page_size}"
            )
        return {"items": [self._row_to_log(row) for row in rows], "total": int(count_rows[0]["total"]) if count_rows else 0}

    def get_log_detail(self, log_id) -> dict:
        value = str(log_id or "").strip()
        if not value.isdigit():
            raise OperationLogNotFoundError(f"Operation log not found: {log_id}")
        rows = self._fetch_rows(f"SELECT * FROM {TABLE_OPERATION_LOG} WHERE id = {int(value)}")
        if not rows:
            raise OperationLogNotFoundError(f"Operation log not found: {log_id}")
        return self._row_to_log(rows[0])

    @staticmethod
    def _is_sensitive_field(name) -> bool:
        return "".join(char for char in str(name).lower() if char.isalnum()) in SENSITIVE_FIELD_NAMES

    def _sanitize_audit_value(self, value):
        if isinstance(value, dict):
            return {key: REDACTED_VALUE if self._is_sensitive_field(key) else self._sanitize_audit_value(item) for key, item in value.items()}
        if isinstance(value, (list, tuple)):
            return [self._sanitize_audit_value(item) for item in value]
        return value

    def _serialize_snapshot(self, before, after) -> str | None:
        if before is None and after is None:
            return None
        payload = {}
        if before is not None:
            payload["before"] = self._sanitize_audit_value(before)
        if after is not None:
            payload["after"] = self._sanitize_audit_value(after)
        try:
            return json.dumps(payload, ensure_ascii=False, default=str)
        except (TypeError, ValueError):
            return None

    def _request_context(self) -> dict:
        ctx = {"userId": "", "userName": "", "deptName": "", "requestMethod": "", "requestUrl": "", "ipAddress": "", "userAgent": ""}
        if not has_request_context():
            return ctx
        ctx["requestMethod"] = (request.method or "")[:16]
        ctx["requestUrl"] = (request.path or "")[:512]
        # Only honour a client-supplied X-Forwarded-For when the deployment has
        # explicitly opted in via ASSET_TRUST_PROXY_HEADERS. By default the
        # header is ignored so a direct client cannot forge the audit IP.
        forwarded = (
            request.headers.get("X-Forwarded-For", "")
            if get_trust_proxy_headers()
            else ""
        )
        ctx["ipAddress"] = (forwarded.split(",")[0].strip() if forwarded else (request.remote_addr or ""))[:64]
        ctx["userAgent"] = request.headers.get("User-Agent", "")[:512]
        user = get_session_user()
        if user:
            ctx["userId"] = (user.get("user") or "")[:64]
            ctx["userName"] = (user.get("name") or user.get("user") or "")[:128]
        return ctx

    def _cost_time_ms(self) -> int:
        if not has_request_context():
            return 0
        start = getattr(g, REQUEST_START_KEY, None)
        return max(0, int((time.perf_counter() - start) * 1000)) if start is not None else 0

    def _build_audit_insert_sql(self, *, module_name, operation_type, operation_object, before=None, after=None, operation_desc=None, result_status="success", error_message=None, remark=None, user_id=None, user_name=None, request_params=None) -> str:
        ctx = self._request_context()
        if user_id is not None:
            ctx["userId"] = (user_id or "")[:64]
        if user_name is not None:
            ctx["userName"] = (user_name or "")[:128]
        if request_params is None:
            request_params = self._serialize_snapshot(before, after)
        columns = ("user_id", "user_name", "dept_name", "module_name", "operation_type", "operation_object", "operation_desc", "request_method", "request_url", "request_params", "result_status", "error_message", "ip_address", "user_agent", "cost_time_ms", "remark", "created_at")
        values = [
            self._quote(ctx["userId"]), self._quote(ctx["userName"]), self._quote(ctx["deptName"]), self._quote(module_name), self._quote(operation_type), self._quote((operation_object or "")[:512]), self._quote(operation_desc), self._quote(ctx["requestMethod"]), self._quote(ctx["requestUrl"]), self._quote(request_params), self._quote(result_status if result_status in RESULT_STATUSES else "success"), self._quote(error_message[:1024] if error_message else None), self._quote(ctx["ipAddress"]), self._quote(ctx["userAgent"]), str(self._cost_time_ms()), self._quote(remark), "CURRENT_TIMESTAMP",
        ]
        return f"INSERT INTO {TABLE_OPERATION_LOG} ({', '.join(columns)}) VALUES ({', '.join(values)})"

    def _record_audit(self, *, connection=None, cursor=None, **kwargs) -> None:
        if connection is not None and cursor is not None:
            raise ValueError("Pass either connection or cursor, not both.")
        owns_connection = connection is None and cursor is None
        owns_cursor = cursor is None
        conn, active_cursor = connection, cursor
        try:
            if owns_connection:
                conn = connect_with_profile(self._profile())
            if active_cursor is None:
                active_cursor = conn.cursor()
            active_cursor.execute(self._build_audit_insert_sql(**kwargs))
            if owns_connection:
                _commit_if_needed(conn)
        except Exception:
            if owns_connection and conn is not None:
                try:
                    _rollback_if_needed(conn)
                except Exception:
                    logger.exception("Failed to roll back internal audit transaction")
            raise
        finally:
            if owns_cursor and active_cursor is not None:
                try:
                    active_cursor.close()
                except Exception:
                    logger.exception("Failed to close internal audit cursor")
            if owns_connection and conn is not None:
                try:
                    conn.close()
                except Exception:
                    logger.exception("Failed to close internal audit connection")

    def record_required_audit(self, *, connection=None, cursor=None, **kwargs) -> bool:
        try:
            self._record_audit(connection=connection, cursor=cursor, **kwargs)
        except Exception as error:
            raise AuditLogError() from error
        return True

    def record_best_effort_audit(self, *, connection=None, cursor=None, **kwargs) -> bool:
        try:
            self._record_audit(connection=connection, cursor=cursor, **kwargs)
        except Exception:
            logger.exception("Best-effort audit persistence failed")
            return False
        return True

    def record_change_log(self, **kwargs) -> bool:
        """Backward-compatible required-audit entry point for existing write paths."""
        return self.record_required_audit(**kwargs)

    def _batch_audit_kwargs(self, *, batch_id, resource_type, operation, total_count, success_count, failed_count, skipped_count, created_count=0, updated_count=0, summary=None):
        return {
            "module_name": resource_type, "operation_type": operation, "operation_object": batch_id,
            "operation_desc": summary,
            "after": {
                "batchId": batch_id, "totalCount": total_count, "successCount": success_count,
                "failedCount": failed_count, "skippedCount": skipped_count, "createdCount": created_count,
                "updatedCount": updated_count, "summary": summary,
            },
        }

    def record_required_batch_audit(self, *, connection=None, cursor=None, **kwargs) -> bool:
        return self.record_required_audit(connection=connection, cursor=cursor, **self._batch_audit_kwargs(**kwargs))

    def record_best_effort_batch_audit(self, *, connection=None, cursor=None, **kwargs) -> bool:
        return self.record_best_effort_audit(connection=connection, cursor=cursor, **self._batch_audit_kwargs(**kwargs))

    @contextmanager
    def batch_audit(self, *, batch_id, resource_type, operation, total_count, summary=None):
        """Run a required batch audit and its business writes in one transaction."""
        handle = _BatchAuditHandle(
            batch_id=batch_id,
            resource_type=resource_type,
            operation=operation,
            total_count=total_count,
            success_count=0,
            failed_count=0,
            skipped_count=0,
            created_count=0,
            updated_count=0,
            summary=summary,
        )
        with database_transaction():
            try:
                yield handle
            except Exception:
                raise
            connection = active_transaction_connection(self._profile())
            if connection is None:
                raise AuditLogError("Required batch audit operation did not use a database connection.")
            self.record_required_batch_audit(connection=connection, **handle.to_kwargs())

    @contextmanager
    def audit(self, *, module_name, operation_type, operation_object="", before=None, after=None, operation_desc=None, remark=None):
        """Run a required-audit management write in one database transaction."""
        handle = _AuditHandle(module_name=module_name, operation_type=operation_type, operation_object=operation_object, before=before, after=after, operation_desc=operation_desc, remark=remark)
        with database_transaction() as transaction:
            try:
                yield handle
            except Exception:
                # The business exception causes the shared transaction to roll
                # back. Do not persist a misleading success or failure record
                # in a separate transaction.
                raise
            connection = active_transaction_connection(self._profile())
            if connection is None:
                raise AuditLogError("Required audit operation did not use a database connection.")
            self.record_required_audit(
                connection=connection,
                module_name=handle.module_name,
                operation_type=handle.operation_type,
                operation_object=handle.operation_object,
                before=handle.before,
                after=handle.after,
                operation_desc=handle.operation_desc,
                result_status="success",
                remark=handle.remark,
            )


class _AuditHandle:
    __slots__ = ("module_name", "operation_type", "operation_object", "before", "after", "operation_desc", "remark")

    def __init__(self, **kwargs):
        for key in self.__slots__:
            setattr(self, key, kwargs.get(key))


class _BatchAuditHandle:
    __slots__ = (
        "batch_id", "resource_type", "operation", "total_count", "success_count", "failed_count",
        "skipped_count", "created_count", "updated_count", "summary",
    )

    def __init__(self, **kwargs):
        for key in self.__slots__:
            setattr(self, key, kwargs.get(key))

    def to_kwargs(self):
        return {key: getattr(self, key) for key in self.__slots__}


operation_log_service = OperationLogService()
