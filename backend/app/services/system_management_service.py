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

import os
import re
import unicodedata
from datetime import datetime

from sqlalchemy import delete, func, insert, select, update

from ..db.gaussdb import execute_sql, fetch_all, resolve_db_profile_name
from ..db.service import CoreAccess
from ..db.tables import admin_user, menu_table
from ..settings import get_default_operator
from .auth_service import build_password_hash
from .common_code_service import common_code_service
from .operation_log_service import (
    OPERATION_TYPE_CREATE,
    OPERATION_TYPE_DELETE,
    OPERATION_TYPE_DISABLE,
    OPERATION_TYPE_ENABLE,
    OPERATION_TYPE_RESET_PASSWORD,
    OPERATION_TYPE_UPDATE,
    operation_log_service,
)


TABLE_ADMIN_USER = "dwp.p_admin_user"
TABLE_CODE_CATEGORY = "dwp.p_code_category"
TABLE_CODE_ITEM = "dwp.p_code_item"
TABLE_MENU = "dwp.p_menu"

USER_STATUSES = {"enabled", "disabled"}
USER_ROLES = {"admin", "maintainer"}
DICT_STATUSES = {"enabled", "disabled"}
MENU_STATUSES = {"enabled", "disabled"}
MENU_NAV_PLACEMENTS = {"primary", "more"}
MAX_USERNAME_LENGTH = 64
DICT_CODE_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,63}$")
MENU_CODE_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_-]{1,31}$")


class SystemManagementError(Exception):
    code = "SYSTEM_MANAGEMENT_ERROR"

    def __init__(self, message: str, details=None):
        self.message = message
        self.details = details
        super().__init__(message)

    def to_dict(self):
        data = {"code": self.code, "message": self.message}
        if self.details is not None:
            data["details"] = self.details
        return data


class SystemValidationError(SystemManagementError):
    code = "SYSTEM_VALIDATION_FAILED"


class SystemDataSourceError(SystemManagementError):
    code = "SYSTEM_DATA_SOURCE_ERROR"


class SystemUserNotFoundError(SystemManagementError):
    code = "SYSTEM_USER_NOT_FOUND"


class SystemUserAlreadyExistsError(SystemManagementError):
    code = "SYSTEM_USER_ALREADY_EXISTS"


class ParamDictNotFoundError(SystemManagementError):
    code = "PARAM_DICT_NOT_FOUND"


class ParamDictAlreadyExistsError(SystemManagementError):
    code = "PARAM_DICT_ALREADY_EXISTS"


class ParamCategoryNotFoundError(SystemManagementError):
    code = "PARAM_CATEGORY_NOT_FOUND"


class MenuNotFoundError(SystemManagementError):
    code = "MENU_NOT_FOUND"


class MenuAlreadyExistsError(SystemManagementError):
    code = "MENU_ALREADY_EXISTS"


class SystemManagementService:
    def __init__(self):
        self._db_profile = os.getenv("ASSET_DB_PROFILE", "").strip()
        self._default_operator = get_default_operator()
        self._core = CoreAccess(
            profile_getter=lambda: self._db_profile,
            error_factory=SystemDataSourceError,
        )

    def _profile(self):
        return self._db_profile or resolve_db_profile_name()

    def _fetch_rows(self, sql: str, params=None):
        try:
            columns, rows = fetch_all(self._profile(), sql, params=params)
        except FileNotFoundError as error:
            raise SystemDataSourceError("数据库配置文件不存在") from error
        except KeyError as error:
            raise SystemDataSourceError("数据库服务暂不可用，请稍后重试") from error
        except RuntimeError as error:
            raise SystemDataSourceError("数据库服务暂不可用，请稍后重试") from error
        except Exception as error:
            raise SystemDataSourceError("数据库查询失败") from error
        return [dict(zip(columns, row)) for row in rows]

    def _execute(self, sql: str, params=None):
        try:
            return execute_sql(self._profile(), sql, params=params)
        except FileNotFoundError as error:
            raise SystemDataSourceError("数据库配置文件不存在") from error
        except KeyError as error:
            raise SystemDataSourceError("数据库服务暂不可用，请稍后重试") from error
        except RuntimeError as error:
            raise SystemDataSourceError("数据库服务暂不可用，请稍后重试") from error
        except Exception as error:
            raise SystemDataSourceError("数据库执行失败") from error

    def _core_fetch(self, statement):
        return self._core.fetch_rows(statement)

    def _core_execute(self, statements):
        return self._core.execute_statements(statements)

    def _core_next_pk(self):
        return self._core.next_pk(admin_user, admin_user.c.id)

    def _now_text(self):
        return datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    def _next_pk(self, table_name: str, id_column: str):
        rows = self._fetch_rows(f"SELECT COALESCE(MAX({id_column}), 0) + 1 AS next_id FROM {table_name}")
        return int(rows[0]["next_id"])

    def _parse_item_id(self, dict_id: str):
        value = str(dict_id or "").strip()
        if not value.isdigit():
            raise ParamDictNotFoundError(f"Parameter not found: {dict_id}")
        return int(value)

    def _normalize_user_status(self, status: str):
        value = str(status or "").strip().lower()
        if value not in USER_STATUSES:
            raise SystemValidationError("User validation failed", [{"field": "status", "message": "status is invalid"}])
        return value

    def _db_status_to_user_status(self, status: str):
        mapping = {"ACTIVE": "enabled", "DISABLED": "disabled"}
        return mapping.get(str(status or "").upper(), "disabled")

    def _user_status_to_db_status(self, status: str):
        mapping = {"enabled": "ACTIVE", "disabled": "DISABLED"}
        return mapping[self._normalize_user_status(status)]

    def _normalize_user_payload(self, payload: dict):
        if not isinstance(payload, dict):
            raise SystemValidationError("User validation failed", [{"field": "body", "message": "Request body must be a JSON object"}])
        details = []
        username = str(payload.get("username") or "").strip()
        display_name = str(payload.get("displayName") or "").strip()
        status = str(payload.get("status") or "").strip().lower()
        role = str(payload.get("role") or "admin").strip().lower()
        email = str(payload.get("email") or "").strip()
        remark = str(payload.get("remark") or "").strip()

        if not username:
            details.append({"field": "username", "message": "username is required"})
        elif len(username) > MAX_USERNAME_LENGTH:
            details.append({"field": "username", "message": "username is too long"})
        elif any(unicodedata.category(char) == "Cc" for char in username):
            details.append({"field": "username", "message": "username contains control characters"})
        if not display_name:
            details.append({"field": "displayName", "message": "displayName is required"})
        if status not in USER_STATUSES:
            details.append({"field": "status", "message": "status is invalid"})
        if role not in USER_ROLES:
            details.append({"field": "role", "message": "role is invalid"})
        if details:
            raise SystemValidationError("User validation failed", details)

        return {
            "username": username,
            "displayName": display_name,
            "status": status,
            "role": role,
            "email": email,
            "remark": remark,
        }

    def _normalize_param_payload(self, payload: dict):
        if not isinstance(payload, dict):
            raise SystemValidationError("Parameter validation failed", [{"field": "body", "message": "Request body must be a JSON object"}])
        details = []
        category_code = str(payload.get("categoryCode") or "").strip().upper()
        code = str(payload.get("code") or "").strip().upper()
        name = str(payload.get("name") or "").strip()
        value = str(payload.get("value") or "").strip()
        status = str(payload.get("status") or "").strip().lower()
        desc = str(payload.get("desc") or "").strip()

        if not category_code:
            details.append({"field": "categoryCode", "message": "categoryCode is required"})
        elif not DICT_CODE_RE.fullmatch(category_code):
            details.append({"field": "categoryCode", "message": "categoryCode format is invalid"})
        if not code:
            details.append({"field": "code", "message": "code is required"})
        elif not DICT_CODE_RE.fullmatch(code):
            details.append({"field": "code", "message": "code format is invalid"})
        if not name:
            details.append({"field": "name", "message": "name is required"})
        if not value:
            details.append({"field": "value", "message": "value is required"})
        if status not in DICT_STATUSES:
            details.append({"field": "status", "message": "status is invalid"})
        if details:
            raise SystemValidationError("Parameter validation failed", details)

        return {
            "categoryCode": category_code,
            "code": code,
            "name": name,
            "value": value,
            "status": status,
            "desc": desc,
        }

    def _ensure_db_category_exists(self, category_code: str):
        rows = self._fetch_rows(
            f"SELECT category_id FROM {TABLE_CODE_CATEGORY} WHERE category_code = ? LIMIT 1",
            [category_code],
        )
        if not rows:
            raise ParamCategoryNotFoundError(f"Parameter category not found: {category_code}")
        return int(rows[0]["category_id"])

    def get_users(self):
        rows = self._core_fetch(
            select(
                admin_user.c.id,
                admin_user.c.username,
                admin_user.c.display_name,
                admin_user.c.status,
                admin_user.c.role,
                admin_user.c.last_login_at,
                admin_user.c.created_at,
            ).order_by(admin_user.c.created_at.desc(), admin_user.c.username)
        )
        return [
            {
                "id": f"USR{int(row['id']):03d}",
                "username": row["username"],
                "displayName": row.get("display_name") or row["username"],
                "status": self._db_status_to_user_status(row.get("status")),
                "role": row.get("role") if row.get("role") in USER_ROLES else "admin",
                "lastLoginAt": str(row.get("last_login_at") or ""),
                "createdAt": str(row.get("created_at") or ""),
                "email": "",
                "remark": "",
            }
            for row in rows
        ]

    def create_user(self, payload):
        with operation_log_service.audit(
            module_name="用户管理",
            operation_type=OPERATION_TYPE_CREATE,
            operation_object=str((payload or {}).get("username") or "") if isinstance(payload, dict) else "",
            operation_desc="新增用户",
        ) as audit:
            result = self._create_user(payload)
            audit.operation_object = (result or {}).get("username") or audit.operation_object
            audit.after = result
            return result

    def _create_user(self, payload):
        user = self._normalize_user_payload(payload)
        existing = self._core_fetch(
            select(admin_user.c.id).where(admin_user.c.username == user["username"])
        )
        if existing:
            raise SystemUserAlreadyExistsError(f"User already exists: {user['username']}")

        next_id = self._core_next_pk()
        self._core_execute([
            insert(admin_user).values(
                id=next_id,
                username=user["username"],
                password_hash=build_password_hash(user["username"]),
                display_name=user["displayName"],
                status=self._user_status_to_db_status(user["status"]),
                role=user["role"],
            )
        ])
        return next((item for item in self.get_users() if item["username"] == user["username"]), None)

    def update_user(self, username: str, payload):
        with operation_log_service.audit(
            module_name="用户管理",
            operation_type=OPERATION_TYPE_UPDATE,
            operation_object=username,
            operation_desc="编辑用户",
        ) as audit:
            after, before, new_username = self._update_user(username, payload)
            audit.operation_object = new_username
            audit.before = before
            audit.after = after
            return after

    def _update_user(self, username: str, payload):
        user = self._normalize_user_payload(payload)
        rows = self._core_fetch(
            select(admin_user.c.id, admin_user.c.role).where(admin_user.c.username == username)
        )
        if not rows:
            raise SystemUserNotFoundError(f"User not found: {username}")
        before = next((item for item in self.get_users() if item["username"] == username), None)
        if user["username"] != username:
            duplicate = self._core_fetch(
                select(admin_user.c.id).where(admin_user.c.username == user["username"])
            )
            if duplicate:
                raise SystemUserAlreadyExistsError(f"User already exists: {user['username']}")
        if rows[0].get("role") == "admin" and user["role"] != "admin":
            self._ensure_administrator_remains(exclude_username=username)

        self._core_execute([
            update(admin_user)
            .where(admin_user.c.id == int(rows[0]["id"]))
            .values(
                username=user["username"],
                display_name=user["displayName"],
                status=self._user_status_to_db_status(user["status"]),
                role=user["role"],
                updated_at=func.current_timestamp(),
            )
        ])
        after = next((item for item in self.get_users() if item["username"] == user["username"]), None)
        return after, before, user["username"]

    def update_user_status(self, username: str, status: str):
        operation_type = OPERATION_TYPE_ENABLE if str(status).strip().lower() == "enabled" else OPERATION_TYPE_DISABLE
        with operation_log_service.audit(
            module_name="用户管理",
            operation_type=operation_type,
            operation_object=username,
            operation_desc=f"{operation_type}用户",
        ) as audit:
            before = next((item for item in self.get_users() if item["username"] == username), None)
            after = self._update_user_status(username, status)
            audit.before = before
            audit.after = after
            return after

    def _update_user_status(self, username: str, status: str):
        user = next((item for item in self.get_users() if item["username"] == username), None)
        if not user:
            raise SystemUserNotFoundError(f"User not found: {username}")
        normalized = self._user_status_to_db_status(status)
        if user["role"] == "admin" and normalized != "ACTIVE":
            self._ensure_administrator_remains(exclude_username=username)
        self._core_execute([
            update(admin_user)
            .where(admin_user.c.username == username)
            .values(status=normalized, updated_at=func.current_timestamp())
        ])
        user = next((item for item in self.get_users() if item["username"] == username), None)
        if not user:
            raise SystemUserNotFoundError(f"User not found: {username}")
        return user

    def reset_user_password(self, username: str):
        with operation_log_service.audit(
            module_name="用户管理",
            operation_type=OPERATION_TYPE_RESET_PASSWORD,
            operation_object=username,
            operation_desc="重置用户密码",
        ) as audit:
            rows = self._core_fetch(
                select(admin_user.c.id, admin_user.c.username).where(admin_user.c.username == username)
            )
            if not rows:
                raise SystemUserNotFoundError(f"User not found: {username}")
            target_id = int(rows[0]["id"])
            current_username = str(rows[0]["username"] or "").strip()
            self._core_execute([
                update(admin_user)
                .where(admin_user.c.id == target_id)
                .values(
                    password_hash=build_password_hash(current_username),
                    updated_at=func.current_timestamp(),
                )
            ])
            audit.operation_object = current_username
            audit.after = {
                "targetUserId": target_id,
                "targetUsername": current_username,
                "result": "success",
            }
            return {"username": current_username, "resetAt": self._now_text()}

    def delete_user(self, username: str):
        with operation_log_service.audit(
            module_name="用户管理",
            operation_type=OPERATION_TYPE_DELETE,
            operation_object=username,
            operation_desc="删除用户",
        ) as audit:
            audit.before = self._delete_user(username)

    def _delete_user(self, username: str):
        rows = self._core_fetch(
            select(admin_user.c.id).where(admin_user.c.username == username)
        )
        if not rows:
            raise SystemUserNotFoundError(f"User not found: {username}")
        before = next((item for item in self.get_users() if item["username"] == username), None)
        if before and before["role"] == "admin":
            self._ensure_administrator_remains(exclude_username=username)
        self._core_execute([
            delete(admin_user).where(admin_user.c.id == int(rows[0]["id"]))
        ])
        return before

    def _ensure_administrator_remains(self, exclude_username: str):
        rows = self._core_fetch(
            select(func.count().label("count"))
            .select_from(admin_user)
            .where(
                admin_user.c.role == "admin",
                admin_user.c.status == "ACTIVE",
                admin_user.c.username != exclude_username,
            )
        )
        if not rows or int(rows[0].get("count") or 0) < 1:
            raise SystemValidationError("User validation failed", [{"field": "role", "message": "at least one active administrator must remain"}])

    def get_param_dict_categories(self):
        rows = self._fetch_rows(
            f"""
SELECT
  c.category_code,
  c.category_name,
  c.category_desc,
  c.is_active,
  COUNT(i.item_id) AS item_count
FROM {TABLE_CODE_CATEGORY} c
LEFT JOIN {TABLE_CODE_ITEM} i
  ON c.category_code = i.category_code
GROUP BY c.category_code, c.category_name, c.category_desc, c.is_active, c.display_order
ORDER BY c.display_order, c.category_code
""".strip()
        )
        return [
            {
                "code": row["category_code"],
                "name": row["category_name"],
                "desc": row.get("category_desc") or "",
                "status": "enabled" if str(row.get("is_active") or "").upper() == "Y" else "disabled",
                "count": int(row.get("item_count") or 0),
            }
            for row in rows
        ]

    def get_param_dicts(self, category_code: str | None = None):
        where = []
        params = []
        if category_code:
            where.append("i.category_code = ?")
            params.append(category_code)
        where_sql = f"WHERE {' AND '.join(where)}" if where else ""
        rows = self._fetch_rows(
            f"""
SELECT
  i.item_id,
  i.category_code,
  c.category_name,
  i.item_code,
  i.item_name,
  i.item_value,
  i.item_desc,
  i.is_active,
  i.updated_at
FROM {TABLE_CODE_ITEM} i
JOIN {TABLE_CODE_CATEGORY} c
  ON c.category_code = i.category_code
{where_sql}
ORDER BY i.category_code, i.display_order, i.item_code
""".strip(),
            params,
        )
        return [
            {
                "id": str(row["item_id"]),
                "categoryCode": row["category_code"],
                "categoryName": row["category_name"],
                "code": row["item_code"],
                "name": row["item_name"],
                "value": row.get("item_value") or row["item_name"],
                "status": "enabled" if str(row.get("is_active") or "").upper() == "Y" else "disabled",
                "updatedAt": str(row.get("updated_at") or ""),
                "desc": row.get("item_desc") or "",
            }
            for row in rows
        ]

    def create_param_dict(self, payload):
        with operation_log_service.audit(
            module_name="参数字典",
            operation_type=OPERATION_TYPE_CREATE,
            operation_object="",
            operation_desc="新增参数字典",
        ) as audit:
            result = self._create_param_dict(payload)
            if result:
                audit.operation_object = f"{result['categoryCode']}/{result['code']}"
            audit.after = result
            return result

    def _create_param_dict(self, payload):
        item = self._normalize_param_payload(payload)
        self._ensure_db_category_exists(item["categoryCode"])
        duplicate = self._fetch_rows(
            f"""
SELECT 1
FROM {TABLE_CODE_ITEM}
WHERE category_code = ?
  AND item_code = ?
LIMIT 1
""".strip(),
            [item["categoryCode"], item["code"]],
        )
        if duplicate:
            raise ParamDictAlreadyExistsError(f"Parameter already exists: {item['categoryCode']}/{item['code']}")

        next_id = self._next_pk(TABLE_CODE_ITEM, "item_id")
        self._execute(
            f"""
INSERT INTO {TABLE_CODE_ITEM} (
  item_id, category_code, item_code, item_name, item_value, item_desc, display_order, is_active, created_by, updated_by
) VALUES (
  ?, ?, ?, ?, ?, ?, 999, ?, ?, ?
)
""".strip(),
            [
                next_id,
                item["categoryCode"],
                item["code"],
                item["name"],
                item["value"],
                item["desc"],
                "Y" if item["status"] == "enabled" else "N",
                self._default_operator,
                self._default_operator,
            ],
        )
        result = next((current for current in self.get_param_dicts(item["categoryCode"]) if current["id"] == str(next_id)), None)
        common_code_service.invalidate([item["categoryCode"]])
        return result

    def update_param_dict(self, dict_id: str, payload):
        with operation_log_service.audit(
            module_name="参数字典",
            operation_type=OPERATION_TYPE_UPDATE,
            operation_object=str(dict_id),
            operation_desc="编辑参数字典",
        ) as audit:
            after, before, operation_object = self._update_param_dict(dict_id, payload)
            audit.operation_object = operation_object
            audit.before = before
            audit.after = after
            return after

    def _update_param_dict(self, dict_id: str, payload):
        item = self._normalize_param_payload(payload)
        self._ensure_db_category_exists(item["categoryCode"])
        item_id = self._parse_item_id(dict_id)
        rows = self._fetch_rows(f"SELECT item_id FROM {TABLE_CODE_ITEM} WHERE item_id = ? LIMIT 1", [item_id])
        if not rows:
            raise ParamDictNotFoundError(f"Parameter not found: {dict_id}")
        before = next((current for current in self.get_param_dicts() if current["id"] == str(item_id)), None)
        duplicate = self._fetch_rows(
            f"""
SELECT item_id
FROM {TABLE_CODE_ITEM}
WHERE category_code = ?
  AND item_code = ?
  AND item_id <> ?
LIMIT 1
""".strip(),
            [item["categoryCode"], item["code"], item_id],
        )
        if duplicate:
            raise ParamDictAlreadyExistsError(f"Parameter already exists: {item['categoryCode']}/{item['code']}")
        self._execute(
            f"""
UPDATE {TABLE_CODE_ITEM}
SET
  category_code = ?,
  item_code = ?,
  item_name = ?,
  item_value = ?,
  item_desc = ?,
  is_active = ?,
  updated_by = ?,
  updated_at = CURRENT_TIMESTAMP
WHERE item_id = ?
""".strip(),
            [
                item["categoryCode"],
                item["code"],
                item["name"],
                item["value"],
                item["desc"],
                "Y" if item["status"] == "enabled" else "N",
                self._default_operator,
                item_id,
            ],
        )
        after = next((current for current in self.get_param_dicts(item["categoryCode"]) if current["id"] == str(item_id)), None)
        common_code_service.invalidate([
            (before or {}).get("categoryCode"),
            item["categoryCode"],
        ])
        return after, before, f"{item['categoryCode']}/{item['code']}"

    def update_param_dict_status(self, dict_id: str, status: str):
        operation_type = OPERATION_TYPE_ENABLE if str(status).strip().lower() == "enabled" else OPERATION_TYPE_DISABLE
        with operation_log_service.audit(
            module_name="参数字典",
            operation_type=operation_type,
            operation_object=str(dict_id),
            operation_desc=f"{operation_type}参数字典",
        ) as audit:
            before = next((item for item in self.get_param_dicts() if item["id"] == str(dict_id).strip()), None)
            after = self._update_param_dict_status(dict_id, status)
            audit.operation_object = f"{after['categoryCode']}/{after['code']}"
            audit.before = before
            audit.after = after
            return after

    def _update_param_dict_status(self, dict_id: str, status: str):
        normalized = str(status or "").strip().lower()
        if normalized not in DICT_STATUSES:
            raise SystemValidationError("Parameter validation failed", [{"field": "status", "message": "status is invalid"}])
        item_id = self._parse_item_id(dict_id)
        self._execute(
            f"""
UPDATE {TABLE_CODE_ITEM}
SET is_active = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
WHERE item_id = ?
""".strip(),
            ["Y" if normalized == "enabled" else "N", self._default_operator, item_id],
        )
        current = next((item for item in self.get_param_dicts() if item["id"] == str(item_id)), None)
        if not current:
            raise ParamDictNotFoundError(f"Parameter not found: {dict_id}")
        common_code_service.invalidate([current["categoryCode"]])
        return current

    def delete_param_dict(self, dict_id: str):
        with operation_log_service.audit(
            module_name="参数字典",
            operation_type=OPERATION_TYPE_DELETE,
            operation_object=str(dict_id),
            operation_desc="删除参数字典",
        ) as audit:
            before = self._delete_param_dict(dict_id)
            audit.operation_object = (before or {}).get("code") or str(dict_id)
            audit.before = before

    def _delete_param_dict(self, dict_id: str):
        item_id = self._parse_item_id(dict_id)
        rows = self._fetch_rows(f"SELECT item_id FROM {TABLE_CODE_ITEM} WHERE item_id = ? LIMIT 1", [item_id])
        if not rows:
            raise ParamDictNotFoundError(f"Parameter not found: {dict_id}")
        before = next((current for current in self.get_param_dicts() if current["id"] == str(item_id)), None)
        self._execute(f"DELETE FROM {TABLE_CODE_ITEM} WHERE item_id = ?", [item_id])
        common_code_service.invalidate([(before or {}).get("categoryCode")])
        return before

    def update_param_category_status(self, category_code: str, status: str):
        operation_type = OPERATION_TYPE_ENABLE if str(status).strip().lower() == "enabled" else OPERATION_TYPE_DISABLE
        with operation_log_service.audit(
            module_name="参数字典",
            operation_type=operation_type,
            operation_object=category_code,
            operation_desc=f"{operation_type}参数分类",
        ) as audit:
            before = next((item for item in self.get_param_dict_categories() if item["code"] == category_code), None)
            after = self._update_param_category_status(category_code, status)
            audit.before = before
            audit.after = after
            return after

    def _parse_menu_id(self, menu_id: str):
        value = str(menu_id or "").strip()
        if not value.isdigit():
            raise MenuNotFoundError(f"Menu not found: {menu_id}")
        return int(value)

    def _normalize_menu_payload(self, payload: dict, *, require_order: bool = True):
        if not isinstance(payload, dict):
            raise SystemValidationError("Menu validation failed", [{"field": "body", "message": "Request body must be a JSON object"}])
        details = []
        code = str(payload.get("code") or "").strip()
        name = str(payload.get("name") or "").strip()
        icon = str(payload.get("icon") or "").strip() or "grid"
        path = str(payload.get("path") or "").strip()
        desc = str(payload.get("desc") or "").strip()
        status = str(payload.get("status") or "").strip().lower()
        nav_placement = str(payload.get("navPlacement") or "more").strip().lower()
        admin_only = bool(payload.get("adminOnly"))

        if not code:
            details.append({"field": "code", "message": "code is required"})
        elif not MENU_CODE_RE.fullmatch(code):
            details.append({"field": "code", "message": "code format is invalid"})
        if not name:
            details.append({"field": "name", "message": "name is required"})
        if status not in MENU_STATUSES:
            details.append({"field": "status", "message": "status is invalid"})
        if nav_placement not in MENU_NAV_PLACEMENTS:
            details.append({"field": "navPlacement", "message": "navPlacement is invalid"})

        order = payload.get("order")
        normalized_order = None
        if order is not None and str(order).strip() != "":
            try:
                normalized_order = int(order)
                if normalized_order < 0:
                    raise ValueError
            except (TypeError, ValueError):
                details.append({"field": "order", "message": "order must be a non-negative integer"})
        elif require_order:
            normalized_order = None

        if details:
            raise SystemValidationError("Menu validation failed", details)

        return {
            "code": code,
            "name": name,
            "icon": icon,
            "path": path,
            "order": normalized_order,
            "navPlacement": nav_placement,
            "adminOnly": admin_only,
            "status": status,
            "desc": desc,
        }

    def get_menus(self):
        rows = self._core_fetch(
            select(
                menu_table.c.menu_id,
                menu_table.c.menu_code,
                menu_table.c.menu_name,
                menu_table.c.menu_icon,
                menu_table.c.menu_path,
                menu_table.c.display_order,
                menu_table.c.nav_placement,
                menu_table.c.admin_only,
                menu_table.c.is_active,
                menu_table.c.menu_desc,
                menu_table.c.updated_at,
            ).order_by(menu_table.c.display_order, menu_table.c.menu_id)
        )
        return [
            {
                "id": str(row["menu_id"]),
                "code": row["menu_code"],
                "name": row["menu_name"],
                "icon": self._normalize_menu_icon(row.get("menu_code"), row.get("menu_icon")),
                "path": row.get("menu_path") or "",
                "order": int(row.get("display_order") or 0),
                "navPlacement": str(row.get("nav_placement") or "more").lower(),
                "adminOnly": str(row.get("admin_only") or "").upper() == "Y",
                "status": "enabled" if str(row.get("is_active") or "").upper() == "Y" else "disabled",
                "desc": row.get("menu_desc") or "",
                "updatedAt": str(row.get("updated_at") or ""),
            }
            for row in rows
        ]

    def get_enabled_menu_codes(self):
        return {
            str(item.get("code") or "").strip()
            for item in self.get_menus()
            if str(item.get("status") or "").strip().lower() == "enabled"
        }

    def is_menu_enabled(self, menu_code: str):
        code = str(menu_code or "").strip()
        return bool(code) and code in self.get_enabled_menu_codes()

    @staticmethod
    def _normalize_menu_icon(menu_code, menu_icon):
        icon = str(menu_icon or "").strip() or "grid"
        if str(menu_code or "").strip() == "push" and icon == "push":
            return "upload"
        return icon

    def _get_menu(self, menu_id: int):
        return next((item for item in self.get_menus() if item["id"] == str(menu_id)), None)

    def create_menu(self, payload):
        with operation_log_service.audit(
            module_name="菜单管理",
            operation_type=OPERATION_TYPE_CREATE,
            operation_object=str((payload or {}).get("code") or "") if isinstance(payload, dict) else "",
            operation_desc="新增菜单",
        ) as audit:
            result = self._create_menu(payload)
            audit.operation_object = (result or {}).get("code") or audit.operation_object
            audit.after = result
            return result

    def _create_menu(self, payload):
        menu = self._normalize_menu_payload(payload)
        duplicate = self._core_fetch(
            select(menu_table.c.menu_id).where(menu_table.c.menu_code == menu["code"])
        )
        if duplicate:
            raise MenuAlreadyExistsError(f"Menu already exists: {menu['code']}")
        order = menu["order"]
        if order is None:
            rows = self._core_fetch(
                select((func.coalesce(func.max(menu_table.c.display_order), 0) + 10).label("next_order"))
            )
            order = int(rows[0]["next_order"])
        next_id = self._core.next_pk(menu_table, menu_table.c.menu_id)
        self._core_execute([
            insert(menu_table).values(
                menu_id=next_id,
                menu_code=menu["code"],
                menu_name=menu["name"],
                menu_icon=menu["icon"],
                menu_path=menu["path"],
                display_order=int(order),
                nav_placement=menu["navPlacement"],
                admin_only="Y" if menu["adminOnly"] else "N",
                is_active="Y" if menu["status"] == "enabled" else "N",
                menu_desc=menu["desc"],
                created_by=self._default_operator,
                updated_by=self._default_operator,
            )
        ])
        return self._get_menu(next_id)

    def update_menu(self, menu_id: str, payload):
        with operation_log_service.audit(
            module_name="菜单管理",
            operation_type=OPERATION_TYPE_UPDATE,
            operation_object=str(menu_id),
            operation_desc="编辑菜单",
        ) as audit:
            after, before = self._update_menu(menu_id, payload)
            audit.operation_object = (after or {}).get("code") or str(menu_id)
            audit.before = before
            audit.after = after
            return after

    def _update_menu(self, menu_id: str, payload):
        menu = self._normalize_menu_payload(payload, require_order=False)
        item_id = self._parse_menu_id(menu_id)
        before = self._get_menu(item_id)
        if not before:
            raise MenuNotFoundError(f"Menu not found: {menu_id}")
        duplicate = self._core_fetch(
            select(menu_table.c.menu_id).where(
                menu_table.c.menu_code == menu["code"],
                menu_table.c.menu_id != item_id,
            )
        )
        if duplicate:
            raise MenuAlreadyExistsError(f"Menu already exists: {menu['code']}")
        order = before["order"] if menu["order"] is None else menu["order"]
        self._core_execute([
            update(menu_table)
            .where(menu_table.c.menu_id == item_id)
            .values(
                menu_code=menu["code"],
                menu_name=menu["name"],
                menu_icon=menu["icon"],
                menu_path=menu["path"],
                display_order=int(order),
                nav_placement=menu["navPlacement"],
                admin_only="Y" if menu["adminOnly"] else "N",
                is_active="Y" if menu["status"] == "enabled" else "N",
                menu_desc=menu["desc"],
                updated_by=self._default_operator,
                updated_at=func.current_timestamp(),
            )
        ])
        return self._get_menu(item_id), before

    def update_menu_status(self, menu_id: str, status: str):
        operation_type = OPERATION_TYPE_ENABLE if str(status).strip().lower() == "enabled" else OPERATION_TYPE_DISABLE
        with operation_log_service.audit(
            module_name="菜单管理",
            operation_type=operation_type,
            operation_object=str(menu_id),
            operation_desc=f"{operation_type}菜单",
        ) as audit:
            before = self._get_menu(self._parse_menu_id(menu_id))
            after = self._update_menu_status(menu_id, status)
            audit.operation_object = after["code"]
            audit.before = before
            audit.after = after
            return after

    def _update_menu_status(self, menu_id: str, status: str):
        normalized = str(status or "").strip().lower()
        if normalized not in MENU_STATUSES:
            raise SystemValidationError("Menu validation failed", [{"field": "status", "message": "status is invalid"}])
        item_id = self._parse_menu_id(menu_id)
        if not self._get_menu(item_id):
            raise MenuNotFoundError(f"Menu not found: {menu_id}")
        self._core_execute([
            update(menu_table)
            .where(menu_table.c.menu_id == item_id)
            .values(
                is_active="Y" if normalized == "enabled" else "N",
                updated_by=self._default_operator,
                updated_at=func.current_timestamp(),
            )
        ])
        return self._get_menu(item_id)

    def move_menu(self, menu_id: str, direction: str):
        normalized = str(direction or "").strip().lower()
        if normalized not in {"up", "down"}:
            raise SystemValidationError("Menu validation failed", [{"field": "direction", "message": "direction is invalid"}])
        item_id = self._parse_menu_id(menu_id)
        menus = self.get_menus()
        index = next((i for i, item in enumerate(menus) if item["id"] == str(item_id)), -1)
        if index < 0:
            raise MenuNotFoundError(f"Menu not found: {menu_id}")
        target = index - 1 if normalized == "up" else index + 1
        if target < 0 or target >= len(menus):
            return menus
        current = menus[index]
        neighbor = menus[target]
        with operation_log_service.audit(
            module_name="菜单管理",
            operation_type=OPERATION_TYPE_UPDATE,
            operation_object=current["code"],
            operation_desc=f"{'上移' if normalized == 'up' else '下移'}菜单",
        ) as audit:
            audit.before = current
            self._core_execute([
                update(menu_table)
                .where(menu_table.c.menu_id == int(current["id"]))
                .values(
                    display_order=int(neighbor["order"]),
                    updated_by=self._default_operator,
                    updated_at=func.current_timestamp(),
                ),
                update(menu_table)
                .where(menu_table.c.menu_id == int(neighbor["id"]))
                .values(
                    display_order=int(current["order"]),
                    updated_by=self._default_operator,
                    updated_at=func.current_timestamp(),
                ),
            ])
            result = self.get_menus()
            audit.after = self._get_menu(item_id)
            return result

    def delete_menu(self, menu_id: str):
        with operation_log_service.audit(
            module_name="菜单管理",
            operation_type=OPERATION_TYPE_DELETE,
            operation_object=str(menu_id),
            operation_desc="删除菜单",
        ) as audit:
            before = self._delete_menu(menu_id)
            audit.operation_object = (before or {}).get("code") or str(menu_id)
            audit.before = before

    def _delete_menu(self, menu_id: str):
        item_id = self._parse_menu_id(menu_id)
        before = self._get_menu(item_id)
        if not before:
            raise MenuNotFoundError(f"Menu not found: {menu_id}")
        self._core_execute([delete(menu_table).where(menu_table.c.menu_id == item_id)])
        return before

    def _update_param_category_status(self, category_code: str, status: str):
        normalized = str(status or "").strip().lower()
        if normalized not in DICT_STATUSES:
            raise SystemValidationError("Category validation failed", [{"field": "status", "message": "status is invalid"}])
        category_id = self._ensure_db_category_exists(category_code)
        self._execute(
            f"""
UPDATE {TABLE_CODE_CATEGORY}
SET is_active = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
WHERE category_id = ?
""".strip(),
            ["Y" if normalized == "enabled" else "N", self._default_operator, category_id],
        )
        current = next((item for item in self.get_param_dict_categories() if item["code"] == category_code), None)
        if not current:
            raise ParamCategoryNotFoundError(f"Parameter category not found: {category_code}")
        common_code_service.invalidate([category_code])
        return current


system_management_service = SystemManagementService()
