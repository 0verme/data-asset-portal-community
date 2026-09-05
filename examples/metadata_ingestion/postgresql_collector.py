"""Official PostgreSQL metadata collector for the DAP Metadata Contract.

The collector is intentionally an external producer: it reads PostgreSQL
catalogs, creates the public asset contract, and submits that JSON over HTTP.
It never imports DAP repositories/services or connects to the DAP database.

Typical usage::

    python examples/metadata_ingestion/postgresql_collector.py check -c examples/metadata_ingestion/postgresql.yml
    python examples/metadata_ingestion/postgresql_collector.py preview -c examples/metadata_ingestion/postgresql.yml
    python examples/metadata_ingestion/postgresql_collector.py sync -c examples/metadata_ingestion/postgresql.yml

The runtime dependency is ``psycopg`` (already used by the repository) and
``PyYAML`` for the small, version-controllable configuration file.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import traceback
from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse, urlunparse
from urllib.request import Request, urlopen

COLLECTOR_NAME = "postgresql-reference"
COLLECTOR_VERSION = "0.1.0"
METADATA_ENDPOINT = "/api/metadata/assets/ingestions"
LOGIN_ENDPOINT = "/api/auth/login"
HEALTH_ENDPOINT = "/healthz"

DEFAULT_PORT = 5432
DEFAULT_CONNECT_TIMEOUT = 10
DEFAULT_STATEMENT_TIMEOUT_MS = 120_000
DEFAULT_HTTP_TIMEOUT = 60
DEFAULT_SESSION_COOKIE_ENV = "DAP_SESSION_COOKIE"

# PostgreSQL creates temporary/toast schemas in addition to these two public
# catalog names.  They are never useful as user assets for this MVP.
SYSTEM_SCHEMA_NAMES = frozenset({"pg_catalog", "information_schema"})
SYSTEM_SCHEMA_PREFIXES = ("pg_temp_", "pg_toast", "pg_toast_temp_")

SCHEMA_SQL = """
SELECT n.nspname AS schema_name,
       (
           n.nspname IN ('pg_catalog', 'information_schema')
           OR n.nspname LIKE 'pg_temp_%'
           OR n.nspname LIKE 'pg_toast%'
       ) AS is_system
FROM pg_catalog.pg_namespace AS n
ORDER BY n.nspname
"""

TABLE_SQL = """
SELECT n.nspname AS schema_name,
       c.relname AS table_name,
       CASE c.relkind
           WHEN 'r' THEN 'table'
           WHEN 'p' THEN 'partitioned_table'
           WHEN 'v' THEN 'view'
           WHEN 'm' THEN 'materialized_view'
           WHEN 'f' THEN 'foreign_table'
           ELSE c.relkind::text
       END AS table_type,
       obj_description(c.oid, 'pg_class') AS table_comment
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
  AND n.nspname = ANY(%s)
ORDER BY n.nspname, c.relname
"""

COLUMN_SQL = """
SELECT n.nspname AS schema_name,
       c.relname AS table_name,
       a.attname AS field_name,
       pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
       NOT a.attnotnull AS nullable,
       a.attnum AS ordinal_position,
       col_description(c.oid, a.attnum) AS column_comment,
       pg_get_expr(ad.adbin, ad.adrelid) AS column_default,
       EXISTS (
           SELECT 1
           FROM pg_catalog.pg_index AS i
           WHERE i.indrelid = c.oid
             AND i.indisprimary
             AND a.attnum = ANY(i.indkey)
       ) AS primary_key
FROM pg_catalog.pg_attribute AS a
JOIN pg_catalog.pg_class AS c ON c.oid = a.attrelid
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
LEFT JOIN pg_catalog.pg_attrdef AS ad
       ON ad.adrelid = a.attrelid
      AND ad.adnum = a.attnum
WHERE a.attnum > 0
  AND NOT a.attisdropped
  AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
  AND n.nspname = ANY(%s)
ORDER BY n.nspname, c.relname, a.attnum
"""

_ENV_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


class CollectorError(RuntimeError):
    """An expected, user-facing collector failure."""

    def __init__(self, stage: str, message: str):
        super().__init__(message)
        self.stage = stage
        self.message = message


class ConfigError(CollectorError):
    def __init__(self, message: str):
        super().__init__("Configuration error", message)


class PostgresConnectionError(CollectorError):
    def __init__(self, message: str):
        super().__init__("PostgreSQL connection failed", message)


class MetadataScanError(CollectorError):
    def __init__(self, message: str):
        super().__init__("Metadata scan failed", message)


class DapConnectionError(CollectorError):
    def __init__(self, message: str):
        super().__init__("DAP connection failed", message)


class MetadataContractError(CollectorError):
    def __init__(self, message: str):
        super().__init__("Metadata contract validation failed", message)


class MetadataSyncError(CollectorError):
    def __init__(self, message: str):
        super().__init__("Metadata sync failed", message)


@dataclass(frozen=True)
class SourceConfig:
    type: str
    name: str
    namespace: str
    host: str
    port: int
    database: str
    username: str
    password_env: str
    schemas: tuple[str, ...]
    connect_timeout: int
    statement_timeout_ms: int
    sslmode: str | None = None


@dataclass(frozen=True)
class CollectorConfig:
    source: SourceConfig
    sink_url: str
    session_cookie_env: str
    dap_username_env: str | None
    dap_password_env: str | None
    http_timeout: int
    collector_version: str


@dataclass(frozen=True)
class ScanResult:
    all_user_schemas: tuple[str, ...]
    schemas: tuple[str, ...]
    ignored_schemas: tuple[str, ...]
    filtered_schemas: tuple[str, ...]
    missing_requested_schemas: tuple[str, ...]
    table_rows: tuple[dict[str, Any], ...]
    column_rows: tuple[dict[str, Any], ...]


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------


def _mapping(value: Any, label: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise ConfigError(f"{label} must be a mapping")
    return value


def _required_text(value: Any, label: str) -> str:
    text = str(value or "").strip()
    if not text:
        raise ConfigError(f"{label} is required")
    return text


def _optional_text(value: Any, default: str = "") -> str:
    return str(value or default).strip()


def _positive_int(value: Any, label: str, default: int) -> int:
    if value is None or value == "":
        value = default
    try:
        result = int(value)
    except (TypeError, ValueError) as error:
        raise ConfigError(f"{label} must be an integer") from error
    if result <= 0:
        raise ConfigError(f"{label} must be greater than zero")
    return result


def _env_name(value: Any, label: str, *, default: str | None = None) -> str | None:
    if value is None or str(value).strip() == "":
        return default
    result = str(value).strip()
    if not _ENV_NAME.fullmatch(result):
        raise ConfigError(f"{label} must be a valid environment variable name")
    return result


def _schema_include(value: Any) -> tuple[str, ...]:
    if value is None:
        return ()
    if isinstance(value, Mapping):
        value = value.get("include", [])
    if value is None:
        return ()
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, Sequence) or isinstance(value, (bytes, bytearray)):
        raise ConfigError("source.schemas.include must be a list of schema names")
    names: list[str] = []
    seen: set[str] = set()
    for item in value:
        name = str(item or "").strip()
        if not name:
            raise ConfigError("source.schemas.include cannot contain an empty name")
        if name not in seen:
            names.append(name)
            seen.add(name)
    return tuple(names)


def _normalize_sink_url(value: Any) -> str:
    raw = _required_text(value, "sink.url")
    parsed = urlparse(raw)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ConfigError("sink.url must be an http(s) DAP base URL or metadata ingestion URL")
    path = parsed.path.rstrip("/")
    if not path:
        path = METADATA_ENDPOINT
    elif path != METADATA_ENDPOINT:
        raise ConfigError(
            f"sink.url must end with {METADATA_ENDPOINT} when a path is supplied"
        )
    return urlunparse((parsed.scheme, parsed.netloc, path, "", parsed.query, ""))


def load_config(path: str | Path) -> CollectorConfig:
    """Load and validate the public YAML configuration without resolving secrets."""
    config_path = Path(path).expanduser()
    try:
        import yaml  # type: ignore
    except ImportError as error:
        raise ConfigError("PyYAML is required to read the collector YAML config") from error

    try:
        raw = yaml.safe_load(config_path.read_text(encoding="utf-8"))
    except OSError as error:
        raise ConfigError(f"unable to read config file: {config_path}") from error
    except Exception as error:  # yaml.YAMLError without importing a private type
        raise ConfigError(f"unable to parse config file: {config_path}") from error

    root = _mapping(raw, "config")
    source_raw = _mapping(root.get("source"), "source")
    sink_raw = _mapping(root.get("sink"), "sink")

    # A plaintext password key is rejected rather than silently accepted.  A
    # config file is safe to commit only when the secret is environment-backed.
    if "password" in source_raw:
        raise ConfigError("source.password is not supported; use source.password_env")

    source_type = _required_text(source_raw.get("type", "postgresql"), "source.type").casefold()
    if source_type not in {"postgresql", "postgres"}:
        raise ConfigError("this collector only supports source.type=postgresql")

    database = _required_text(source_raw.get("database"), "source.database")
    source_name = _optional_text(source_raw.get("name"), database)
    password_env = _env_name(source_raw.get("password_env"), "source.password_env")
    if password_env is None:
        raise ConfigError("source.password_env is required")

    dap_username_env = _env_name(
        sink_raw.get("username_env", sink_raw.get("dap_username_env")),
        "sink.username_env",
    )
    dap_password_env = _env_name(
        sink_raw.get("password_env", sink_raw.get("dap_password_env")),
        "sink.password_env",
    )
    if bool(dap_username_env) != bool(dap_password_env):
        raise ConfigError("sink.username_env and sink.password_env must be configured together")

    source = SourceConfig(
        type="postgresql",
        name=source_name,
        namespace=_optional_text(source_raw.get("namespace")),
        host=_required_text(source_raw.get("host"), "source.host"),
        port=_positive_int(source_raw.get("port"), "source.port", DEFAULT_PORT),
        database=database,
        username=_required_text(
            source_raw.get("username", source_raw.get("user")), "source.username"
        ),
        password_env=password_env,
        schemas=_schema_include(source_raw.get("schemas")),
        connect_timeout=_positive_int(
            source_raw.get("connect_timeout"), "source.connect_timeout", DEFAULT_CONNECT_TIMEOUT
        ),
        statement_timeout_ms=_positive_int(
            source_raw.get("statement_timeout_ms"),
            "source.statement_timeout_ms",
            DEFAULT_STATEMENT_TIMEOUT_MS,
        ),
        sslmode=_optional_text(source_raw.get("sslmode")) or None,
    )
    return CollectorConfig(
        source=source,
        sink_url=_normalize_sink_url(sink_raw.get("url")),
        session_cookie_env=_env_name(
            sink_raw.get("session_cookie_env"),
            "sink.session_cookie_env",
            default=DEFAULT_SESSION_COOKIE_ENV,
        )
        or DEFAULT_SESSION_COOKIE_ENV,
        dap_username_env=dap_username_env,
        dap_password_env=dap_password_env,
        http_timeout=_positive_int(
            sink_raw.get("timeout"), "sink.timeout", DEFAULT_HTTP_TIMEOUT
        ),
        collector_version=_optional_text(
            _mapping(root.get("collector", {}), "collector").get("version"),
            COLLECTOR_VERSION,
        ),
    )


def _required_secret(env_name: str, label: str) -> str:
    value = os.getenv(env_name, "")
    if not value:
        raise ConfigError(f"{label} environment variable {env_name} is not set")
    return value


# ---------------------------------------------------------------------------
# PostgreSQL catalog scan and public Contract mapping
# ---------------------------------------------------------------------------


def _row_names(cursor: Any) -> list[str]:
    names: list[str] = []
    for item in cursor.description or ():
        if isinstance(item, (tuple, list)):
            names.append(str(item[0]))
        else:
            names.append(str(getattr(item, "name", item)))
    return names


def _rows(cursor: Any) -> list[dict[str, Any]]:
    names = _row_names(cursor)
    return [dict(zip(names, row, strict=True)) for row in cursor.fetchall()]


def _execute_rows(cursor: Any, sql: str, params: Any = None) -> list[dict[str, Any]]:
    if params is None:
        cursor.execute(sql)
    else:
        cursor.execute(sql, params)
    return _rows(cursor)


def _is_system_schema(name: str) -> bool:
    return name in SYSTEM_SCHEMA_NAMES or any(
        name.startswith(prefix) for prefix in SYSTEM_SCHEMA_PREFIXES
    )


def scan(connection: Any, *, schema_include: Sequence[str] = ()) -> ScanResult:
    """Read only PostgreSQL catalog rows needed by the Asset Contract."""
    cursor = connection.cursor()
    try:
        schema_rows = _execute_rows(cursor, SCHEMA_SQL)
        all_user = tuple(
            str(row["schema_name"])
            for row in schema_rows
            if not bool(row.get("is_system")) and not _is_system_schema(str(row["schema_name"]))
        )
        ignored = tuple(
            str(row["schema_name"])
            for row in schema_rows
            if bool(row.get("is_system")) or _is_system_schema(str(row["schema_name"]))
        )

        requested = tuple(str(name).strip() for name in schema_include if str(name).strip())
        requested_set = set(requested)
        if requested_set:
            selected = tuple(name for name in all_user if name in requested_set)
            filtered = tuple(name for name in all_user if name not in requested_set)
            missing = tuple(name for name in requested if name not in set(all_user))
        else:
            selected = all_user
            filtered = ()
            missing = ()

        if not selected:
            return ScanResult(
                all_user_schemas=all_user,
                schemas=selected,
                ignored_schemas=ignored,
                filtered_schemas=filtered,
                missing_requested_schemas=missing,
                table_rows=(),
                column_rows=(),
            )

        table_rows = _execute_rows(cursor, TABLE_SQL, (list(selected),))
        column_rows = _execute_rows(cursor, COLUMN_SQL, (list(selected),))
        return ScanResult(
            all_user_schemas=all_user,
            schemas=selected,
            ignored_schemas=ignored,
            filtered_schemas=filtered,
            missing_requested_schemas=missing,
            table_rows=tuple(table_rows),
            column_rows=tuple(column_rows),
        )
    finally:
        close = getattr(cursor, "close", None)
        if callable(close):
            close()


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError, OverflowError):
        return default


def build_contract(
    table_rows: list[dict[str, Any]] | Sequence[Mapping[str, Any]],
    column_rows: list[dict[str, Any]] | Sequence[Mapping[str, Any]],
    *,
    source_name: str,
    source_namespace: str = "",
    database_name: str = "",
    collector_version: str = COLLECTOR_VERSION,
) -> dict[str, Any]:
    """Build the public Asset Contract from catalog fixtures.

    This function only emits fields already defined by the public Contract.
    PostgreSQL defaults are read for catalog completeness but are not emitted:
    the current DAP field contract has no persisted default-value property.
    """
    fields_by_table: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for raw_row in column_rows:
        row = dict(raw_row)
        key = (str(row["schema_name"]), str(row["table_name"]))
        comment = row.get("column_comment", row.get("description"))
        fields_by_table[key].append(
            {
                "name": str(row["field_name"]),
                # Keep format_type() output unchanged: it preserves varchar
                # modifiers, numeric precision/scale, arrays and user types.
                "dataType": str(row["data_type"]),
                "nullable": bool(row["nullable"]),
                "primaryKey": bool(row.get("primary_key", False)),
                "ordinalPosition": _safe_int(row.get("ordinal_position"), 1),
                "description": comment if comment not in (None, "") else None,
            }
        )

    assets: list[dict[str, Any]] = []
    for raw_row in table_rows:
        row = dict(raw_row)
        schema_name = str(row["schema_name"])
        table_name = str(row["table_name"])
        qualified_name = f"{schema_name}.{table_name}"
        table_type = str(row.get("table_type") or "table")
        table_comment = row.get("table_comment", row.get("description"))
        assets.append(
            {
                "externalId": qualified_name,
                "qualifiedName": qualified_name,
                # The existing Contract has no separate tableType field.  The
                # assetType value preserves relation kind without inventing a
                # second protocol.
                "assetType": table_type,
                "database": database_name,
                "schema": schema_name,
                "name": table_name,
                "description": table_comment if table_comment not in (None, "") else None,
                "fields": fields_by_table[(schema_name, table_name)],
            }
        )

    return {
        "contractVersion": "1.0",
        "source": {
            "type": "postgresql",
            "name": source_name,
            "namespace": source_namespace or None,
            "instance": database_name or None,
        },
        "collector": {
            "name": COLLECTOR_NAME,
            "version": collector_version,
        },
        "assets": assets,
    }


def collect(
    connection: Any,
    *,
    source_name: str,
    source_namespace: str = "",
    database_name: str = "",
    collector_version: str = COLLECTOR_VERSION,
    schema_include: Sequence[str] = (),
) -> dict[str, Any]:
    """Scan PostgreSQL and return a public Contract payload.

    Kept as a small importable seam for fixtures and third-party reference
    tests.  It does not know anything about DAP's database implementation.
    """
    result = scan(connection, schema_include=schema_include)
    return build_contract(
        list(result.table_rows),
        list(result.column_rows),
        source_name=source_name,
        source_namespace=source_namespace,
        database_name=database_name,
        collector_version=collector_version,
    )


# ---------------------------------------------------------------------------
# Connection and HTTP sink
# ---------------------------------------------------------------------------


def _load_psycopg() -> Any:
    try:
        import psycopg  # type: ignore
    except ImportError as error:
        raise ConfigError("psycopg is required; install backend/requirements.txt") from error
    return psycopg


def connect_postgres(source: SourceConfig) -> Any:
    """Open a PostgreSQL connection locked to read-only transactions."""
    password = _required_secret(source.password_env, "PostgreSQL password")
    psycopg = _load_psycopg()
    options = (
        f"-c default_transaction_read_only=on "
        f"-c statement_timeout={source.statement_timeout_ms}"
    )
    kwargs: dict[str, Any] = {
        "host": source.host,
        "port": source.port,
        "dbname": source.database,
        "user": source.username,
        "password": password,
        "connect_timeout": source.connect_timeout,
        "options": options,
    }
    if source.sslmode:
        kwargs["sslmode"] = source.sslmode
    try:
        return psycopg.connect(**kwargs)
    except Exception as error:
        raise PostgresConnectionError(_redact(str(error), [password])) from error


def scan_source(config: CollectorConfig) -> ScanResult:
    connection = connect_postgres(config.source)
    try:
        try:
            return scan(connection, schema_include=config.source.schemas)
        except CollectorError:
            raise
        except Exception as error:
            raise MetadataScanError(_redact(str(error), [])) from error
    finally:
        close = getattr(connection, "close", None)
        if callable(close):
            close()


def _dap_base_url(sink_url: str) -> str:
    parsed = urlparse(sink_url)
    return urlunparse((parsed.scheme, parsed.netloc, "", "", "", ""))


def _read_response(response: Any) -> tuple[int, str]:
    body = response.read().decode("utf-8", errors="replace")
    return int(getattr(response, "status", 200)), body


def _cookie_header(value: str) -> str:
    value = value.strip()
    if value.startswith("session="):
        return value
    return f"session={value}"


def publish(
    dap_url: str,
    payload: dict[str, Any],
    *,
    session_cookie: str = "",
    timeout: int = DEFAULT_HTTP_TIMEOUT,
) -> tuple[int, str]:
    """POST a Contract payload over HTTP; no DAP internals are imported."""
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if session_cookie:
        headers["Cookie"] = _cookie_header(session_cookie)
    request = Request(dap_url, data=body, headers=headers, method="POST")
    with urlopen(request, timeout=timeout) as response:
        return _read_response(response)


def _login(config: CollectorConfig) -> str:
    username = _required_secret(config.dap_username_env or "", "DAP username")
    password = _required_secret(config.dap_password_env or "", "DAP password")
    url = _dap_base_url(config.sink_url) + LOGIN_ENDPOINT
    body = json.dumps({"username": username, "password": password}).encode("utf-8")
    request = Request(
        url,
        data=body,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=config.http_timeout) as response:
            status, _ = _read_response(response)
            if status >= 400:
                raise DapConnectionError(f"DAP login returned HTTP {status}")
            cookies = response.headers.get_all("Set-Cookie") or []
    except HTTPError as error:
        detail = _response_error(error, secrets=[password])
        raise DapConnectionError(f"DAP authentication failed: {detail}") from error
    except (URLError, TimeoutError, OSError) as error:
        raise DapConnectionError(f"DAP login request failed: {_redact(str(error), [password])}") from error
    if not cookies:
        raise DapConnectionError("DAP login succeeded but did not return a session cookie")
    for cookie in cookies:
        match = re.search(r"(?:^|;)\s*session=([^;]+)", cookie)
        if match:
            return match.group(1)
    raise DapConnectionError("DAP login succeeded but did not return a session cookie")


def _session_cookie(config: CollectorConfig) -> str:
    value = os.getenv(config.session_cookie_env, "")
    if value:
        return value
    if config.dap_username_env and config.dap_password_env:
        return _login(config)
    raise DapConnectionError(
        "DAP authentication is required; set "
        f"{config.session_cookie_env} or configure sink.username_env/password_env"
    )


def _response_error(error: HTTPError, *, secrets: Sequence[str] = ()) -> str:
    try:
        body = error.read().decode("utf-8", errors="replace")
    except (AttributeError, OSError, TypeError, UnicodeError, ValueError):
        body = ""
    detail = ""
    try:
        parsed = json.loads(body)
        if isinstance(parsed, Mapping):
            error_value = parsed.get("error")
            if isinstance(error_value, Mapping):
                detail = str(error_value.get("message") or error_value.get("code") or "")
            if not detail:
                detail = str(parsed.get("message") or parsed.get("status") or "")
    except (TypeError, ValueError, json.JSONDecodeError):
        detail = ""
    if not detail:
        detail = body.strip().replace("\n", " ")[:300]
    return f"HTTP {error.code}" + (f": {_redact(detail, secrets)}" if detail else "")


def _check_dap(config: CollectorConfig) -> None:
    url = _dap_base_url(config.sink_url) + HEALTH_ENDPOINT
    request = Request(url, headers={"Accept": "application/json"}, method="GET")
    try:
        with urlopen(request, timeout=config.http_timeout) as response:
            status, _ = _read_response(response)
            if status >= 400:
                raise DapConnectionError(f"DAP health check returned HTTP {status}")
    except HTTPError as error:
        raise DapConnectionError(f"DAP health check failed: {_response_error(error)}") from error
    except (URLError, TimeoutError, OSError) as error:
        raise DapConnectionError(f"DAP health check failed: {_redact(str(error), [])}") from error


def _sync_payload(config: CollectorConfig, payload: dict[str, Any]) -> tuple[int, str]:
    cookie = _session_cookie(config)
    try:
        return publish(
            config.sink_url,
            payload,
            session_cookie=cookie,
            timeout=config.http_timeout,
        )
    except HTTPError as error:
        detail = _response_error(error, secrets=[cookie])
        if error.code in {401, 403}:
            raise DapConnectionError(f"DAP authentication/permission failed: {detail}") from error
        if error.code == 422:
            raise MetadataContractError(detail) from error
        raise MetadataSyncError(detail) from error
    except (URLError, TimeoutError, OSError) as error:
        raise DapConnectionError(f"DAP request failed: {_redact(str(error), [cookie])}") from error


def _redact(value: str, secrets: Sequence[str]) -> str:
    result = str(value or "")
    for secret in secrets:
        if secret:
            result = result.replace(secret, "[REDACTED]")
    # Also avoid accidentally exposing common connection-string password forms
    # if a third-party driver puts one into an exception message.
    result = re.sub(r"(?i)(password|passwd|pwd)=([^\s;&]+)", r"\1=[REDACTED]", result)
    result = re.sub(r"(?i)(://[^\s/@:]+:)[^\s/@]+@", r"\1[REDACTED]@", result)
    return result[:1000]


# ---------------------------------------------------------------------------
# CLI and user-facing output
# ---------------------------------------------------------------------------


def _validate_contract_shape(payload: Mapping[str, Any]) -> None:
    """Catch local construction bugs without importing DAP implementation code."""
    if payload.get("contractVersion") != "1.0":
        raise MetadataContractError("collector emitted an unsupported contractVersion")
    for key in ("source", "collector", "assets"):
        if key not in payload:
            raise MetadataContractError(f"collector payload is missing {key}")
    if not isinstance(payload["assets"], list):
        raise MetadataContractError("collector payload assets must be a list")
    for index, asset in enumerate(payload["assets"]):
        if not isinstance(asset, Mapping):
            raise MetadataContractError(f"asset {index} is not an object")
        for key in ("externalId", "qualifiedName", "assetType", "schema", "name", "fields"):
            if key not in asset:
                raise MetadataContractError(f"asset {index} is missing {key}")
        if not isinstance(asset["fields"], list):
            raise MetadataContractError(f"asset {index} fields must be a list")


def _payload_preview(payload: Mapping[str, Any]) -> dict[str, Any]:
    assets = payload.get("assets") or []
    preview_assets: list[dict[str, Any]] = []
    for asset in assets[:2]:
        if not isinstance(asset, Mapping):
            continue
        item = dict(asset)
        fields = list(item.get("fields") or [])
        item["fields"] = fields[:3]
        if len(fields) > 3:
            item["fieldsOmitted"] = len(fields) - 3
        preview_assets.append(item)
    return {
        "contractVersion": payload.get("contractVersion"),
        "source": payload.get("source"),
        "collector": payload.get("collector"),
        "assets": preview_assets,
        "assetsOmitted": max(0, len(assets) - len(preview_assets)),
    }


def _scan_and_build(config: CollectorConfig) -> tuple[ScanResult, dict[str, Any]]:
    result = scan_source(config)
    payload = build_contract(
        list(result.table_rows),
        list(result.column_rows),
        source_name=config.source.name,
        source_namespace=config.source.namespace,
        database_name=config.source.database,
        collector_version=config.collector_version,
    )
    _validate_contract_shape(payload)
    return result, payload


def _print_scan_summary(result: ScanResult) -> None:
    print(f"Schemas: {len(result.schemas)}")
    print(f"Tables: {len(result.table_rows)}")
    print(f"Columns: {len(result.column_rows)}")
    if result.ignored_schemas:
        print("Ignored schemas:")
        for name in result.ignored_schemas:
            print(f"- {name}")
    if result.filtered_schemas:
        print("Filtered schemas:")
        for name in result.filtered_schemas:
            print(f"- {name}")
    if result.missing_requested_schemas:
        print("Requested schemas not found:")
        for name in result.missing_requested_schemas:
            print(f"- {name}")


def run_check(config: CollectorConfig) -> int:
    _required_secret(config.source.password_env, "PostgreSQL password")
    connection = connect_postgres(config.source)
    try:
        print("PostgreSQL connection: OK")
    finally:
        close = getattr(connection, "close", None)
        if callable(close):
            close()
    _check_dap(config)
    print("DAP connection: OK")
    return 0


def run_preview(config: CollectorConfig) -> int:
    print("PostgreSQL connection and metadata scan:")
    result, payload = _scan_and_build(config)
    print("Connection: OK")
    _print_scan_summary(result)
    print("Payload preview:")
    print(json.dumps(_payload_preview(payload), ensure_ascii=False, indent=2))
    if not payload["assets"]:
        print("No assets found; sync will not submit an empty Contract request.")
    return 0


def run_sync(config: CollectorConfig) -> int:
    result, payload = _scan_and_build(config)
    print("PostgreSQL connection: OK")
    _print_scan_summary(result)
    if not payload["assets"]:
        print("No assets found; nothing to sync.")
        return 0
    status, response = _sync_payload(config, payload)
    if status not in {200, 201}:
        raise MetadataSyncError(f"DAP returned unexpected HTTP {status}")
    summary = ""
    try:
        decoded = json.loads(response)
        if isinstance(decoded, Mapping):
            summary_value = decoded.get("summary")
            if isinstance(summary_value, Mapping):
                summary = json.dumps(summary_value, ensure_ascii=False, sort_keys=True)
            elif decoded.get("status"):
                summary = str(decoded["status"])
    except (TypeError, ValueError, json.JSONDecodeError):
        summary = ""
    print(f"DAP sync: OK (HTTP {status})" + (f"; {summary}" if summary else ""))
    return 0


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Scan PostgreSQL metadata into DAP")
    parser.add_argument("--debug", action="store_true", help="show a redacted traceback on failure")
    commands = parser.add_subparsers(dest="command", required=True)
    for command, description in (
        ("check", "check PostgreSQL and DAP connectivity"),
        ("preview", "scan metadata and print a safe payload preview"),
        ("sync", "scan metadata and submit the Asset Contract to DAP"),
    ):
        subparser = commands.add_parser(command, help=description)
        subparser.add_argument("-c", "--config", required=True, type=Path)
        subparser.add_argument(
            "--debug", action="store_true", default=argparse.SUPPRESS, help=argparse.SUPPRESS
        )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    debug = bool(getattr(args, "debug", False))
    try:
        config = load_config(args.config)
        if args.command == "check":
            return run_check(config)
        if args.command == "preview":
            return run_preview(config)
        return run_sync(config)
    except CollectorError as error:
        print(f"{error.stage}: {error.message}", file=sys.stderr)
        if debug:
            print(_redact(traceback.format_exc(), []), file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("Collector interrupted", file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
