"""Shared helpers for database-related tests.

Default unit tests must not open backend/configs/database.yaml or any
business database. Optional PostgreSQL integration tests opt in via
TEST_DATABASE_PROFILE + ASSET_DB_CONFIG_PATH (never the default real config).
"""
from __future__ import annotations

import os
import re
import unittest
from pathlib import Path
from unittest.mock import MagicMock


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DOCS_PG = PROJECT_ROOT / "docs" / "pg"
DOCS_DWS = PROJECT_ROOT / "docs" / "dws"
MIGRATIONS_ROOT = PROJECT_ROOT / "backend" / "migrations"

TEST_PROFILE_ENV = "TEST_DATABASE_PROFILE"
TEST_CONFIG_ENV = "TEST_DATABASE_CONFIG_PATH"


def integration_postgres_configured() -> bool:
    profile = (os.getenv(TEST_PROFILE_ENV) or "").strip()
    config = (os.getenv(TEST_CONFIG_ENV) or "").strip()
    return bool(profile and config and Path(config).is_file())


def skip_without_postgres_integration(reason: str | None = None):
    message = reason or (
        f"set {TEST_PROFILE_ENV} and {TEST_CONFIG_ENV} to a dedicated "
        "PostgreSQL test database (never production / default database.yaml)"
    )
    return unittest.skipUnless(integration_postgres_configured(), message)


def read_sql(path: Path) -> str:
    return path.read_text(encoding="utf-8-sig")


def extract_create_table_body(sql: str, table_name: str) -> str:
    """Return the CREATE TABLE body for table_name (best-effort text parse)."""
    pattern = re.compile(
        rf"CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(?:dwp\.)?{re.escape(table_name)}\s*\(",
        re.IGNORECASE,
    )
    match = pattern.search(sql)
    if not match:
        raise AssertionError(f"CREATE TABLE for {table_name} not found")
    start = match.end()
    depth = 1
    i = start
    while i < len(sql) and depth:
        if sql[i] == "(":
            depth += 1
        elif sql[i] == ")":
            depth -= 1
        i += 1
    return sql[start : i - 1]


def column_names_from_create_body(body: str) -> set[str]:
    """Extract column names from a CREATE TABLE body.

    Supports both multi-line DDL and single-line minified module scripts.
    """
    names: set[str] = set()
    # Split on commas that separate column definitions; ignore commas inside parentheses.
    parts: list[str] = []
    current = []
    depth = 0
    for ch in body:
        if ch == "(":
            depth += 1
            current.append(ch)
        elif ch == ")":
            depth = max(0, depth - 1)
            current.append(ch)
        elif ch == "," and depth == 0:
            parts.append("".join(current))
            current = []
        else:
            current.append(ch)
    if current:
        parts.append("".join(current))

    for raw in parts:
        line = " ".join(raw.split())
        if not line or line.startswith("--"):
            continue
        upper = line.upper()
        if upper.startswith(("CONSTRAINT", "PRIMARY", "UNIQUE", "CHECK", "FOREIGN")):
            continue
        token = line.split()[0].strip('"')
        if token:
            names.add(token.lower())
    return names


def assert_table_has_columns(sql: str, table_name: str, required: set[str]):
    body = extract_create_table_body(sql, table_name)
    columns = column_names_from_create_body(body)
    missing = {name.lower() for name in required} - columns
    if missing:
        raise AssertionError(f"{table_name} missing columns: {sorted(missing)}")


class SpyCursor:
    def __init__(self, connection: "SpyConnection"):
        self.connection = connection
        self.description = None
        self._fetchall = []
        self._fetchone = None

    def execute(self, sql, params=None):
        self.connection.calls.append((sql, params or ()))
        if self.connection.execute_side_effect is not None:
            result = self.connection.execute_side_effect(sql, params or ())
            if isinstance(result, Exception):
                raise result
        return self

    def fetchall(self):
        return list(self._fetchall)

    def fetchone(self):
        return self._fetchone

    def close(self):
        return None


class SpyConnection:
    def __init__(self):
        self.calls: list[tuple[str, tuple]] = []
        self.commits = 0
        self.rollbacks = 0
        self.closed = False
        self.execute_side_effect = None
        self._cursor = SpyCursor(self)

    def cursor(self):
        return self._cursor

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1

    def close(self):
        self.closed = True


def make_cursor_mock(*, fetchall=None, fetchone=None, description=None):
    cursor = MagicMock()
    cursor.fetchall.return_value = fetchall or []
    cursor.fetchone.return_value = fetchone
    cursor.description = description
    return cursor
