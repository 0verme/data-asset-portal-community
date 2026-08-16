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
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import yaml

from ..settings import (
    get_db_connect_timeout_seconds,
    get_db_profile_overrides,
    get_db_statement_timeout_ms,
)

ROOT_DIR = Path(__file__).resolve().parents[2]

# Application profile types. Migration dialects map separately:
# postgres -> postgresql, gaussdb -> dws.
SUPPORTED_DB_TYPES = frozenset({"sqlite", "postgres", "gaussdb"})
DEFAULT_DB_TYPE = "gaussdb"
DEFAULT_DRIVER = "com.huawei.gauss200.jdbc.Driver"
DEFAULT_CONFIG_PATH = ROOT_DIR / "configs" / "database.yaml"
DEFAULT_JAR = ROOT_DIR / "resources" / "jars" / "gaussdb-jdbc.jar"  # placeholder; driver is not bundled
DEFAULT_PROFILE_ENV = "ASSET_DB_PROFILE"
AUTH_PROFILE_ENV = "ASSET_AUTH_DB_PROFILE"
LOGGER = logging.getLogger(__name__)
_ACTIVE_TRANSACTION = ContextVar("active_database_transaction", default=None)


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
            raise RuntimeError("A database transaction cannot span multiple profiles")
        return self.connection


@contextmanager
def database_transaction():
    """Share one connection until the enclosing operation succeeds or fails.

    The first database call selects the profile.  Nested scopes are rejected so
    an inner operation cannot silently commit an outer operation.
    """
    if _ACTIVE_TRANSACTION.get() is not None:
        raise RuntimeError("Nested database transactions are not supported")
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


def with_jdbc_timeouts(
    jdbc_url: str,
    *,
    connect_timeout_seconds: int | None = None,
    socket_timeout_seconds: int | None = None,
) -> str:
    raw_url = (jdbc_url or "").strip()
    if not raw_url:
        return raw_url

    connect_timeout_seconds = connect_timeout_seconds or get_db_connect_timeout_seconds()
    socket_timeout_seconds = socket_timeout_seconds or max(1, get_db_statement_timeout_ms() // 1000)

    normalized = raw_url.replace("jdbc:", "", 1)
    split = urlsplit(normalized)
    params = dict(parse_qsl(split.query, keep_blank_values=True))
    connect_timeout_ms = str(int(connect_timeout_seconds) * 1000)
    socket_timeout_ms = str(int(socket_timeout_seconds) * 1000)

    params.setdefault("loginTimeout", str(int(connect_timeout_seconds)))
    params.setdefault("connectTimeout", connect_timeout_ms)
    params.setdefault("socketTimeout", socket_timeout_ms)

    rebuilt = urlunsplit((split.scheme, split.netloc, split.path, urlencode(params), split.fragment))
    return f"jdbc:{rebuilt}"


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
    config["type"] = db_type

    if db_type not in SUPPORTED_DB_TYPES:
        supported = ", ".join(sorted(SUPPORTED_DB_TYPES))
        raise ValueError(
            f"Unsupported database type: {db_type}. "
            f"Supported types: {supported}."
        )

    if db_type == "sqlite":
        database = str(config.get("database") or "").strip()
        if not database:
            raise ValueError(f"sqlite profile '{profile}' requires database")
        config["database"] = database
        return config

    if db_type == "gaussdb":
        config.setdefault("driver", DEFAULT_DRIVER)
        config.setdefault("connect_timeout", get_db_connect_timeout_seconds())
        config.setdefault("socket_timeout", max(1, get_db_statement_timeout_ms() // 1000))
        config.setdefault("statement_timeout_ms", get_db_statement_timeout_ms())
        default_jar = _resolve_default_jar_path()
        configured_jar_path = Path(config.get("jar_path", default_jar))
        if not configured_jar_path.is_absolute():
            configured_jar_path = CONFIG_PATH.parent.parent / configured_jar_path
        jar_path = configured_jar_path if configured_jar_path.exists() else default_jar
        if not Path(jar_path).exists():
            raise ValueError(
                f"gaussdb profile '{profile}' requires a JDBC driver jar that is not present. "
                "Download the driver from the official vendor channel, then set "
                "ASSET_DB_JAR_PATH (or `jar_path` in the profile config) to its location. "
                "See backend/resources/jars/README.md for details."
            )
        config["jar_path"] = str(jar_path)
        if not config.get("jdbc_url"):
            raise ValueError(f"gaussdb profile '{profile}' requires jdbc_url")
        config["jdbc_url"] = with_jdbc_timeouts(
            config["jdbc_url"],
            connect_timeout_seconds=int(config["connect_timeout"]),
            socket_timeout_seconds=int(config["socket_timeout"]),
        )
        return config

    # postgres
    config.setdefault("host", "127.0.0.1")
    config.setdefault("port", 5432)
    config.setdefault("connect_timeout", get_db_connect_timeout_seconds())
    config.setdefault("statement_timeout_ms", get_db_statement_timeout_ms())
    if "database" not in config and "dbname" in config:
        config["database"] = config["dbname"]
    if not config.get("database") and not config.get("dsn"):
        raise ValueError(f"postgres profile '{profile}' requires database or dsn")
    return config


def _build_postgres_options(config: dict):
    options = []
    if config.get("schema"):
        options.append(f"-c search_path={config['schema']}")
    statement_timeout_ms = config.get("statement_timeout_ms")
    if statement_timeout_ms is not None:
        options.append(f"-c statement_timeout={int(statement_timeout_ms)}")
    return " ".join(options) or None


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
    if config["type"] == "sqlite":
        return _connect_sqlite(config)
    if config["type"] == "gaussdb":
        return _connect_gaussdb(config)
    if config["type"] == "postgres":
        return _connect_postgres(config)
    supported = ", ".join(sorted(SUPPORTED_DB_TYPES))
    raise ValueError(
        f"Unsupported database type: {config['type']}. Supported types: {supported}."
    )


def _is_autocommit_enabled(conn) -> bool | None:
    jconn = getattr(conn, "jconn", None)
    if jconn is not None:
        try:
            return bool(jconn.getAutoCommit())
        except Exception:
            return None

    auto_commit = getattr(conn, "autocommit", None)
    if auto_commit is not None:
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
    if not params:
        return sql, None

    normalized_sql = sql
    config = get_db_profile(profile)
    if config["type"] == "postgres":
        normalized_sql = sql.replace("?", "%s")
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
    except Exception as e:
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
    except Exception as e:
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
    except Exception as e:
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
    # Only gaussdb/DWS understands DISTRIBUTE BY HASH(...); strip it for postgres.
    if config["type"] == "gaussdb":
        return sql_text
    return POSTGRES_DISTRIBUTE_RE.sub(");", sql_text)
