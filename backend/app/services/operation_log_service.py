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
from contextlib import contextmanager
from datetime import datetime
from typing import Any

from sqlalchemy import func, insert, or_, select  # pyright: ignore[reportMissingImports]

from ..application import actor_scope, current_operation_actor, current_request_context, resolve_actor
from ..db.core import execute_core_on_connection, execute_core_on_cursor
from ..db.facade import (
    _commit_if_needed,
    _rollback_if_needed,
    active_transaction_connection,
    connect_with_profile,
    database_transaction,
    resolve_db_profile_name,
)
from ..db.service import CoreAccess
from ..db.tables import operation_log
from ..settings import get_page_size_limits

logger = logging.getLogger(__name__)

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
        self._db = CoreAccess(
            profile_getter=lambda: self._db_profile,
            error_factory=OperationLogDataSourceError,
        )

    def _profile(self):
        return self._db_profile or resolve_db_profile_name()

    def _fetch_rows(self, statement):
        return self._db.fetch_rows(statement)

    @staticmethod
    def _coerce_int(value, default: int = 0) -> int:
        try:
            return int(value)
        except (TypeError, ValueError):
            return default

    def _row_to_log(self, row: dict) -> dict:
        normalized = {column.lower(): value for column, value in row.items()}
        log = {}
        for column, field in COLUMN_MAP.items():
            value = normalized.get(column)
            if isinstance(value, datetime):
                value = value.strftime("%Y-%m-%d %H:%M:%S")
            if field == "costTimeMs":
                value = self._coerce_int(value)
            log[field] = value if value is not None else ("" if field != "id" else value)
        return log

    def _build_where(self, filters: dict):
        clauses = []
        keyword = str(filters.get("keyword") or "").strip().lower()
        module = str(filters.get("module") or "").strip()
        operation_type = str(filters.get("operationType") or "").strip()
        result = str(filters.get("result") or "").strip().lower()
        start_time = str(filters.get("startTime") or "").strip()
        end_time = str(filters.get("endTime") or "").strip()
        if keyword:
            escaped = keyword.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            pattern = f"%{escaped}%"
            searchable = (
                operation_log.c.user_name,
                operation_log.c.module_name,
                operation_log.c.operation_object,
                operation_log.c.operation_desc,
            )
            clauses.append(
                or_(
                    *(
                        func.lower(func.coalesce(column, "")).like(pattern, escape="\\")
                        for column in searchable
                    )
                )
            )
        if module:
            clauses.append(operation_log.c.module_name == module)
        if operation_type:
            clauses.append(operation_log.c.operation_type == operation_type)
        if result in RESULT_STATUSES:
            clauses.append(operation_log.c.result_status == result)
        if start_time:
            clauses.append(operation_log.c.created_at >= start_time)
        if end_time:
            clauses.append(operation_log.c.created_at <= end_time)
        return clauses

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

    @staticmethod
    def _columns():
        return tuple(operation_log.c[column] for column in COLUMN_MAP)

    def get_logs(self, filters: dict | None = None) -> dict:
        filters = filters or {}
        where = self._build_where(filters)
        page, page_size = self._resolve_paging(filters)
        count_statement = select(func.count().label("total")).select_from(operation_log).where(*where)
        page_statement = (
            select(*self._columns())
            .select_from(operation_log)
            .where(*where)
            .order_by(operation_log.c.created_at.desc(), operation_log.c.id.desc())
            .limit(page_size)
            .offset((page - 1) * page_size)
        )
        with database_transaction():
            count_rows = self._fetch_rows(count_statement)
            rows = self._fetch_rows(page_statement)
        return {
            "items": [self._row_to_log(row) for row in rows],
            "total": self._coerce_int(count_rows[0]["total"]) if count_rows else 0,
        }

    def get_log_detail(self, log_id) -> dict:
        value = str(log_id or "").strip()
        if not value.isdigit():
            raise OperationLogNotFoundError(f"Operation log not found: {log_id}")
        statement = select(*self._columns()).where(
            operation_log.c.id == self._coerce_int(value)
        )
        rows = self._fetch_rows(statement)
        if not rows:
            raise OperationLogNotFoundError(f"Operation log not found: {log_id}")
        return self._row_to_log(rows[0])

    def get_batch_log(self, batch_id: str) -> dict | None:
        """Return the latest audit row for an ingestion/batch identifier."""
        value = str(batch_id or "").strip()
        if not value:
            return None
        statement = (
            select(*self._columns())
            .select_from(operation_log)
            .where(operation_log.c.operation_object == value)
            .order_by(operation_log.c.created_at.desc(), operation_log.c.id.desc())
            .limit(1)
        )
        rows = self._fetch_rows(statement)
        return self._row_to_log(rows[0]) if rows else None

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

    def _request_context(self, *, actor=None, system_actor=None) -> dict:
        ctx = {
            "userId": "",
            "userName": "",
            "deptName": "",
            "requestMethod": "",
            "requestUrl": "",
            "ipAddress": "",
            "userAgent": "",
        }
        context = current_request_context()
        if context is not None:
            ctx["requestMethod"] = (context.method or "")[:16]
            ctx["requestUrl"] = (context.path or "")[:512]
            ctx["ipAddress"] = (context.client_address or "")[:64]
            ctx["userAgent"] = (context.user_agent or "")[:512]
        resolved = resolve_actor(explicit_actor=actor, system_actor=system_actor)
        ctx["userId"] = (resolved.id or "")[:64]
        ctx["userName"] = resolved.operation_name[:128]
        return ctx

    def _cost_time_ms(self) -> int:
        context = current_request_context()
        return context.elapsed_ms() if context is not None else 0

    def _build_audit_insert_statement(self, *, module_name, operation_type, operation_object, before=None, after=None, operation_desc=None, result_status="success", error_message=None, remark=None, user_id=None, user_name=None, request_params=None, actor=None, system_actor=None):
        ctx = self._request_context(actor=actor, system_actor=system_actor)
        request_context = current_request_context()
        request_is_authenticated = request_context is not None and request_context.identity is not None
        actor_is_declared = actor is not None or system_actor is not None or current_operation_actor() is not None
        if not request_is_authenticated and not actor_is_declared and user_id is not None:
            ctx["userId"] = (user_id or "")[:64]
        if not request_is_authenticated and not actor_is_declared and user_name is not None:
            ctx["userName"] = (user_name or "")[:128]
        if request_params is None:
            request_params = self._serialize_snapshot(before, after)
        return insert(operation_log).values(
            user_id=ctx["userId"],
            user_name=ctx["userName"],
            dept_name=ctx["deptName"],
            module_name=module_name,
            operation_type=operation_type,
            operation_object=(operation_object or "")[:512],
            operation_desc=operation_desc,
            request_method=ctx["requestMethod"],
            request_url=ctx["requestUrl"],
            request_params=request_params,
            result_status=result_status if result_status in RESULT_STATUSES else "success",
            error_message=error_message[:1024] if error_message else None,
            ip_address=ctx["ipAddress"],
            user_agent=ctx["userAgent"],
            cost_time_ms=self._cost_time_ms(),
            remark=remark,
            created_at=func.current_timestamp(),
        )

    @staticmethod
    def _rollback_owned_connection(conn: Any, owns_connection: bool) -> None:
        if not owns_connection or conn is None:
            return
        try:
            _rollback_if_needed(conn)
        except Exception:
            logger.exception("Failed to roll back internal audit transaction")

    def _record_audit(self, *, connection=None, cursor=None, **kwargs) -> None:
        if connection is not None and cursor is not None:
            raise ValueError("Pass either connection or cursor, not both.")
        owns_connection = connection is None and cursor is None
        owns_cursor = cursor is None
        conn: Any = connection
        active_cursor: Any = cursor
        try:
            if owns_connection:
                conn = connect_with_profile(self._profile())
            if active_cursor is None:
                if conn is None:
                    raise RuntimeError("Audit connection was not initialized.")
                active_cursor = conn.cursor()
            statement = self._build_audit_insert_statement(**kwargs)
            if active_cursor is not None:
                execute_core_on_cursor(self._profile(), active_cursor, statement)
            elif conn is not None:
                execute_core_on_connection(self._profile(), conn, statement)
            else:
                raise RuntimeError("Audit database handle was not initialized.")
            if owns_connection:
                _commit_if_needed(conn)
        except Exception:
            self._rollback_owned_connection(conn, owns_connection)
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

    def _batch_audit_kwargs(self, *, batch_id, resource_type, operation, total_count, success_count, failed_count, skipped_count, created_count=0, updated_count=0, summary=None, actor=None, system_actor=None):
        data = {
            "module_name": resource_type, "operation_type": operation, "operation_object": batch_id,
            "operation_desc": summary,
            "after": {
                "batchId": batch_id, "totalCount": total_count, "successCount": success_count,
                "failedCount": failed_count, "skippedCount": skipped_count, "createdCount": created_count,
                "updatedCount": updated_count, "summary": summary,
            },
        }
        if actor is not None or system_actor is not None:
            data["actor"] = resolve_actor(explicit_actor=actor, system_actor=system_actor)
        return data

    def record_required_batch_audit(self, *, connection=None, cursor=None, **kwargs) -> bool:
        return self.record_required_audit(connection=connection, cursor=cursor, **self._batch_audit_kwargs(**kwargs))

    def record_best_effort_batch_audit(self, *, connection=None, cursor=None, **kwargs) -> bool:
        return self.record_best_effort_audit(connection=connection, cursor=cursor, **self._batch_audit_kwargs(**kwargs))

    @contextmanager
    def batch_audit(self, *, batch_id, resource_type, operation, total_count, summary=None, actor=None, system_actor=None):
        """Run a required batch audit and its business writes in one transaction."""
        resolved = resolve_actor(explicit_actor=actor, system_actor=system_actor)
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
        with actor_scope(resolved):
            with database_transaction():
                try:
                    yield handle
                except Exception:
                    raise
                connection = active_transaction_connection(self._profile())
                if connection is None:
                    raise AuditLogError("Required batch audit operation did not use a database connection.")
                self.record_required_batch_audit(connection=connection, actor=resolved, **handle.to_kwargs())

    @contextmanager
    def audit(self, *, module_name, operation_type, operation_object="", before=None, after=None, operation_desc=None, remark=None, actor=None, system_actor=None):
        """Run a required-audit management write in one database transaction."""
        resolved = resolve_actor(explicit_actor=actor, system_actor=system_actor)
        handle = _AuditHandle(module_name=module_name, operation_type=operation_type, operation_object=operation_object, before=before, after=after, operation_desc=operation_desc, remark=remark)
        with actor_scope(resolved):
            with database_transaction():
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
                    actor=resolved,
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
