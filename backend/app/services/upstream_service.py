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

from .common_code_service import (
    CommonCodeCategoryNotFoundError,
    CommonCodeDataSourceError,
    common_code_service,
)
from ..db.gaussdb import database_transaction, execute_statements, fetch_all, resolve_db_profile_name
from ..settings import get_default_operator, get_page_size_limits
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
DEFAULT_UPSTREAM_DB_TYPES = set()
DEFAULT_UPSTREAM_DEPTS = set()
TABLE_UPSTREAM_SYSTEM = "dwp.p_upstream_system"
TABLE_UPSTREAM_TIME = "dwp.p_upstream_unload_time"
TABLE_UPSTREAM_CHANGE_LOG = "dwp.p_upstream_change_log"
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


class UpstreamService:
    def __init__(self):
        self._db_profile = os.getenv("ASSET_DB_PROFILE", "").strip()
        self._default_operator = get_default_operator()

    def _fetch_rows(self, sql):
        try:
            columns, rows = fetch_all(self._db_profile or resolve_db_profile_name(), sql)
        except FileNotFoundError as error:
            raise UpstreamDataSourceError(f"Database config file not found: {error.filename}") from error
        except KeyError as error:
            raise UpstreamDataSourceError(str(error)) from error
        except RuntimeError as error:
            raise UpstreamDataSourceError(str(error)) from error
        except Exception as error:
            raise UpstreamDataSourceError(f"Database query failed: {error}") from error
        return [dict(zip(columns, row)) for row in rows]

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
        try:
            return execute_statements(self._db_profile or resolve_db_profile_name(), statements)
        except FileNotFoundError as error:
            raise UpstreamDataSourceError(f"Database config file not found: {error.filename}") from error
        except KeyError as error:
            raise UpstreamDataSourceError(str(error)) from error
        except RuntimeError as error:
            raise UpstreamDataSourceError(str(error)) from error
        except Exception as error:
            raise UpstreamDataSourceError(f"Database execution failed: {error}") from error

    def _quote(self, value):
        if value is None:
            return "NULL"
        return "'" + str(value).replace("'", "''") + "'"

    def _next_id(self, table_name, id_column):
        rows = self._fetch_rows(f"SELECT COALESCE(MAX({id_column}), 0) + 1 AS next_id FROM {table_name}")
        return int(rows[0]["next_id"])

    def _get_allowed_status_values(self):
        try:
            return {value for value in common_code_service.get_item_values("SYSTEM_STATUS") if value}
        except (CommonCodeCategoryNotFoundError, CommonCodeDataSourceError):
            return set(DEFAULT_UPSTREAM_STATUS)

    def _get_allowed_values(self, category_code, fallback):
        try:
            return {value for value in common_code_service.get_item_values(category_code) if value}
        except (CommonCodeCategoryNotFoundError, CommonCodeDataSourceError):
            return set(fallback)

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
        allowed_db_types = self._get_allowed_values("UPSTREAM_DB_TYPE", DEFAULT_UPSTREAM_DB_TYPES)
        allowed_depts = self._get_allowed_values("UPSTREAM_DEPT", DEFAULT_UPSTREAM_DEPTS)

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
            details.append({"field": "dbType", "message": f"dbType is not allowed: {db_type}"})
        if not host:
            details.append({"field": "host", "message": "host is required"})
        if dept and dept not in allowed_depts and (current or {}).get("dept") != dept:
            details.append({"field": "dept", "message": f"dept is not allowed: {dept}"})
        if status not in allowed_status:
            details.append({"field": "status", "message": f"status is not allowed: {status}"})
        if not isinstance(unload_times, list) or not unload_times:
            details.append({"field": "unloadTimes", "message": "unloadTimes must contain at least one time"})
        else:
            for index, value in enumerate(unload_times):
                if not isinstance(value, str) or not TIME_RE.fullmatch(value.strip()):
                    details.append({"field": f"unloadTimes[{index}]", "message": "time format must be HH:mm"})

        if details:
            raise UpstreamValidationError(details)

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
        where = ["s.is_deleted = 'N'"]
        if status:
            where.append(f"s.status_code = {self._quote(status)}")
        if db_type:
            where.append(f"s.db_type = {self._quote(db_type)}")
        normalized_keyword = str(keyword or "").strip().lower()
        if normalized_keyword:
            like = self._quote(f"%{normalized_keyword}%")
            where.append(
                "("
                f"LOWER(COALESCE(s.system_id, '')) LIKE {like} OR "
                f"LOWER(COALESCE(s.system_abbr, '')) LIKE {like} OR "
                f"LOWER(COALESCE(s.system_name, '')) LIKE {like} OR "
                f"LOWER(COALESCE(s.owner_name, '')) LIKE {like} OR "
                f"LOWER(COALESCE(s.dept_name, '')) LIKE {like} OR "
                f"LOWER(COALESCE(s.system_desc, '')) LIKE {like} OR "
                f"EXISTS ("
                f"SELECT 1 FROM {TABLE_UPSTREAM_TIME} ut "
                f"WHERE ut.system_pk = s.system_pk AND ut.is_deleted = 'N' "
                f"AND LOWER(COALESCE(ut.unload_time, '')) LIKE {like}"
                f")"
                ")"
            )
        return where

    def _load_unload_times(self, system_pks, *, purpose, method):
        if not system_pks:
            return {}
        ids_sql = ", ".join(str(int(system_pk)) for system_pk in system_pks)
        rows = self._fetch_rows_logged(
            f"""
SELECT system_pk, unload_time
FROM {TABLE_UPSTREAM_TIME}
WHERE is_deleted = 'N'
  AND system_pk IN ({ids_sql})
ORDER BY system_pk, unload_time
""",
            purpose=purpose,
            method=method,
        )
        grouped = {}
        for row in rows:
            grouped.setdefault(int(row["system_pk"]), []).append(row["unload_time"])
        return grouped

    def _row_to_system(self, row, unload_times=None, include_connection=False):
        system = {
            "upstreamSystemId": int(row["system_pk"]),
            "id": row["system_id"],
            "abbr": row["system_abbr"],
            "name": row["system_name"],
            "dbType": row["db_type"],
            "unloadTimes": list(unload_times or []),
            "status": row["status_code"],
            "owner": row.get("owner_name") or "",
            "dept": row.get("dept_name") or "",
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
            "s.system_pk", "s.system_id", "s.system_abbr", "s.system_name", "s.db_type",
            "s.status_code", "s.owner_name", "s.dept_name", "s.system_desc",
        ]
        if include_connection:
            columns[5:5] = ["s.host_name", "s.db_name", "s.schema_name"]
        return ",\n  ".join(columns)

    def _db_systems(self, keyword=None, status=None, db_type=None, page=None, page_size=None):
        paginate = page is not None or page_size is not None
        page, page_size = self._resolve_paging(page=page, page_size=page_size)
        offset = (page - 1) * page_size
        where = self._build_system_where(keyword=keyword, status=status, db_type=db_type)
        where_sql = " AND ".join(where)
        sql = f"""
SELECT
  {self._system_select()}
FROM {TABLE_UPSTREAM_SYSTEM} s
WHERE {where_sql}
ORDER BY s.system_abbr, s.system_id
"""
        if paginate:
            sql += f"\nLIMIT {page_size} OFFSET {offset}"
        rows = self._fetch_rows_logged(
            sql,
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
        return [self._row_to_system(row, unload_times_by_pk.get(int(row["system_pk"]), [])) for row in rows]

    def _get_system_row(self, system_id, include_connection=False):
        safe_system_id = self._quote(str(system_id or "").strip())
        sql = f"""
SELECT
  {self._system_select(include_connection)}
FROM {TABLE_UPSTREAM_SYSTEM} s
WHERE s.is_deleted = 'N'
  AND s.system_id = {safe_system_id}
LIMIT 1
"""
        rows = self._fetch_rows_logged(sql, purpose="upstream system detail", method="_get_system_row")
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
                unload_times.get(int(row["system_pk"]), []),
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
            f"SELECT system_pk FROM {TABLE_UPSTREAM_SYSTEM} WHERE system_id = {self._quote(item['id'])} AND is_deleted = 'N' LIMIT 1",
            purpose="upstream uniqueness check",
            method="_create_system",
        ):
            raise UpstreamSystemAlreadyExistsError(item["id"])

        system_pk = self._next_id(TABLE_UPSTREAM_SYSTEM, "system_pk")
        data_source_id = self._next_id("dwp.p_data_source", "source_id")
        time_pk = self._next_id(TABLE_UPSTREAM_TIME, "time_pk")
        change_id = self._next_id(TABLE_UPSTREAM_CHANGE_LOG, "change_id")
        statements = [
            f"""
INSERT INTO dwp.p_data_source (
  source_id, source_code, source_name, source_type, description_text,
  status_code, created_by, updated_by
) VALUES (
  {data_source_id}, {self._quote(item['id'])}, {self._quote(item['name'])},
  {self._quote(item['dbType'])}, {self._quote(item['desc'])},
  {self._quote(item['status'])}, {self._quote(self._default_operator)},
  {self._quote(self._default_operator)}
)
""".strip(),
            f"""
INSERT INTO {TABLE_UPSTREAM_SYSTEM} (
  system_pk, data_source_id, system_id, system_abbr, system_name, db_type, host_name, db_name, schema_name,
  status_code, owner_name, dept_name, system_desc, unload_count, created_by, updated_by
) VALUES (
  {system_pk}, {data_source_id}, {self._quote(item['id'])}, {self._quote(item['abbr'])}, {self._quote(item['name'])},
  {self._quote(item['dbType'])}, {self._quote(item['host'])}, {self._quote(item['db'])}, {self._quote(item['schema'])},
  {self._quote(item['status'])}, {self._quote(item['owner'])}, {self._quote(item['dept'])}, {self._quote(item['desc'])},
  {len(item['unloadTimes'])}, {self._quote(self._default_operator)}, {self._quote(self._default_operator)}
)
""".strip()
        ]
        for index, value in enumerate(item["unloadTimes"], start=1):
            statements.append(
                f"""
INSERT INTO {TABLE_UPSTREAM_TIME} (
  time_pk, system_pk, unload_time, display_order, created_by, updated_by
) VALUES (
  {time_pk + index - 1}, {system_pk}, {self._quote(value)}, {index},
  {self._quote(self._default_operator)}, {self._quote(self._default_operator)}
)
""".strip()
            )
        statements.append(
            f"""
INSERT INTO {TABLE_UPSTREAM_CHANGE_LOG} (
  change_id, system_pk, system_id, change_type, change_summary, after_json, operator_name
) VALUES (
  {change_id}, {system_pk}, {self._quote(item['id'])}, 'CREATE_SYSTEM', 'create upstream system',
  {self._quote(json.dumps(item, ensure_ascii=False))}, {self._quote(self._default_operator)}
)
""".strip()
        )
        self._execute(statements)
        return item

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
        # Must not open a nested database_transaction: callers run under audit().
        current = self._load_system_detail(
            system_id,
            include_connection=True,
            purpose="upstream admin detail unload times",
            method="_update_system",
        )
        item = self._normalize_payload(payload, current=current)
        rows = self._fetch_rows_logged(
            f"SELECT system_pk, data_source_id FROM {TABLE_UPSTREAM_SYSTEM} WHERE system_id = {self._quote(system_id)} AND is_deleted = 'N' LIMIT 1",
            purpose="upstream system id lookup",
            method="_update_system",
        )
        if not rows:
            raise UpstreamSystemNotFoundError(system_id)
        if item["id"] != system_id and self._fetch_rows_logged(
            f"SELECT system_pk FROM {TABLE_UPSTREAM_SYSTEM} WHERE system_id = {self._quote(item['id'])} AND is_deleted = 'N' LIMIT 1",
            purpose="upstream uniqueness check",
            method="_update_system",
        ):
            raise UpstreamSystemAlreadyExistsError(item["id"])
        system_pk = int(rows[0]["system_pk"])
        data_source_id = int(rows[0]["data_source_id"])
        time_pk = self._next_id(TABLE_UPSTREAM_TIME, "time_pk")
        change_id = self._next_id(TABLE_UPSTREAM_CHANGE_LOG, "change_id")
        statements = [
            f"""
UPDATE dwp.p_data_source
SET source_code = {self._quote(item['id'])},
    source_name = {self._quote(item['name'])},
    source_type = {self._quote(item['dbType'])},
    description_text = {self._quote(item['desc'])},
    status_code = {self._quote(item['status'])},
    updated_by = {self._quote(self._default_operator)},
    updated_at = CURRENT_TIMESTAMP
WHERE source_id = {data_source_id}
""".strip(),
            f"""
UPDATE {TABLE_UPSTREAM_SYSTEM}
SET
  system_id = {self._quote(item['id'])},
  system_abbr = {self._quote(item['abbr'])},
  system_name = {self._quote(item['name'])},
  db_type = {self._quote(item['dbType'])},
  host_name = {self._quote(item['host'])},
  db_name = {self._quote(item['db'])},
  schema_name = {self._quote(item['schema'])},
  status_code = {self._quote(item['status'])},
  owner_name = {self._quote(item['owner'])},
  dept_name = {self._quote(item['dept'])},
  system_desc = {self._quote(item['desc'])},
  unload_count = {len(item['unloadTimes'])},
  updated_by = {self._quote(self._default_operator)},
  updated_at = CURRENT_TIMESTAMP
WHERE system_pk = {system_pk}
""".strip(),
            f"DELETE FROM {TABLE_UPSTREAM_TIME} WHERE system_pk = {system_pk}",
        ]
        for index, value in enumerate(item["unloadTimes"], start=1):
            statements.append(
                f"""
INSERT INTO {TABLE_UPSTREAM_TIME} (
  time_pk, system_pk, unload_time, display_order, created_by, updated_by
) VALUES (
  {time_pk + index - 1}, {system_pk}, {self._quote(value)}, {index},
  {self._quote(self._default_operator)}, {self._quote(self._default_operator)}
)
""".strip()
            )
        statements.append(
            f"""
INSERT INTO {TABLE_UPSTREAM_CHANGE_LOG} (
  change_id, system_pk, system_id, change_type, change_summary, before_json, after_json, operator_name
) VALUES (
  {change_id}, {system_pk}, {self._quote(item['id'])}, 'UPDATE_SYSTEM', 'update upstream system',
  {self._quote(json.dumps(current, ensure_ascii=False))},
  {self._quote(json.dumps(item, ensure_ascii=False))},
  {self._quote(self._default_operator)}
)
""".strip()
        )
        self._execute(statements)
        return current, item

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
                f"SELECT system_pk FROM {TABLE_UPSTREAM_SYSTEM} WHERE system_id = {self._quote(system_id)} AND is_deleted = 'N' LIMIT 1",
                purpose="upstream status id lookup",
                method="patch_status",
            )
            if not rows:
                raise UpstreamSystemNotFoundError(system_id)
            system_pk = int(rows[0]["system_pk"])
            item = {**current, "status": normalized}
            change_id = self._next_id(TABLE_UPSTREAM_CHANGE_LOG, "change_id")
            self._execute([
                f"UPDATE {TABLE_UPSTREAM_SYSTEM} SET status_code = {self._quote(normalized)}, updated_by = {self._quote(self._default_operator)}, updated_at = CURRENT_TIMESTAMP WHERE system_pk = {system_pk}",
                f"UPDATE dwp.p_data_source SET status_code = {self._quote(normalized)}, updated_by = {self._quote(self._default_operator)}, updated_at = CURRENT_TIMESTAMP WHERE source_code = {self._quote(system_id)}",
                f"""
INSERT INTO {TABLE_UPSTREAM_CHANGE_LOG} (
  change_id, system_pk, system_id, change_type, change_summary, before_json, after_json, operator_name
) VALUES (
  {change_id}, {system_pk}, {self._quote(system_id)}, 'UPDATE_STATUS', 'update upstream status',
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

    def delete_system(self, system_id):
        with operation_log_service.audit(
            module_name="上游系统",
            operation_type=OPERATION_TYPE_DELETE,
            operation_object=system_id,
            operation_desc="删除上游系统",
        ) as audit:
            audit.before = self._delete_system(system_id)

    def _delete_system(self, system_id):
        rows = self._fetch_rows(f"SELECT system_pk FROM {TABLE_UPSTREAM_SYSTEM} WHERE system_id = {self._quote(system_id)} AND is_deleted = 'N'")
        if not rows:
            raise UpstreamSystemNotFoundError(system_id)
        # Must not open a nested database_transaction: callers run under audit().
        current = self._load_system_detail(
            system_id,
            include_connection=False,
            purpose="upstream detail unload times",
            method="_delete_system",
        )
        system_pk = int(rows[0]["system_pk"])
        change_id = self._next_id(TABLE_UPSTREAM_CHANGE_LOG, "change_id")
        statements = [
            f"DELETE FROM {TABLE_UPSTREAM_TIME} WHERE system_pk = {system_pk}",
            f"DELETE FROM {TABLE_UPSTREAM_SYSTEM} WHERE system_pk = {system_pk}",
            f"""
INSERT INTO {TABLE_UPSTREAM_CHANGE_LOG} (
  change_id, system_pk, system_id, change_type, change_summary, before_json, operator_name
) VALUES (
  {change_id}, {system_pk}, {self._quote(system_id)}, 'DELETE_SYSTEM', 'delete upstream system',
  {self._quote(json.dumps(current, ensure_ascii=False))}, {self._quote(self._default_operator)}
)
""".strip(),
        ]
        self._execute(statements)
        return current


upstream_service = UpstreamService()
