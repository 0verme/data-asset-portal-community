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
import logging
from contextvars import ContextVar
from contextlib import contextmanager
from pathlib import Path

import yaml

from ..settings import get_db_profile_overrides
from .base import (
    CrossProfileTransactionError,
    DatabaseConnectionError,
    DatabaseTransactionError,
    redact_sensitive_text,
)
from .providers import DEFAULT_GAUSS_DRIVER, LOGICAL_SCHEMA
from .registry import get_provider

ROOT_DIR = Path(__file__).resolve().parents[2]

# Application profile types. Migration dialects map separately:
# postgres -> postgresql, gaussdb -> dws.
SUPPORTED_DB_TYPES = frozenset({"sqlite", "postgres", "gaussdb"})
DEFAULT_DB_TYPE = "gaussdb"
DEFAULT_DRIVER = DEFAULT_GAUSS_DRIVER
DEFAULT_CONFIG_PATH = ROOT_DIR / "configs" / "database.yaml"
DEFAULT_JAR = ROOT_DIR / "resources" / "jars" / "gaussdb-jdbc.jar"  # placeholder; driver is not bundled
DEFAULT_PROFILE_ENV = "ASSET_DB_PROFILE"
AUTH_PROFILE_ENV = "ASSET_AUTH_DB_PROFILE"
LOGGER = logging.getLogger(__name__)
_ACTIVE_TRANSACTION = ContextVar("active_database_transaction", default=None)
_ENGINE_CACHE = {}


class _DatabaseTransaction:
    """A lazily-connected transaction owned by the outer service operation."""

    def __init__(self):
        self.profile = None
        self.connection = None

    def connection_for(self, profile: str):
        if self.connection is None:
            self.profile = profile
            self.connection = connect_with_profile(profile)
        elif self.profile != profile:
            raise CrossProfileTransactionError(
                f"A database transaction cannot span multiple profiles: {self.profile} and {profile}"
            )
        return self.connection


@contextmanager
def database_transaction():
    """Share one connection until the enclosing operation succeeds or fails.

    The first database call selects the profile.  Nested scopes are rejected so
    an inner operation cannot silently commit an outer operation.
    """
    if _ACTIVE_TRANSACTION.get() is not None:
        raise DatabaseTransactionError("Nested database transactions are not supported")
    transaction = _DatabaseTransaction()
    token = _ACTIVE_TRANSACTION.set(transaction)
    try:
        yield transaction
        if transaction.connection is not None:
            _commit_if_needed(transaction.connection)
    except Exception:
        if transaction.connection is not None:
            try:
                _rollback_if_needed(transaction.connection)
            except Exception:
                LOGGER.exception("Failed to roll back database transaction")
        raise
    finally:
        _ACTIVE_TRANSACTION.reset(token)
        if transaction.connection is not None:
            try:
                transaction.connection.close()
            except Exception:
                LOGGER.exception("Failed to close database transaction")


def active_transaction_connection(profile: str):
    """Return the shared connection for *profile*, if an operation owns one."""
    transaction = _ACTIVE_TRANSACTION.get()
    return transaction.connection_for(profile) if transaction is not None else None


def _resolve_config_path() -> Path:
    configured = os.getenv("ASSET_DB_CONFIG_PATH")
    if configured:
        return Path(configured)
    return DEFAULT_CONFIG_PATH


def _resolve_config_paths() -> list[Path]:
    configured = os.getenv("ASSET_DB_CONFIG_PATH")
    if configured:
        return [Path(configured)]

    return [DEFAULT_CONFIG_PATH]


def _resolve_default_jar_path() -> Path:
    configured = os.getenv("ASSET_DB_JAR_PATH")
    if configured:
        return Path(configured)
    return DEFAULT_JAR


def resolve_db_profile_name(env_var: str = DEFAULT_PROFILE_ENV, fallback: str | None = None) -> str:
    profile = os.getenv(env_var, "").strip()
    if profile:
        return profile
    if fallback:
        return fallback
    raise RuntimeError(f"Missing required database profile env var: {env_var}")


CONFIG_PATH = _resolve_config_path()


def load_db_profiles() -> dict:
    defaults = {}
    profiles = {}
    for config_path in _resolve_config_paths():
        with open(config_path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}

        defaults.update(data.get("defaults", {}))
        profiles.update(data.get("profiles", {}))

    merged = {}
    for name, profile in profiles.items():
        config = dict(defaults)
        config.update(profile)
        merged[name] = config
    return merged


def get_db_profile(profile: str) -> dict:
    profiles = load_db_profiles()
    if profile not in profiles:
        raise KeyError(f"database profile not found: {profile}")

    config = dict(profiles[profile])
    config.update(get_db_profile_overrides())
    raw_type = config.get("type")
    if raw_type is None or str(raw_type).strip() == "":
        db_type = DEFAULT_DB_TYPE
    else:
        db_type = str(raw_type).strip().lower()
    provider = get_provider(db_type)
    config["type"] = provider.name
    if provider.name == "gaussdb" and os.getenv("ASSET_DB_JAR_PATH"):
        config["jar_path"] = os.environ["ASSET_DB_JAR_PATH"]
    return provider.validate(profile, config, config_path=CONFIG_PATH)


def _build_postgres_options(config: dict):
    return get_provider("postgres")._options(config)


def _connect_gaussdb(config: dict):
    from .gaussdb_adapter import connect

    return connect(config)


def _connect_postgres(config: dict):
    from .postgres_adapter import connect

    return connect(config, options=_build_postgres_options(config))


def _connect_sqlite(config: dict):
    from .sqlite_adapter import connect

    return connect(config)


def connect_with_profile(profile: str):
    config = get_db_profile(profile)
    provider = get_provider(config["type"])
    try:
        engine = get_engine(profile, config=config)
        return engine.raw_connection() if engine is not None else provider.connect(config)
    except DatabaseConnectionError:
        raise
    except Exception as exc:
        safe_reason = redact_sensitive_text(exc, config)
        LOGGER.error(
            "Database connection failed for profile=%s provider=%s: %s",
            profile,
            provider.name,
            safe_reason,
        )
        raise DatabaseConnectionError(profile, provider.name, safe_reason) from None


def get_engine(profile: str, *, config: dict | None = None):
    """Return the cached SQLAlchemy Engine for an engine-backed profile."""
    config = config or get_db_profile(profile)
    provider = get_provider(config["type"])
    fingerprint = tuple(sorted((key, repr(value)) for key, value in config.items()))
    cached = _ENGINE_CACHE.get(profile)
    if cached and cached[0] == fingerprint:
        return cached[1]
    if cached and cached[1] is not None:
        cached[1].dispose()
    engine = provider.create_engine(config)
    _ENGINE_CACHE[profile] = (fingerprint, engine)
    return engine


def clear_engine_cache():
    for _, engine in _ENGINE_CACHE.values():
        if engine is not None:
            engine.dispose()
    _ENGINE_CACHE.clear()


def _is_autocommit_enabled(conn) -> bool | None:
    jconn = getattr(conn, "jconn", None)
    if jconn is not None:
        try:
            return bool(jconn.getAutoCommit())
        except Exception:
            return None

    get_autocommit = getattr(conn, "get_autocommit", None)
    if callable(get_autocommit):
        return bool(get_autocommit())

    auto_commit = getattr(conn, "autocommit", None)
    if isinstance(auto_commit, bool):
        return bool(auto_commit)
    return None


def _commit_if_needed(conn):
    auto_commit_enabled = _is_autocommit_enabled(conn)
    if auto_commit_enabled is True:
        return

    try:
        conn.commit()
        return
    except Exception as e:
        if "autoCommit is enabled" in str(e):
            return

        jconn = getattr(conn, "jconn", None)
        if jconn is None:
            raise

        try:
            jconn.commit()
        except Exception as inner_e:
            if "autoCommit is enabled" in str(inner_e):
                return
            raise inner_e from e


def _rollback_if_needed(conn):
    if _is_autocommit_enabled(conn) is True:
        return
    conn.rollback()


def _prepare_execute_args(profile: str, sql: str, params=None):
    config = get_db_profile(profile)
    provider = get_provider(config["type"])
    normalized_sql = normalize_sql_for_profile(profile, sql)
    if not params:
        return normalized_sql, None
    if provider.placeholder != "?":
        normalized_sql = normalized_sql.replace("?", provider.placeholder)
    return normalized_sql, tuple(params)


def fetch_all(profile: str, sql: str, params=None):
    conn = None
    curs = None
    shared_connection = active_transaction_connection(profile)
    try:
        conn = shared_connection or connect_with_profile(profile)
        curs = conn.cursor()
        normalized_sql, normalized_params = _prepare_execute_args(profile, sql, params=params)
        if normalized_params is None:
            curs.execute(normalized_sql)
        else:
            curs.execute(normalized_sql, normalized_params)
        columns = [desc[0] for desc in curs.description] if curs.description else []
        rows = curs.fetchall()
        return columns, rows
    except Exception:
        LOGGER.exception("fetch_all failed for profile=%s", profile)
        raise
    finally:
        try:
            if curs is not None:
                curs.close()
        except Exception:
            pass
        try:
            if conn is not None and shared_connection is None:
                conn.close()
        except Exception:
            pass


def execute_sql(profile: str, sql: str, autocommit: bool = True, params=None):
    conn = None
    curs = None
    shared_connection = active_transaction_connection(profile)
    try:
        conn = shared_connection or connect_with_profile(profile)
        curs = conn.cursor()
        normalized_sql, normalized_params = _prepare_execute_args(profile, sql, params=params)
        if normalized_params is None:
            curs.execute(normalized_sql)
        else:
            curs.execute(normalized_sql, normalized_params)
        if autocommit and shared_connection is None:
            _commit_if_needed(conn)
        return True
    except Exception:
        LOGGER.exception("execute_sql failed for profile=%s", profile)
        raise
    finally:
        try:
            if curs is not None:
                curs.close()
        except Exception:
            pass
        try:
            if conn is not None and shared_connection is None:
                conn.close()
        except Exception:
            pass


def execute_many(profile: str, sql: str, rows, autocommit: bool = True):
    conn = None
    curs = None
    shared_connection = active_transaction_connection(profile)
    try:
        conn = shared_connection or connect_with_profile(profile)
        curs = conn.cursor()
        normalized_sql, _ = _prepare_execute_args(profile, sql, params=[None])
        curs.executemany(normalized_sql, [tuple(row) for row in rows])
        if autocommit and shared_connection is None:
            _commit_if_needed(conn)
        return True
    except Exception:
        LOGGER.exception("execute_many failed for profile=%s", profile)
        raise
    finally:
        try:
            if curs is not None:
                curs.close()
        except Exception:
            pass
        try:
            if conn is not None and shared_connection is None:
                conn.close()
        except Exception:
            pass


def _prepare_statement(profile: str, statement):
    if isinstance(statement, str):
        return statement, None
    if (
        isinstance(statement, (tuple, list))
        and len(statement) == 2
        and isinstance(statement[0], str)
    ):
        return _prepare_execute_args(profile, statement[0], params=statement[1])
    raise TypeError("statement must be SQL text or a (sql, params) pair")


def execute_statements(profile: str, statements, autocommit: bool = True):
    conn = None
    curs = None
    shared_connection = active_transaction_connection(profile)
    try:
        conn = shared_connection or connect_with_profile(profile)
        curs = conn.cursor()
        for statement in statements:
            normalized_sql, normalized_params = _prepare_statement(profile, statement)
            if not normalized_sql.strip():
                continue
            if normalized_params is None:
                curs.execute(normalized_sql)
            else:
                curs.execute(normalized_sql, normalized_params)
        if autocommit and shared_connection is None:
            _commit_if_needed(conn)
        return True
    except Exception:
        try:
            if conn is not None and shared_connection is None:
                _rollback_if_needed(conn)
        except Exception:
            pass
        LOGGER.exception("execute_statements failed for profile=%s", profile)
        raise
    finally:
        try:
            if curs is not None:
                curs.close()
        except Exception:
            pass
        try:
            if conn is not None and shared_connection is None:
                conn.close()
        except Exception:
            pass


POSTGRES_DISTRIBUTE_RE = re.compile(r"\)\s*DISTRIBUTE\s+BY\s+HASH\s*\([^)]+\)\s*;", re.IGNORECASE | re.MULTILINE)


def normalize_sql_for_profile(profile: str, sql_text: str) -> str:
    config = get_db_profile(profile)
    provider = get_provider(config["type"])
    physical_schema = provider.physical_schema(config)
    schema_prefix = f"{physical_schema}." if physical_schema else ""
    sql_text = sql_text.replace(f"{LOGICAL_SCHEMA}.", schema_prefix)
    if physical_schema is None:
        sql_text = sql_text.replace("dwp.", "")
    # Only gaussdb/DWS understands DISTRIBUTE BY HASH(...); strip it for postgres.
    if config["type"] == "gaussdb":
        return sql_text
    return POSTGRES_DISTRIBUTE_RE.sub(");", sql_text)
