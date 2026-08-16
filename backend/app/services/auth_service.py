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

import logging
import os

from werkzeug.security import check_password_hash, generate_password_hash

from ..db.gaussdb import (
    AUTH_PROFILE_ENV,
    DEFAULT_PROFILE_ENV,
    execute_sql,
    fetch_all,
    load_db_profiles,
    resolve_db_profile_name,
)


TABLE_ADMIN_USER = "dwp.p_admin_user"
ADMIN_ROLE = "admin"
MAINTAINER_ROLE = "maintainer"
LOGGER = logging.getLogger(__name__)


class AuthError(Exception):
    code = "AUTH_ERROR"
    status_code = 400

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message

    def to_dict(self):
        return {"code": self.code, "message": self.message}


class AuthValidationError(AuthError):
    code = "INVALID_CREDENTIALS"
    status_code = 401


class AuthDataSourceError(AuthError):
    code = "AUTH_DATA_SOURCE_ERROR"
    status_code = 500


class AuthService:
    def _profile(self) -> str:
        available_profiles = load_db_profiles()

        explicit_profile = os.getenv(AUTH_PROFILE_ENV, "").strip()
        if explicit_profile and explicit_profile in available_profiles:
            return explicit_profile

        default_profile = os.getenv(DEFAULT_PROFILE_ENV, "").strip()
        if default_profile and default_profile in available_profiles:
            return default_profile

        if "primary" in available_profiles:
            return "primary"

        return resolve_db_profile_name()

    def _quote(self, value: str) -> str:
        return "'" + str(value).replace("'", "''") + "'"

    def _fetch_rows(self, sql: str) -> list[dict]:
        selected_profile = self._profile()
        LOGGER.info(
            "Auth query profile resolved to %s (ASSET_AUTH_DB_PROFILE=%s, ASSET_DB_PROFILE=%s)",
            selected_profile,
            os.getenv(AUTH_PROFILE_ENV),
            os.getenv(DEFAULT_PROFILE_ENV),
        )
        try:
            columns, rows = fetch_all(selected_profile, sql)
        except Exception as error:
            raise AuthDataSourceError(f"认证查询失败: {error}") from error
        return [dict(zip(columns, row)) for row in rows]

    def _fetch_user(self, username: str) -> dict | None:
        rows = self._fetch_rows(
            f"""
SELECT username, password_hash, display_name, status, role
FROM {TABLE_ADMIN_USER}
WHERE username = {self._quote(username)}
LIMIT 1
""".strip()
        )
        return rows[0] if rows else None

    def authenticate(self, username: str, password: str) -> dict:
        normalized_user = (username or "").strip()
        if not normalized_user:
            raise AuthValidationError("请输入账号。")
        if not password:
            raise AuthValidationError("请输入密码。")

        user = self._fetch_user(normalized_user)
        if not user or (user.get("status") or "").upper() != "ACTIVE":
            raise AuthValidationError("账号或密码不正确，请重试。")
        if not check_password_hash(user.get("password_hash") or "", password):
            raise AuthValidationError("账号或密码不正确，请重试。")

        try:
            selected_profile = self._profile()
            LOGGER.info("Auth update profile resolved to %s", selected_profile)
            execute_sql(
                selected_profile,
                f"""
UPDATE {TABLE_ADMIN_USER}
SET last_login_at = CURRENT_TIMESTAMP,
    updated_at = CURRENT_TIMESTAMP
WHERE username = {self._quote(normalized_user)}
""".strip(),
            )
        except Exception as error:
            raise AuthDataSourceError(f"更新登录时间失败: {error}") from error

        return {
            "role": user.get("role") if user.get("role") in {ADMIN_ROLE, MAINTAINER_ROLE} else ADMIN_ROLE,
            "user": normalized_user,
            "name": user.get("display_name") or normalized_user,
        }


def build_password_hash(password: str) -> str:
    return generate_password_hash(password)


auth_service = AuthService()
