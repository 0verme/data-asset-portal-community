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

import re
from typing import Mapping

from .data_types import DEFAULT_DATA_TYPE, normalize_data_type


POSTGRESQL_DIALECT = "postgresql"
DWS_DIALECT = "dws"

_POSTGRES_ALIASES = {"pg", "postgres", "postgresql"}
_DWS_ALIASES = {"dws", "gaussdb", "gaussdb-dws", "huawei-dws"}


def normalize_db_dialect(config: Mapping | None, profile_name: str | None = None) -> str:
    values = []
    if profile_name:
        values.append(profile_name)

    if config:
        for key in ("type", "db_type", "database_type", "dialect", "driver", "profile", "engine", "jdbc_url", "dsn"):
            value = config.get(key)
            if value:
                values.append(str(value))

    normalized_values = [value.strip().lower() for value in values if str(value).strip()]
    for value in normalized_values:
        if value in _POSTGRES_ALIASES or any(alias in value for alias in _POSTGRES_ALIASES):
            return POSTGRESQL_DIALECT
        if value in _DWS_ALIASES or any(alias in value for alias in _DWS_ALIASES):
            return DWS_DIALECT

    # Unknown engines fall back to PostgreSQL-compatible DDL so the UI does not
    # regress to Hive-specific syntax.
    return POSTGRESQL_DIALECT


def get_ddl_dialect_label(dialect: str) -> str:
    normalized = (dialect or "").strip().lower()
    if normalized == DWS_DIALECT:
        return "Huawei DWS SQL"
    return "PostgreSQL SQL"


def generate_table_ddl(table: Mapping, fields: list[Mapping], dialect: str) -> str:
    normalized_dialect = (dialect or POSTGRESQL_DIALECT).strip().lower()
    schema_name = str(table.get("schema") or "").strip().lower()
    table_name = str(table["name"]).strip()
    qualified_name = f"{schema_name}.{table_name}" if schema_name else table_name

    column_pad = max(len(str(field["name"])) for field in fields) + 2 if fields else 2
    column_lines = []
    for field in fields:
        field_name = str(field["name"]).strip()
        column_type = _map_field_type(str(field.get("type") or DEFAULT_DATA_TYPE))
        nullable = bool(field.get("nullable"))
        column_sql = f"    {field_name.ljust(column_pad)} {column_type}"
        if not nullable:
            column_sql += " NOT NULL"
        column_lines.append(column_sql)

    ddl_lines = [
        f"CREATE TABLE IF NOT EXISTS {qualified_name} (",
        ",\n".join(column_lines),
        ")",
    ]

    if normalized_dialect == DWS_DIALECT:
        distribution_key = _pick_distribution_key(fields)
        if distribution_key:
            ddl_lines[-1] += f"\nDISTRIBUTE BY HASH({distribution_key})"

    ddl_lines[-1] += ";"

    comments = []
    table_comment = str(table.get("cn") or "").strip()
    if table_comment:
        comments.append(f"COMMENT ON TABLE {qualified_name} IS '{_escape_comment(table_comment)}';")

    for field in fields:
        field_comment = str(field.get("cn") or "").strip()
        if not field_comment:
            continue
        field_name = str(field["name"]).strip()
        comments.append(
            f"COMMENT ON COLUMN {qualified_name}.{field_name} IS '{_escape_comment(field_comment)}';"
        )

    return "\n".join([*ddl_lines, "", *comments]).rstrip()


def _map_field_type(raw_type: str) -> str:
    return normalize_data_type(raw_type)


def _pick_distribution_key(fields: list[Mapping]) -> str | None:
    for field in fields:
        if field.get("pk"):
            return str(field["name"]).strip()
    for field in fields:
        name = str(field["name"]).strip()
        if name.lower().endswith("_id"):
            return name
    return None


def _escape_comment(value: str) -> str:
    return str(value or "").replace("'", "''")
