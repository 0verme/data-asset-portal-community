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

"""Database-backed current-state repository for the authorization core."""

from __future__ import annotations

import os
import re
from collections.abc import Callable, Iterable
from typing import Any

from ..application.identity import Identity
from ..db.facade import (
    AUTH_PROFILE_ENV,
    DEFAULT_PROFILE_ENV,
    fetch_all,
    get_db_profile,
    load_db_profiles,
    resolve_db_profile_name,
)
from ..db.registry import get_provider
from .core import AuthorizationSubject

_IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_ENABLED_VALUES = frozenset({"Y", "YES", "TRUE", "1", "ACTIVE", "ENABLED"})


def _resolve_auth_profile() -> str:
    profiles = load_db_profiles()
    for env_name in (AUTH_PROFILE_ENV, DEFAULT_PROFILE_ENV):
        value = os.getenv(env_name, "").strip()
        if value and value in profiles:
            return value
    if "primary" in profiles:
        return "primary"
    return resolve_db_profile_name()


def _qualified_table(config: dict[str, Any], table: str) -> str:
    provider = get_provider(config["type"])
    schema = provider.physical_schema(config)
    if not _IDENTIFIER.fullmatch(table):
        raise ValueError(f"unsupported authorization table: {table}")
    if schema:
        if not _IDENTIFIER.fullmatch(str(schema)):
            raise ValueError("database schema must be a simple identifier")
        return f"{schema}.{table}"
    return table


def _enabled(value: Any) -> bool:
    return str(value or "").strip().upper() in _ENABLED_VALUES


class DatabaseAuthorizationRepository:
    """Resolve user status, role status, and mappings from current DB state."""

    def __init__(self, profile_resolver: Callable[[], str] | None = None):
        self._profile_resolver = profile_resolver or _resolve_auth_profile

    def _profile_and_tables(self) -> tuple[str, dict[str, Any], dict[str, str]]:
        profile = self._profile_resolver()
        config = get_db_profile(profile)
        tables = {
            name: _qualified_table(config, name)
            for name in ("p_admin_user", "p_role", "p_role_permission", "p_permission")
        }
        return profile, config, tables

    def get_subject(self, identity: Identity) -> AuthorizationSubject | None:
        if not identity.user:
            return None
        profile, config, tables = self._profile_and_tables()
        placeholder = get_provider(config["type"]).placeholder
        sql = (
            f"SELECT u.username, u.role, u.status, r.enabled "
            f"FROM {tables['p_admin_user']} u "
            f"LEFT JOIN {tables['p_role']} r ON r.role_code = u.role "
            f"WHERE u.username = {placeholder} LIMIT 1"
        )
        _columns, rows = fetch_all(profile, sql, (identity.user,))
        if not rows:
            return None
        username, role_code, status, role_enabled = rows[0]
        return AuthorizationSubject(
            username=str(username),
            role_code=str(role_code) if role_code is not None else None,
            user_enabled=_enabled(status),
            role_enabled=_enabled(role_enabled),
        )

    def get_permissions(self, role_code: str) -> Iterable[str]:
        if not role_code:
            return ()
        profile, config, tables = self._profile_and_tables()
        placeholder = get_provider(config["type"]).placeholder
        sql = (
            f"SELECT rp.permission_code "
            f"FROM {tables['p_role_permission']} rp "
            f"JOIN {tables['p_role']} r ON r.role_code = rp.role_code "
            f"JOIN {tables['p_permission']} p ON p.permission_code = rp.permission_code "
            f"WHERE rp.role_code = {placeholder} AND r.enabled IN ('Y', '1', 'TRUE', 'ACTIVE', 'ENABLED') "
            "ORDER BY rp.permission_code"
        )
        _columns, rows = fetch_all(profile, sql, (role_code,))
        return tuple(str(row[0]) for row in rows if row and row[0])
