# Copyright 2025 Jearhe
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.

from __future__ import annotations

import os
import re

from sqlalchemy import delete, func, insert, or_, select, update

from ..application import AuditActorMixin, actor_aware
from ..db.service import CoreAccess
from ..db.tables import manual_code_table
from .operation_log_service import (
    OPERATION_TYPE_CREATE,
    OPERATION_TYPE_DELETE,
    OPERATION_TYPE_DISABLE,
    OPERATION_TYPE_ENABLE,
    OPERATION_TYPE_UPDATE,
    operation_log_service,
)


TABLE_CODE_RE = re.compile(r"^[A-Z][A-Z0-9_]{1,63}$")
TABLE_STYLES = {"enum", "dim", "status", "map", "custom"}
TABLE_STATUSES = {"enabled", "disabled"}


class ManualCodeTableNotFoundError(Exception):
    def __init__(self, table_id):
        self.table_id = str(table_id)
        super().__init__(f"Manual code table not found: {self.table_id}")

    def to_dict(self):
        return {"code": "MANUAL_CODE_TABLE_NOT_FOUND", "message": str(self)}


class ManualCodeTableAlreadyExistsError(Exception):
    def __init__(self, table_code):
        self.table_code = table_code
        super().__init__(f"Manual code table already exists: {table_code}")

    def to_dict(self):
        return {"code": "MANUAL_CODE_TABLE_ALREADY_EXISTS", "message": str(self)}


class ManualCodeTableValidationError(Exception):
    def __init__(self, details):
        self.details = details
        super().__init__("Manual code table validation failed")

    def to_dict(self):
        return {
            "code": "MANUAL_CODE_TABLE_VALIDATION_FAILED",
            "message": "Manual code table validation failed",
            "details": self.details,
        }


class ManualCodeTableDataSourceError(Exception):
    def __init__(self, message):
        self.message = message
        super().__init__(message)

    def to_dict(self):
        return {"code": "MANUAL_CODE_TABLE_DATA_SOURCE_ERROR", "message": self.message}


class ManualCodeTableService(AuditActorMixin):
    def __init__(self):
        self._db_profile = os.getenv("ASSET_DB_PROFILE", "").strip()
        self._db = CoreAccess(
            profile_getter=lambda: self._db_profile,
            error_factory=ManualCodeTableDataSourceError,
        )

    def _fetch_rows(self, statement):
        return self._db.fetch_rows(statement)

    def _execute(self, statements):
        return self._db.execute_statements(statements)

    @staticmethod
    def _parse_id(table_id):
        value = str(table_id or "").strip()
        if not value.isdigit():
            raise ManualCodeTableNotFoundError(table_id)
        return int(value)

    def _next_id(self):
        return self._db.next_pk(manual_code_table, manual_code_table.c.table_id)

    @staticmethod
    def _normalize_payload(payload):
        if not isinstance(payload, dict):
            raise ManualCodeTableValidationError(
                [{"field": "body", "message": "请求体必须是 JSON 对象"}]
            )

        item = {
            "tableCode": str(payload.get("tableCode") or "").strip().upper(),
            "tableName": str(payload.get("tableName") or "").strip(),
            "style": str(payload.get("style") or "").strip().lower(),
            "owner": str(payload.get("owner") or "").strip(),
            "status": str(payload.get("status") or "enabled").strip().lower(),
            "remark": str(payload.get("remark") or "").strip(),
        }
        details = []
        if not TABLE_CODE_RE.fullmatch(item["tableCode"]):
            details.append(
                {
                    "field": "tableCode",
                    "message": "表编码须以大写字母开头，只能包含大写字母、数字和下划线，长度为 2–64 位",
                }
            )
        if not item["tableName"]:
            details.append({"field": "tableName", "message": "表名称不能为空"})
        elif len(item["tableName"]) > 128:
            details.append({"field": "tableName", "message": "表名称不能超过 128 个字符"})
        if item["style"] not in TABLE_STYLES:
            details.append({"field": "style", "message": "表样式无效"})
        if item["status"] not in TABLE_STATUSES:
            details.append({"field": "status", "message": "状态无效"})
        if len(item["owner"]) > 64:
            details.append({"field": "owner", "message": "负责人不能超过 64 个字符"})
        if len(item["remark"]) > 1000:
            details.append({"field": "remark", "message": "说明不能超过 1000 个字符"})
        if details:
            raise ManualCodeTableValidationError(details)
        return item

    @staticmethod
    def _row_to_item(row):
        return {
            "id": str(row["table_id"]),
            "tableCode": row["table_code"],
            "tableName": row["table_name"],
            "style": row["table_style"],
            "owner": row.get("owner_name") or "",
            "status": row["status_code"],
            "remark": row.get("remark") or "",
            "createdBy": row.get("created_by") or "",
            "createdAt": str(row.get("created_at") or ""),
            "updatedBy": row.get("updated_by") or "",
            "updatedAt": str(row.get("updated_at") or ""),
        }

    @staticmethod
    def _columns():
        return (
            manual_code_table.c.table_id,
            manual_code_table.c.table_code,
            manual_code_table.c.table_name,
            manual_code_table.c.table_style,
            manual_code_table.c.owner_name,
            manual_code_table.c.status_code,
            manual_code_table.c.remark,
            manual_code_table.c.created_by,
            manual_code_table.c.created_at,
            manual_code_table.c.updated_by,
            manual_code_table.c.updated_at,
        )

    @staticmethod
    def _build_filters(keyword=None, style=None, status=None):
        clauses = []
        if style:
            clauses.append(manual_code_table.c.table_style == style)
        if status:
            clauses.append(manual_code_table.c.status_code == status)
        if keyword:
            escaped = str(keyword).strip().lower().replace("\\", "\\\\")
            escaped = escaped.replace("%", "\\%").replace("_", "\\_")
            pattern = f"%{escaped}%"
            searchable = (
                manual_code_table.c.table_code,
                manual_code_table.c.table_name,
                manual_code_table.c.owner_name,
                manual_code_table.c.remark,
            )
            clauses.append(
                or_(
                    *(
                        func.lower(func.coalesce(column, "")).like(
                            pattern, escape="\\"
                        )
                        for column in searchable
                    )
                )
            )
        return clauses

    def get_tables(self, keyword=None, style=None, status=None):
        normalized_style = str(style or "").strip().lower()
        normalized_status = str(status or "").strip().lower()
        if normalized_style and normalized_style not in TABLE_STYLES:
            raise ManualCodeTableValidationError(
                [{"field": "style", "message": "表样式无效"}]
            )
        if normalized_status and normalized_status not in TABLE_STATUSES:
            raise ManualCodeTableValidationError(
                [{"field": "status", "message": "状态无效"}]
            )

        statement = (
            select(*self._columns())
            .where(*self._build_filters(keyword, normalized_style, normalized_status))
            .order_by(manual_code_table.c.updated_at.desc(), manual_code_table.c.table_code)
        )
        return [self._row_to_item(row) for row in self._fetch_rows(statement)]

    def get_table(self, table_id):
        normalized_id = self._parse_id(table_id)
        statement = select(*self._columns()).where(
            manual_code_table.c.table_id == normalized_id
        )
        rows = self._fetch_rows(statement)
        if not rows:
            raise ManualCodeTableNotFoundError(table_id)
        return self._row_to_item(rows[0])

    @actor_aware
    def create_table(self, payload):
        with operation_log_service.audit(
            module_name="码值表维护",
            operation_type=OPERATION_TYPE_CREATE,
            operation_desc="新增手工码值表",
        ) as audit:
            item = self._normalize_payload(payload)
            if any(current["tableCode"] == item["tableCode"] for current in self.get_tables()):
                raise ManualCodeTableAlreadyExistsError(item["tableCode"])
            table_id = self._next_id()
            self._execute(
                [
                    insert(manual_code_table).values(
                        table_id=table_id,
                        table_code=item["tableCode"],
                        table_name=item["tableName"],
                        table_style=item["style"],
                        owner_name=item["owner"],
                        status_code=item["status"],
                        remark=item["remark"],
                        created_by=self._default_operator,
                        updated_by=self._default_operator,
                    )
                ]
            )
            created = self.get_table(table_id)
            audit.operation_object = created["tableCode"]
            audit.after = created
            return created

    @actor_aware
    def update_table(self, table_id, payload):
        with operation_log_service.audit(
            module_name="码值表维护",
            operation_type=OPERATION_TYPE_UPDATE,
            operation_object=str(table_id),
            operation_desc="编辑手工码值表",
        ) as audit:
            normalized_id = self._parse_id(table_id)
            before = self.get_table(normalized_id)
            item = self._normalize_payload(payload)
            if any(
                current["id"] != str(normalized_id)
                and current["tableCode"] == item["tableCode"]
                for current in self.get_tables()
            ):
                raise ManualCodeTableAlreadyExistsError(item["tableCode"])
            self._execute(
                [
                    update(manual_code_table)
                    .where(manual_code_table.c.table_id == normalized_id)
                    .values(
                        table_code=item["tableCode"],
                        table_name=item["tableName"],
                        table_style=item["style"],
                        owner_name=item["owner"],
                        status_code=item["status"],
                        remark=item["remark"],
                        updated_by=self._default_operator,
                        updated_at=func.current_timestamp(),
                    )
                ]
            )
            after = self.get_table(normalized_id)
            audit.operation_object = after["tableCode"]
            audit.before = before
            audit.after = after
            return after

    @actor_aware
    def update_status(self, table_id, status):
        normalized_status = str(status or "").strip().lower()
        if normalized_status not in TABLE_STATUSES:
            raise ManualCodeTableValidationError(
                [{"field": "status", "message": "状态无效"}]
            )
        operation_type = (
            OPERATION_TYPE_ENABLE
            if normalized_status == "enabled"
            else OPERATION_TYPE_DISABLE
        )
        with operation_log_service.audit(
            module_name="码值表维护",
            operation_type=operation_type,
            operation_object=str(table_id),
            operation_desc="更新手工码值表状态",
        ) as audit:
            normalized_id = self._parse_id(table_id)
            before = self.get_table(normalized_id)
            self._execute(
                [
                    update(manual_code_table)
                    .where(manual_code_table.c.table_id == normalized_id)
                    .values(
                        status_code=normalized_status,
                        updated_by=self._default_operator,
                        updated_at=func.current_timestamp(),
                    )
                ]
            )
            after = self.get_table(normalized_id)
            audit.operation_object = after["tableCode"]
            audit.before = before
            audit.after = after
            return after

    @actor_aware
    def delete_table(self, table_id):
        with operation_log_service.audit(
            module_name="码值表维护",
            operation_type=OPERATION_TYPE_DELETE,
            operation_object=str(table_id),
            operation_desc="删除手工码值表",
        ) as audit:
            normalized_id = self._parse_id(table_id)
            before = self.get_table(normalized_id)
            self._execute(
                [delete(manual_code_table).where(manual_code_table.c.table_id == normalized_id)]
            )
            audit.operation_object = before["tableCode"]
            audit.before = before


manual_code_table_service = ManualCodeTableService()
