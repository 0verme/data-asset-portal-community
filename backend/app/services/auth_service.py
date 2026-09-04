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

# pyright: reportMissingImports=false

import logging
import os

from sqlalchemy import func, select, update
from werkzeug.security import check_password_hash, generate_password_hash

from ..db.base import DatabaseConnectionError, redact_sensitive_text
from ..db.facade import AUTH_PROFILE_ENV, DEFAULT_PROFILE_ENV, load_db_profiles, resolve_db_profile_name
from ..db.service import CoreAccess
from ..db.tables import admin_user
from ..settings import get_runtime_debug, get_runtime_environment

ADMIN_ROLE = "admin"
MAINTAINER_ROLE = "maintainer"
LOGGER = logging.getLogger(__name__)

_AUTH_FAILURE_MESSAGES = {
    "configuration": "认证数据库配置异常，请联系管理员。",
    "unavailable": "认证数据源暂不可用，请稍后重试。",
    "query": "认证数据源查询失败，请稍后重试。",
    "execution": "认证数据源写入失败，请稍后重试。",
}
_AUTH_FAILURE_CODES = {
    "configuration": "AUTH_CONFIGURATION_ERROR",
    # Keep the established data-source code for connection failures while
    # using distinct codes for configuration, query, and write failures.
    "unavailable": "AUTH_DATA_SOURCE_ERROR",
    "query": "AUTH_DATA_SOURCE_QUERY_ERROR",
    "execution": "AUTH_DATA_SOURCE_EXECUTION_ERROR",
}
_AUTH_FAILURE_HINTS = {
    "configuration": "检查数据库配置文件路径、认证 profile 及其必填字段。",
    "unavailable": "检查数据库进程、网络连通性和认证 profile。",
    "query": "检查认证表结构、迁移状态和数据库权限。",
    "execution": "检查认证表结构、数据库写权限和事务状态。",
}
_AUTH_FAILURE_CATEGORIES = frozenset(_AUTH_FAILURE_MESSAGES)


def _diagnostic_mode_enabled() -> bool:
    """Expose only business-level diagnostics outside production."""
    return get_runtime_debug() and get_runtime_environment() != "production"


def _exception_chain(error: Exception) -> list[Exception]:
    chain: list[Exception] = []
    current: Exception | None = error
    seen: set[int] = set()
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        chain.append(current)
        cause = current.__cause__ or current.__context__
        current = cause if isinstance(cause, Exception) else None
    return chain


def _is_configuration_failure(error: Exception) -> bool:
    if isinstance(error, (FileNotFoundError, KeyError, ValueError)):
        return True
    if isinstance(error, RuntimeError) and not isinstance(error, DatabaseConnectionError):
        message = str(error).lower()
        return any(
            marker in message
            for marker in (
                "missing required database profile",
                "database profile not found",
                "requires database",
                "requires user",
                "requires password",
                "requires jdbc",
                "requires a positive",
                "requires a safe",
            )
        )
    return False


def _is_connection_failure(error: Exception) -> bool:
    if isinstance(error, (DatabaseConnectionError, ConnectionError, TimeoutError, BrokenPipeError)):
        return True
    if isinstance(error, OSError) and not isinstance(error, FileNotFoundError):
        return True

    error_name = type(error).__name__.lower()
    if error_name in {"interfaceerror", "disconnectionerror", "connectionexception"}:
        return True
    if error_name in {"operationalerror", "databaseerror"}:
        message = str(error).lower()
        return any(
            marker in message
            for marker in ("connect", "connection", "refused", "timeout", "server", "unavailable")
        )
    return False


def _classify_data_source_failure(error: Exception, operation: str) -> str:
    chain = _exception_chain(error)
    if any(_is_configuration_failure(item) for item in chain):
        return "configuration"
    if any(_is_connection_failure(item) for item in chain):
        return "unavailable"
    return "query" if operation == "query" else "execution"


def _root_cause(error: Exception) -> Exception:
    return _exception_chain(error)[-1]


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
    status_code = 503

    def __init__(
        self,
        message: str,
        *,
        category: str = "unavailable",
        cause_type: str | None = None,
    ):
        normalized_category = category if category in _AUTH_FAILURE_CATEGORIES else "unavailable"
        self.category = normalized_category
        self.code = _AUTH_FAILURE_CODES[normalized_category]
        self.cause_type = cause_type or self.__class__.__name__
        # Messages crossing the HTTP boundary are always controlled copies;
        # callers must never be able to place SQL, DSNs, or credentials here.
        super().__init__(_AUTH_FAILURE_MESSAGES[normalized_category])

    def to_dict(self):
        payload = super().to_dict()
        if _diagnostic_mode_enabled():
            payload["details"] = {
                "category": self.category,
                "causeType": self.cause_type,
                "hint": _AUTH_FAILURE_HINTS[self.category],
            }
        return payload


class AuthConfigurationError(AuthDataSourceError):
    def __init__(self, message: str, *, cause_type: str | None = None):
        super().__init__(message, category="configuration", cause_type=cause_type)


class AuthDataSourceUnavailableError(AuthDataSourceError):
    def __init__(self, message: str, *, cause_type: str | None = None):
        super().__init__(message, category="unavailable", cause_type=cause_type)


class AuthQueryError(AuthDataSourceError):
    def __init__(self, message: str, *, cause_type: str | None = None):
        super().__init__(message, category="query", cause_type=cause_type)


class AuthExecutionError(AuthDataSourceError):
    def __init__(self, message: str, *, cause_type: str | None = None):
        super().__init__(message, category="execution", cause_type=cause_type)


class AuthService:
    def __init__(self):
        self._db = CoreAccess(
            profile_getter=self._profile,
            error_factory=AuthDataSourceError,
        )

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

    @staticmethod
    def _map_data_source_error(error: Exception, operation: str) -> AuthDataSourceError:
        category = _classify_data_source_failure(error, operation)
        cause = _root_cause(error)
        cause_type = type(cause).__name__
        safe_reason = redact_sensitive_text(str(cause))
        LOGGER.error(
            "Authentication data source failure: operation=%s category=%s cause=%s reason=%s",
            operation,
            category,
            cause_type,
            safe_reason,
        )
        error_types = {
            "configuration": AuthConfigurationError,
            "unavailable": AuthDataSourceUnavailableError,
            "query": AuthQueryError,
            "execution": AuthExecutionError,
        }
        error_type = error_types[category]
        return error_type(
            _AUTH_FAILURE_MESSAGES[category],
            cause_type=cause_type,
        )

    def _fetch_rows(self, statement) -> list[dict]:
        try:
            selected_profile = self._profile()
            LOGGER.info(
                "Auth query profile resolved to %s (ASSET_AUTH_DB_PROFILE=%s, ASSET_DB_PROFILE=%s)",
                selected_profile,
                os.getenv(AUTH_PROFILE_ENV),
                os.getenv(DEFAULT_PROFILE_ENV),
            )
            return self._db.fetch_rows(statement)
        except Exception as error:
            raise self._map_data_source_error(error, "query") from error

    def _execute(self, statement) -> int:
        try:
            selected_profile = self._profile()
            LOGGER.info(
                "Auth update profile resolved to %s (ASSET_AUTH_DB_PROFILE=%s, ASSET_DB_PROFILE=%s)",
                selected_profile,
                os.getenv(AUTH_PROFILE_ENV),
                os.getenv(DEFAULT_PROFILE_ENV),
            )
            return self._db.execute(statement)
        except Exception as error:
            raise self._map_data_source_error(error, "execution") from error

    def _fetch_user(self, username: str) -> dict | None:
        statement = (
            select(
                admin_user.c.username,
                admin_user.c.password_hash,
                admin_user.c.display_name,
                admin_user.c.status,
                admin_user.c.role,
            )
            .where(admin_user.c.username == username)
            .limit(1)
        )
        rows = self._fetch_rows(statement)
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

        self._execute(
            update(admin_user)
            .where(admin_user.c.username == normalized_user)
            .values(
                last_login_at=func.current_timestamp(),
                updated_at=func.current_timestamp(),
            )
        )

        return {
            # Preserve an unknown role as a constrained identity. The
            # authorization core resolves current role state and fails closed;
            # authentication must never silently upgrade it to admin.
            "role": str(user.get("role") or "").strip().lower(),
            "user": normalized_user,
            "name": user.get("display_name") or normalized_user,
        }


def build_password_hash(password: str) -> str:
    return generate_password_hash(password)


auth_service = AuthService()
