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
from ..db.tables import data_source, upstream_change_log, upstream_system, upstream_unload_time
from ..settings import get_page_size_limits
from ..utils.service_perf import log_slow_service_call
from .operation_log_service import (
    OPERATION_TYPE_CREATE,
    OPERATION_TYPE_DELETE,
    OPERATION_TYPE_DISABLE,
    OPERATION_TYPE_ENABLE,
    OPERATION_TYPE_UPDATE,
    operation_log_service,
)


SYSTEM_ID_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
DEFAULT_UPSTREAM_STATUS = {"enabled", "disabled"}
# Keep the service usable while an older installation is waiting for the
# dictionary migration; an existing catalog still remains the source of truth.
DEFAULT_UPSTREAM_DB_TYPES = {
    "POSTGRESQL": "PostgreSQL",
    "MYSQL": "MySQL",
    "ORACLE": "Oracle",
    "SQL_SERVER": "SQL Server",
    "MONGODB": "MongoDB",
    "KAFKA": "Kafka",
    "OBJECT_STORAGE": "Object Storage",
    "OTHER": "其他",
}
DEFAULT_UPSTREAM_DEPTS = {
    "PRODUCT_OPERATIONS": "商品运营部",
    "MEMBER_OPERATIONS": "会员运营部",
    "TRADE_OPERATIONS": "交易运营部",
    "STORE_OPERATIONS": "门店运营部",
    "SUPPLY_CHAIN": "供应链部",
    "MARKETING": "市场营销部",
    "FULFILLMENT": "履约运营部",
    "CUSTOMER_SERVICE": "客户服务部",
}
LOGGER = logging.getLogger(__name__)


class UpstreamSystemNotFoundError(Exception):
    def __init__(self, system_id):
        self.system_id = system_id
        super().__init__(f"Upstream system not found: {system_id}")

    def to_dict(self):
        return {"code": "UPSTREAM_SYSTEM_NOT_FOUND", "message": f"Upstream system not found: {self.system_id}"}


class UpstreamSystemAlreadyExistsError(Exception):
    def __init__(self, system_id):
        self.system_id = system_id
        super().__init__(f"Upstream system already exists: {system_id}")

    def to_dict(self):
        return {"code": "UPSTREAM_SYSTEM_ALREADY_EXISTS", "message": f"Upstream system already exists: {self.system_id}"}


class UpstreamValidationError(Exception):
    def __init__(self, details):
        self.details = details
        super().__init__("Upstream validation failed")

    def to_dict(self):
        return {"code": "UPSTREAM_VALIDATION_FAILED", "message": "Upstream validation failed", "details": self.details}


class UpstreamDataSourceError(Exception):
    def __init__(self, message):
        self.message = message
        super().__init__(message)

    def to_dict(self):
        return {"code": "UPSTREAM_DATA_SOURCE_ERROR", "message": self.message}


class UpstreamService(AuditActorMixin):
    def __init__(self):
        self._db_profile = os.getenv("ASSET_DB_PROFILE", "").strip()
        self._db = CoreAccess(
            profile_getter=lambda: self._db_profile,
            error_factory=UpstreamDataSourceError,
        )

    def _fetch_rows(self, statement):
        return self._db.fetch_rows(statement)

    def _fetch_rows_logged(self, sql, *, purpose, method, page=None, page_size=None, keyword=None):
        started_at = perf_counter()
        try:
            return self._fetch_rows(sql)
        finally:
            log_slow_service_call(
                LOGGER,
                service="UpstreamService",
                method=method,
                purpose=purpose,
                started_at=started_at,
                page=page,
                page_size=page_size,
                keyword=keyword,
            )

    def _execute(self, statements):
        return self._db.execute_statements(statements)

    def _next_id(self, table, column):
        return self._db.next_pk(table, column)

    @staticmethod
    def _coerce_db_integer(value, field):
        try:
            return int(value)
        except (TypeError, ValueError) as error:
            raise UpstreamDataSourceError(f"数据库字段 {field} 不是有效整数") from error

    def _get_allowed_status_values(self):
        try:
            return {value for value in common_code_service.get_item_values("SYSTEM_STATUS") if value}
        except (CommonCodeCategoryNotFoundError, CommonCodeDataSourceError):
            return set(DEFAULT_UPSTREAM_STATUS)

    def _get_option_contract(self, category_code, fallback):
        try:
            items = common_code_service.get_items(category_code)
        except (CommonCodeCategoryNotFoundError, CommonCodeDataSourceError):
            if isinstance(fallback, dict):
                items = [
                    {"code": str(code), "name": str(value), "value": str(value)}
                    for code, value in fallback.items()
                    if value
                ]
            else:
                items = [
                    {"code": str(value), "name": str(value), "value": str(value)}
                    for value in fallback
                    if value
                ]

        values = set()
        aliases = {}
        for item in items:
            if not isinstance(item, dict):
                continue
            value = str(item.get("value") or item.get("name") or "").strip()
            if not value:
                continue
            values.add(value)
            for alias in (value, item.get("name"), item.get("code")):
                alias_key = str(alias or "").strip().casefold()
                if alias_key:
                    aliases.setdefault(alias_key, value)
        return values, aliases

    def _get_allowed_values(self, category_code, fallback):
        values, _aliases = self._get_option_contract(category_code, fallback)
        return values

    @staticmethod
    def _normalize_option_value(value, aliases):
        normalized = str(value or "").strip()
        return aliases.get(normalized.casefold(), normalized)

    def _display_option_value(self, category_code, value):
        _values, aliases = self._get_option_contract(category_code, set())
        return self._normalize_option_value(value, aliases)

    def _normalize_payload(self, payload, current=None):
        details = []
        if not isinstance(payload, dict):
            raise UpstreamValidationError([{"field": "body", "message": "Request body must be a JSON object"}])

        system_id = str(payload.get("id") or "").strip()
        abbr = str(payload.get("abbr") or "").strip()
        name = str(payload.get("name") or "").strip()
        host = str(payload.get("host") or "").strip()
        db_type = str(payload.get("dbType") or "").strip()
        dept = str(payload.get("dept") or "").strip()
        unload_times = payload.get("unloadTimes")
        status = str(payload.get("status") or "").strip()
        allowed_status = self._get_allowed_status_values()
        allowed_db_types, db_type_aliases = self._get_option_contract(
            "UPSTREAM_DB_TYPE", DEFAULT_UPSTREAM_DB_TYPES
        )
        allowed_depts, dept_aliases = self._get_option_contract(
            "UPSTREAM_DEPT", DEFAULT_UPSTREAM_DEPTS
        )
        db_type = self._normalize_option_value(db_type, db_type_aliases)
        dept = self._normalize_option_value(dept, dept_aliases)

        if not system_id:
            details.append({"field": "id", "message": "id is required"})
        elif not SYSTEM_ID_RE.fullmatch(system_id):
            details.append({"field": "id", "message": "id format is invalid"})
        if not abbr:
            details.append({"field": "abbr", "message": "abbr is required"})
        if not name:
            details.append({"field": "name", "message": "name is required"})
        if not db_type:
            details.append({"field": "dbType", "message": "dbType is required"})
        elif db_type not in allowed_db_types and (current or {}).get("dbType") != db_type:
            details.append({"field": "dbType", "message": f"“{db_type}”不是有效选项"})
        if not host:
            details.append({"field": "host", "message": "host is required"})
        if dept and dept not in allowed_depts and (current or {}).get("dept") != dept:
            details.append({"field": "dept", "message": f"“{dept}”不是有效选项"})
        if status not in allowed_status:
            details.append({"field": "status", "message": f"status is not allowed: {status}"})
        normalized_unload_times = unload_times if isinstance(unload_times, list) else []
        if not normalized_unload_times:
            details.append({"field": "unloadTimes", "message": "unloadTimes must contain at least one time"})
        else:
            for index, value in enumerate(normalized_unload_times):
                if not isinstance(value, str) or not TIME_RE.fullmatch(value.strip()):
                    details.append({"field": f"unloadTimes[{index}]", "message": "time format must be HH:mm"})

        if details:
            raise UpstreamValidationError(details)
        unload_times = [value.strip() for value in normalized_unload_times]

        return {
            "id": system_id,
            "abbr": abbr.upper(),
            "name": name,
            "dbType": db_type,
            "host": host,
            "db": str(payload.get("db") or "").strip(),
            "schema": str(payload.get("schema") or "").strip(),
            "unloadTimes": sorted({value.strip() for value in unload_times}),
            "status": status,
            "owner": str(payload.get("owner") or "").strip(),
            "dept": dept,
            "desc": str(payload.get("desc") or "").strip(),
        }

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

    def _build_system_where(self, keyword=None, status=None, db_type=None):
        clauses = [upstream_system.c.is_deleted == "N"]
        if status:
            clauses.append(upstream_system.c.status_code == str(status).strip())
        if db_type:
            clauses.append(upstream_system.c.db_type == str(db_type).strip())
        normalized_keyword = str(keyword or "").strip().lower()
        if normalized_keyword:
            pattern = f"%{normalized_keyword}%"
            clauses.append(or_(
                func.lower(func.coalesce(upstream_system.c.system_id, "")).like(pattern),
                func.lower(func.coalesce(upstream_system.c.system_abbr, "")).like(pattern),
                func.lower(func.coalesce(upstream_system.c.system_name, "")).like(pattern),
                func.lower(func.coalesce(upstream_system.c.owner_name, "")).like(pattern),
                func.lower(func.coalesce(upstream_system.c.dept_name, "")).like(pattern),
                func.lower(func.coalesce(upstream_system.c.system_desc, "")).like(pattern),
                select(1).where(
                    upstream_unload_time.c.system_pk == upstream_system.c.system_pk,
                    upstream_unload_time.c.is_deleted == "N",
                    func.lower(func.coalesce(upstream_unload_time.c.unload_time, "")).like(pattern),
                ).exists(),
            ))
        return clauses

    def _load_unload_times(self, system_pks, *, purpose, method):
        if not system_pks:
            return {}
        rows = self._fetch_rows_logged(
            select(upstream_unload_time.c.system_pk, upstream_unload_time.c.unload_time)
            .where(
                upstream_unload_time.c.is_deleted == "N",
                upstream_unload_time.c.system_pk.in_([
                    self._coerce_db_integer(value, "system_pk") for value in system_pks
                ]),
            )
            .order_by(upstream_unload_time.c.system_pk, upstream_unload_time.c.unload_time),
            purpose=purpose,
            method=method,
        )
        grouped = {}
        for row in rows:
            grouped.setdefault(
                self._coerce_db_integer(row["system_pk"], "system_pk"),
                [],
            ).append(row["unload_time"])
        return grouped

    def _row_to_system(self, row, unload_times=None, include_connection=False):
        system = {
            "upstreamSystemId": self._coerce_db_integer(row["system_pk"], "system_pk"),
            "id": row["system_id"],
            "abbr": row["system_abbr"],
            "name": row["system_name"],
            "dbType": self._display_option_value("UPSTREAM_DB_TYPE", row["db_type"]),
            "unloadTimes": list(unload_times or []),
            "status": row["status_code"],
            "owner": row.get("owner_name") or "",
            "dept": self._display_option_value("UPSTREAM_DEPT", row.get("dept_name")),
            "desc": row.get("system_desc") or "",
        }
        if include_connection:
            system.update({
                "host": row["host_name"],
                "db": row.get("db_name") or "",
                "schema": row.get("schema_name") or "",
            })
        return system

    @staticmethod
    def _system_select(include_connection=False):
        columns = [
            upstream_system.c.system_pk, upstream_system.c.system_id,
            upstream_system.c.system_abbr, upstream_system.c.system_name,
            upstream_system.c.db_type,
        ]
        if include_connection:
            columns.extend([
                upstream_system.c.host_name, upstream_system.c.db_name, upstream_system.c.schema_name,
            ])
        columns.extend([
            upstream_system.c.status_code, upstream_system.c.owner_name,
            upstream_system.c.dept_name, upstream_system.c.system_desc,
        ])
        return columns

    def _db_systems(self, keyword=None, status=None, db_type=None, page=None, page_size=None):
        paginate = page is not None or page_size is not None
        page, page_size = self._resolve_paging(page=page, page_size=page_size)
        offset = (page - 1) * page_size
        statement = (
            select(*self._system_select())
            .where(*self._build_system_where(keyword=keyword, status=status, db_type=db_type))
            .order_by(upstream_system.c.system_abbr, upstream_system.c.system_id)
        )
        if paginate:
            statement = statement.limit(page_size).offset(offset)
        rows = self._fetch_rows_logged(
            statement,
            purpose="upstream system list",
            method="_db_systems",
            page=page,
            page_size=page_size,
            keyword=keyword,
        )
        unload_times_by_pk = self._load_unload_times(
            [row["system_pk"] for row in rows],
            purpose="upstream system unload times",
            method="_db_systems",
        )
        return [
            self._row_to_system(
                row,
                unload_times_by_pk.get(
                    self._coerce_db_integer(row["system_pk"], "system_pk"), []
                ),
            )
            for row in rows
        ]

    def _get_system_row(self, system_id, include_connection=False):
        statement = (
            select(*self._system_select(include_connection))
            .where(upstream_system.c.is_deleted == "N", upstream_system.c.system_id == str(system_id).strip())
            .limit(1)
        )
        rows = self._fetch_rows_logged(statement, purpose="upstream system detail", method="_get_system_row")
        if not rows:
            raise UpstreamSystemNotFoundError(system_id)
        return rows[0]

    def get_systems(self, keyword=None, status=None, db_type=None, page=None, page_size=None):
        with database_transaction():
            return self._db_systems(keyword=keyword, status=status, db_type=db_type, page=page, page_size=page_size)

    def _load_system_detail(self, system_id, *, include_connection=False, purpose="upstream detail unload times", method="get_system_detail"):
        """Load one system using the current shared transaction (if any)."""
        row = self._get_system_row(system_id, include_connection=include_connection)
        unload_times = self._load_unload_times(
            [row["system_pk"]],
            purpose=purpose,
            method=method,
        )
        return deepcopy(
            self._row_to_system(
                row,
                unload_times.get(
                    self._coerce_db_integer(row["system_pk"], "system_pk"), []
                ),
                include_connection=include_connection,
            )
        )

    def get_system_detail(self, system_id):
        with database_transaction():
            return self._load_system_detail(
                system_id,
                include_connection=False,
                purpose="upstream detail unload times",
                method="get_system_detail",
            )

    def get_system_admin_detail(self, system_id):
        with database_transaction():
            return self._load_system_detail(
                system_id,
                include_connection=True,
                purpose="upstream admin detail unload times",
                method="get_system_admin_detail",
            )

    @actor_aware
    def create_system(self, payload):
        with operation_log_service.audit(
            module_name="上游系统",
            operation_type=OPERATION_TYPE_CREATE,
            operation_object=str((payload or {}).get("id") or "") if isinstance(payload, dict) else "",
            operation_desc="新增上游系统",
        ) as audit:
            item = self._create_system(payload)
            audit.operation_object = item["id"]
            audit.after = item
            return item

    def _create_system(self, payload):
        item = self._normalize_payload(payload)
        if self._fetch_rows_logged(
            select(upstream_system.c.system_pk).where(
                upstream_system.c.system_id == item["id"], upstream_system.c.is_deleted == "N"
            ).limit(1),
            purpose="upstream uniqueness check",
            method="_create_system",
        ):
            raise UpstreamSystemAlreadyExistsError(item["id"])

        system_pk = self._next_id(upstream_system, upstream_system.c.system_pk)
        data_source_id = self._next_id(data_source, data_source.c.source_id)
        time_pk = self._next_id(upstream_unload_time, upstream_unload_time.c.time_pk)
        change_id = self._next_id(upstream_change_log, upstream_change_log.c.change_id)
        statements = [
            insert(data_source).values(
                source_id=data_source_id, source_code=item["id"], source_name=item["name"],
                source_type=item["dbType"], description_text=item["desc"], status_code=item["status"],
                is_deleted="N", created_by=self._default_operator, updated_by=self._default_operator,
            ),
            insert(upstream_system).values(
                system_pk=system_pk, data_source_id=data_source_id, system_id=item["id"],
                system_abbr=item["abbr"], system_name=item["name"], db_type=item["dbType"],
                host_name=item["host"], db_name=item["db"], schema_name=item["schema"],
                status_code=item["status"], owner_name=item["owner"], dept_name=item["dept"],
                system_desc=item["desc"], unload_count=len(item["unloadTimes"]), is_deleted="N",
                created_by=self._default_operator, updated_by=self._default_operator,
            ),
        ]
        statements.extend(
            insert(upstream_unload_time).values(
                time_pk=time_pk + index - 1, system_pk=system_pk, unload_time=value,
                display_order=index, is_deleted="N", created_by=self._default_operator,
                updated_by=self._default_operator,
            ) for index, value in enumerate(item["unloadTimes"], start=1)
        )
        statements.append(insert(upstream_change_log).values(
            change_id=change_id, system_pk=system_pk, system_id=item["id"],
            change_type="CREATE_SYSTEM", change_summary="create upstream system",
            after_json=json.dumps(item, ensure_ascii=False), operator_name=self._default_operator,
        ))
        self._execute(statements)
        return item

    @actor_aware
    def update_system(self, system_id, payload):
        with operation_log_service.audit(
            module_name="上游系统",
            operation_type=OPERATION_TYPE_UPDATE,
            operation_object=system_id,
            operation_desc="编辑上游系统",
        ) as audit:
            current, item = self._update_system(system_id, payload)
            audit.operation_object = item["id"]
            audit.before = current
            audit.after = item
            return item

    def _update_system(self, system_id, payload):
        current = self._load_system_detail(system_id, include_connection=True,
                                           purpose="upstream admin detail unload times", method="_update_system")
        item = self._normalize_payload(payload, current=current)
        rows = self._fetch_rows_logged(
            select(upstream_system.c.system_pk, upstream_system.c.data_source_id).where(
                upstream_system.c.system_id == str(system_id), upstream_system.c.is_deleted == "N"
            ).limit(1), purpose="upstream system id lookup", method="_update_system")
        if not rows:
            raise UpstreamSystemNotFoundError(system_id)
        if item["id"] != system_id and self._fetch_rows_logged(
            select(upstream_system.c.system_pk).where(
                upstream_system.c.system_id == item["id"], upstream_system.c.is_deleted == "N"
            ).limit(1), purpose="upstream uniqueness check", method="_update_system"):
            raise UpstreamSystemAlreadyExistsError(item["id"])
        system_pk = self._coerce_db_integer(rows[0]["system_pk"], "system_pk")
        data_source_id = self._coerce_db_integer(rows[0]["data_source_id"], "data_source_id")
        time_pk = self._next_id(upstream_unload_time, upstream_unload_time.c.time_pk)
        change_id = self._next_id(upstream_change_log, upstream_change_log.c.change_id)
        statements = [
            update(data_source).where(data_source.c.source_id == data_source_id).values(
                source_code=item["id"], source_name=item["name"], source_type=item["dbType"],
                description_text=item["desc"], status_code=item["status"],
                updated_by=self._default_operator, updated_at=func.current_timestamp()),
            update(upstream_system).where(upstream_system.c.system_pk == system_pk).values(
                system_id=item["id"], system_abbr=item["abbr"], system_name=item["name"],
                db_type=item["dbType"], host_name=item["host"], db_name=item["db"],
                schema_name=item["schema"], status_code=item["status"], owner_name=item["owner"],
                dept_name=item["dept"], system_desc=item["desc"], unload_count=len(item["unloadTimes"]),
                updated_by=self._default_operator, updated_at=func.current_timestamp()),
            delete(upstream_unload_time).where(upstream_unload_time.c.system_pk == system_pk),
        ]
        statements.extend(insert(upstream_unload_time).values(
            time_pk=time_pk + index - 1, system_pk=system_pk, unload_time=value,
            display_order=index, is_deleted="N", created_by=self._default_operator,
            updated_by=self._default_operator) for index, value in enumerate(item["unloadTimes"], start=1))
        statements.append(insert(upstream_change_log).values(
            change_id=change_id, system_pk=system_pk, system_id=item["id"], change_type="UPDATE_SYSTEM",
            change_summary="update upstream system", before_json=json.dumps(current, ensure_ascii=False),
            after_json=json.dumps(item, ensure_ascii=False), operator_name=self._default_operator))
        self._execute(statements)
        return current, item

    @actor_aware
    def patch_status(self, system_id, status):
        normalized = str(status or "").strip()
        if normalized not in self._get_allowed_status_values():
            raise UpstreamValidationError([{"field": "status", "message": f"status is not allowed: {normalized}"}])
        current = self.get_system_detail(system_id)
        operation_type = OPERATION_TYPE_DISABLE if normalized == "disabled" else OPERATION_TYPE_ENABLE
        with operation_log_service.audit(
            module_name="上游系统",
            operation_type=operation_type,
            operation_object=system_id,
            operation_desc=f"{operation_type}上游系统",
        ) as audit:
            rows = self._fetch_rows_logged(
                select(upstream_system.c.system_pk).where(
                    upstream_system.c.system_id == str(system_id), upstream_system.c.is_deleted == "N"
                ).limit(1), purpose="upstream status id lookup", method="patch_status")
            if not rows:
                raise UpstreamSystemNotFoundError(system_id)
            system_pk = self._coerce_db_integer(rows[0]["system_pk"], "system_pk")
            item = {**current, "status": normalized}
            change_id = self._next_id(upstream_change_log, upstream_change_log.c.change_id)
            self._execute([
                update(upstream_system).where(upstream_system.c.system_pk == system_pk).values(
                    status_code=normalized, updated_by=self._default_operator,
                    updated_at=func.current_timestamp()),
                update(data_source).where(data_source.c.source_code == str(system_id)).values(
                    status_code=normalized, updated_by=self._default_operator,
                    updated_at=func.current_timestamp()),
                insert(upstream_change_log).values(
                    change_id=change_id, system_pk=system_pk, system_id=str(system_id),
                    change_type="UPDATE_STATUS", change_summary="update upstream status",
                    before_json=json.dumps(current, ensure_ascii=False),
                    after_json=json.dumps(item, ensure_ascii=False), operator_name=self._default_operator),
            ])
            audit.operation_object = item["id"]
            audit.before = current
            audit.after = item
            return item

    @actor_aware
    def delete_system(self, system_id):
        with operation_log_service.audit(
            module_name="上游系统",
            operation_type=OPERATION_TYPE_DELETE,
            operation_object=system_id,
            operation_desc="删除上游系统",
        ) as audit:
            audit.before = self._delete_system(system_id)

    def _delete_system(self, system_id):
        rows = self._fetch_rows(select(upstream_system.c.system_pk).where(
            upstream_system.c.system_id == str(system_id), upstream_system.c.is_deleted == "N"))
        if not rows:
            raise UpstreamSystemNotFoundError(system_id)
        # Must not open a nested database_transaction: callers run under audit().
        current = self._load_system_detail(
            system_id,
            include_connection=False,
            purpose="upstream detail unload times",
            method="_delete_system",
        )
        system_pk = self._coerce_db_integer(rows[0]["system_pk"], "system_pk")
        change_id = self._next_id(upstream_change_log, upstream_change_log.c.change_id)
        statements = [
            delete(upstream_unload_time).where(upstream_unload_time.c.system_pk == system_pk),
            delete(upstream_system).where(upstream_system.c.system_pk == system_pk),
            insert(upstream_change_log).values(
                change_id=change_id, system_pk=system_pk, system_id=str(system_id),
                change_type="DELETE_SYSTEM", change_summary="delete upstream system",
                before_json=json.dumps(current, ensure_ascii=False), operator_name=self._default_operator),
        ]
        self._execute(statements)
        return current


upstream_service = UpstreamService()
