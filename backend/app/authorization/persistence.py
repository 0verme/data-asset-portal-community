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

"""Portable RBAC persistence and deterministic default seed."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from ..db.facade import connect_with_profile, get_db_profile
from ..db.registry import get_provider
from .permissions import (
    ADMIN_ROLE,
    BUILTIN_ROLE_PERMISSION_CODES,
    MAINTAINER_ROLE,
    PERMISSION_CODES,
    PERMISSION_DEFINITIONS,
    validate_permission_registry,
)


ROLE_METADATA = {
    ADMIN_ROLE: ("系统管理员", "Community 内置系统管理员角色。"),
    MAINTAINER_ROLE: ("业务维护员", "兼容现有业务资产维护和操作日志读取能力。"),
}


@dataclass(frozen=True, slots=True)
class RbacSeedSummary:
    """Counts of rows inserted by one idempotent RBAC seed attempt."""

    roles_inserted: int = 0
    permissions_inserted: int = 0
    mappings_inserted: int = 0

    @property
    def inserted(self) -> int:
        return self.roles_inserted + self.permissions_inserted + self.mappings_inserted


_RBAC_TABLES = frozenset({"p_role", "p_permission", "p_role_permission"})
_RBAC_COLUMNS = frozenset(
    {
        "role_code",
        "permission_code",
        "resource",
        "action",
        "name",
        "description",
        "builtin",
        "enabled",
    }
)


def _safe_identifier(value: str, allowed: frozenset[str]) -> str:
    if value not in allowed:
        raise ValueError(f"unsupported RBAC identifier: {value}")
    return value


def _qualified_table(table: str, schema: str | None) -> str:
    safe_table = _safe_identifier(table, _RBAC_TABLES)
    if schema:
        if not schema.replace("_", "").isalnum() or not schema[0].isalpha():
            raise ValueError("database schema must be a simple identifier")
        return f"{schema}.{safe_table}"
    return safe_table


def _execute_allowlisted_sql(cursor: Any, statement: str, parameters: tuple[Any, ...]) -> None:
    """Execute SQL whose identifiers were validated by the caller."""
    # pi-lens-ignore: python-sql-injection
    cursor.execute(statement, parameters)


def ensure_gaussdb_rbac_schema(
    connection: Any,
    config: dict[str, Any],
    *,
    schema: str | None = None,
) -> bool:
    """Apply the RBAC forward DDL for the non-Alembic DWS provider.

    The current GaussDB provider intentionally uses the repository baseline
    rather than online Alembic.  This small compatibility step lets an
    existing pre-RBAC DWS installation upgrade without pretending that DWS
    has an Alembic online path.
    """
    if config.get("type") != "gaussdb":
        return False
    provider = get_provider("gaussdb")
    physical_schema = provider.physical_schema(config) if schema is None else schema
    safe_role_table = _qualified_table("p_role", physical_schema)
    safe_permission_table = _qualified_table("p_permission", physical_schema)
    safe_mapping_table = _qualified_table("p_role_permission", physical_schema)
    placeholder = provider.placeholder
    cursor = connection.cursor()
    try:
        cursor.execute(
            "SELECT table_name FROM information_schema.tables "
            f"WHERE table_schema = {placeholder} AND table_name IN "
            f"({placeholder}, {placeholder}, {placeholder})",
            (physical_schema, "p_role", "p_permission", "p_role_permission"),
        )
        existing = {str(row[0]).lower() for row in cursor.fetchall()}
        expected = {"p_role", "p_permission", "p_role_permission"}
        if existing == expected:
            return False
        if existing:
            missing = ", ".join(sorted(expected - existing))
            raise RuntimeError(f"partial RBAC schema detected; missing tables: {missing}")
        statements = (
            f"CREATE TABLE IF NOT EXISTS {safe_role_table} ("
            "role_code VARCHAR(64) PRIMARY KEY, name VARCHAR(128) NOT NULL, "
            "description VARCHAR(2000), builtin CHAR(1) NOT NULL DEFAULT 'N', "
            "enabled CHAR(1) NOT NULL DEFAULT 'Y', "
            "created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, "
            "updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP) "
            "DISTRIBUTE BY REPLICATION",
            f"CREATE TABLE IF NOT EXISTS {safe_permission_table} ("
            "permission_code VARCHAR(128) PRIMARY KEY, resource VARCHAR(64) NOT NULL, "
            "action VARCHAR(32) NOT NULL, name VARCHAR(128) NOT NULL, "
            "description VARCHAR(2000)) DISTRIBUTE BY REPLICATION",
            f"CREATE TABLE IF NOT EXISTS {safe_mapping_table} ("
            "role_code VARCHAR(64) NOT NULL, permission_code VARCHAR(128) NOT NULL, "
            "PRIMARY KEY (role_code, permission_code), "
            f"FOREIGN KEY (role_code) REFERENCES {safe_role_table}(role_code) ON DELETE CASCADE, "
            f"FOREIGN KEY (permission_code) REFERENCES {safe_permission_table}(permission_code) ON DELETE CASCADE) "
            "DISTRIBUTE BY REPLICATION",
            f"CREATE INDEX idx_p_role_permission_permission ON {safe_mapping_table}(permission_code)",
        )
        for statement in statements:
            _execute_allowlisted_sql(cursor, statement, ())
        connection.commit()
        return True
    except Exception:
        connection.rollback()
        raise
    finally:
        cursor.close()


def _insert_if_absent(
    cursor: Any,
    *,
    table: str,
    key_columns: tuple[str, ...],
    key_values: tuple[Any, ...],
    columns: tuple[str, ...],
    values: tuple[Any, ...],
    placeholder: str,
) -> bool:
    safe_table = _safe_identifier(table.split(".")[-1], _RBAC_TABLES)
    safe_keys = tuple(_safe_identifier(column, _RBAC_COLUMNS) for column in key_columns)
    safe_columns = tuple(_safe_identifier(column, _RBAC_COLUMNS) for column in columns)
    where = " AND ".join(
        f"{column} = {placeholder}" for column in safe_keys
    )
    qualified_table = f"{table.rsplit('.', 1)[0]}.{safe_table}" if "." in table else safe_table
    _execute_allowlisted_sql(
        cursor,
        f"SELECT 1 FROM {qualified_table} WHERE {where}",
        key_values,
    )
    if cursor.fetchone() is not None:
        return False
    value_placeholders = ", ".join(placeholder for _ in values)
    _execute_allowlisted_sql(
        cursor,
        f"INSERT INTO {qualified_table} ({', '.join(safe_columns)}) "
        f"VALUES ({value_placeholders})",
        values,
    )
    return True


def seed_rbac(
    connection: Any,
    config: dict[str, Any],
    *,
    schema: str | None = None,
) -> RbacSeedSummary:
    """Insert the registry and built-in mappings without overwriting rows.

    The function uses read-before-insert rather than dialect-specific upsert
    syntax so SQLite, PostgreSQL, MySQL, and GaussDB share the same behavior.
    It is intentionally safe to call repeatedly and preserves custom role
    descriptions and extra Role-Permission rows.
    """
    validate_permission_registry()
    provider = get_provider(config["type"])
    physical_schema = (
        provider.physical_schema(config) if schema is None else schema
    )
    placeholder = provider.placeholder
    ensure_gaussdb_rbac_schema(
        connection,
        config,
        schema=physical_schema,
    )
    role_table = _qualified_table("p_role", physical_schema)
    permission_table = _qualified_table("p_permission", physical_schema)
    mapping_table = _qualified_table("p_role_permission", physical_schema)

    roles_inserted = 0
    permissions_inserted = 0
    mappings_inserted = 0
    cursor = connection.cursor()
    try:
        for role_code in (ADMIN_ROLE, MAINTAINER_ROLE):
            name, description = ROLE_METADATA[role_code]
            roles_inserted += _insert_if_absent(
                cursor,
                table=role_table,
                key_columns=("role_code",),
                key_values=(role_code,),
                columns=("role_code", "name", "description", "builtin", "enabled"),
                values=(role_code, name, description, "Y", "Y"),
                placeholder=placeholder,
            )

        for definition in PERMISSION_DEFINITIONS:
            permissions_inserted += _insert_if_absent(
                cursor,
                table=permission_table,
                key_columns=("permission_code",),
                key_values=(definition.code,),
                columns=(
                    "permission_code",
                    "resource",
                    "action",
                    "name",
                    "description",
                ),
                values=(
                    definition.code,
                    definition.resource,
                    definition.action,
                    definition.name,
                    definition.description,
                ),
                placeholder=placeholder,
            )

        for role_code in (ADMIN_ROLE, MAINTAINER_ROLE):
            allowed = BUILTIN_ROLE_PERMISSION_CODES[role_code]
            for permission_code in PERMISSION_CODES:
                if permission_code not in allowed:
                    continue
                mappings_inserted += _insert_if_absent(
                    cursor,
                    table=mapping_table,
                    key_columns=("role_code", "permission_code"),
                    key_values=(role_code, permission_code),
                    columns=("role_code", "permission_code"),
                    values=(role_code, permission_code),
                    placeholder=placeholder,
                )
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        cursor.close()
    return RbacSeedSummary(
        roles_inserted=roles_inserted,
        permissions_inserted=permissions_inserted,
        mappings_inserted=mappings_inserted,
    )


def seed_rbac_for_profile(profile: str) -> RbacSeedSummary:
    """Seed RBAC through the configured provider profile."""
    config = get_db_profile(profile)
    connection = connect_with_profile(profile)
    if connection is None:
        raise RuntimeError(f"database profile {profile!r} did not return a connection")
    try:
        return seed_rbac(connection, config)
    finally:
        connection.close()
