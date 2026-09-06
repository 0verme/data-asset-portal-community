"""Import a prepared Asset Metadata Contract into DAP over HTTP.

This example is an external producer boundary: it reads curated JSON and
submits it to DAP.  It never connects to a source database, scans objects, or
parses SQL.  DAP remains the authority for the complete Contract validation.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections.abc import Mapping
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse, urlunparse
from urllib.request import Request, urlopen

CONTRACT_VERSION = "1.0"
INGESTION_PATH = "/api/metadata/assets/ingestions"
LOGIN_PATH = "/api/auth/login"
DEFAULT_TIMEOUT = 60
SESSION_ENV = "DAP_SESSION"
LEGACY_SESSION_ENV = "DAP_SESSION_COOKIE"
USERNAME_ENV = "DAP_USERNAME"
PASSWORD_ENV = "DAP_PASSWORD"
_MISSING = object()
_SENSITIVE_KEY_PARTS = (
    "password",
    "passwd",
    "secret",
    "token",
    "session",
    "cookie",
    "authorization",
)


class DemoError(RuntimeError):
    """A safe, user-facing failure from the import demo."""


def _lookup(value: Mapping[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in value:
            return value[key]
    return _MISSING


def _mapping(value: Any, label: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise DemoError(f"Contract 校验失败：{label} 必须是对象")
    return value


def _required_text(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise DemoError(f"Contract 校验失败：{label} 必须是非空字符串")
    return value.strip()


def _optional_text(value: Any, label: str) -> None:
    if value is _MISSING or value is None:
        return
    if not isinstance(value, str):
        raise DemoError(f"Contract 校验失败：{label} 必须是字符串或 null")


def _validate_bool(value: Mapping[str, Any], *keys: str) -> None:
    for key in keys:
        if key in value and not isinstance(value[key], bool):
            raise DemoError(f"Contract 校验失败：{key} 必须是布尔值")


def validate_payload(payload: Any) -> None:
    """Perform small local checks against the current public Contract shape.

    The DAP API remains the authoritative validator.  This intentionally does
    not import DAP internals or reproduce the complete server-side schema.
    """
    root = _mapping(payload, "payload")
    version = _lookup(root, "contractVersion", "contract_version")
    if version != CONTRACT_VERSION:
        raise DemoError(
            f"Contract 校验失败：当前 Demo 只支持 contractVersion={CONTRACT_VERSION}"
        )

    source = _mapping(_lookup(root, "source"), "source")
    _required_text(_lookup(source, "type"), "source.type")
    _required_text(_lookup(source, "name"), "source.name")
    for key in ("namespace", "instance"):
        _optional_text(_lookup(source, key), f"source.{key}")

    collector = _mapping(_lookup(root, "collector"), "collector")
    _required_text(_lookup(collector, "name"), "collector.name")
    _required_text(_lookup(collector, "version"), "collector.version")

    assets = _lookup(root, "assets")
    if not isinstance(assets, list):
        raise DemoError("Contract 校验失败：assets 必须是数组")

    for asset_index, raw_asset in enumerate(assets):
        asset = _mapping(raw_asset, f"assets[{asset_index}]")
        external_id = _lookup(asset, "externalId", "external_id")
        qualified_name = _lookup(asset, "qualifiedName", "qualified_name")
        name = _lookup(asset, "name")
        for key, value in (
            ("externalId", external_id),
            ("qualifiedName", qualified_name),
            ("name", name),
        ):
            _optional_text(value, f"assets[{asset_index}].{key}")
        if not (
            isinstance(name, str)
            and name.strip()
            or isinstance(qualified_name, str)
            and qualified_name.strip()
        ):
            raise DemoError(
                f"Contract 校验失败：assets[{asset_index}] 需要 name 或 qualifiedName"
            )
        for key in (
            "assetType",
            "asset_type",
            "catalog",
            "database",
            "schema",
            "schemaName",
            "schema_name",
            "description",
        ):
            _optional_text(_lookup(asset, key), f"assets[{asset_index}].{key}")

        fields = _lookup(asset, "fields")
        if fields is _MISSING:
            continue
        if not isinstance(fields, list):
            raise DemoError(f"Contract 校验失败：assets[{asset_index}].fields 必须是数组")
        for field_index, raw_field in enumerate(fields):
            field = _mapping(raw_field, f"assets[{asset_index}].fields[{field_index}]")
            _required_text(
                _lookup(field, "name"),
                f"assets[{asset_index}].fields[{field_index}].name",
            )
            _required_text(
                _lookup(field, "dataType", "data_type", "type"),
                f"assets[{asset_index}].fields[{field_index}].dataType",
            )
            _validate_bool(field, "nullable", "primaryKey", "primary_key", "pk")
            _validate_bool(field, "partitionKey", "partition_key", "part")
            ordinal = _lookup(field, "ordinalPosition", "ordinal_position")
            if ordinal is not _MISSING and ordinal is not None and (
                isinstance(ordinal, bool) or not isinstance(ordinal, int) or ordinal < 1
            ):
                raise DemoError(
                    f"Contract 校验失败：assets[{asset_index}].fields[{field_index}]"
                    ".ordinalPosition 必须是大于等于 1 的整数"
                )
            _optional_text(
                _lookup(field, "description", "comment"),
                f"assets[{asset_index}].fields[{field_index}].description",
            )


def load_payload(path: str | Path) -> dict[str, Any]:
    """Read a JSON file and run the local Contract checks."""
    payload_path = Path(path).expanduser()
    try:
        text = payload_path.read_text(encoding="utf-8")
    except OSError as error:
        raise DemoError(f"无法读取 JSON 文件：{payload_path}") from error
    try:
        payload = json.loads(text)
    except json.JSONDecodeError as error:
        raise DemoError(
            f"JSON 解析失败：{payload_path}"
            f"（第 {error.lineno} 行，第 {error.colno} 列）"
        ) from error
    validate_payload(payload)
    return payload


def _validate_timeout(value: Any) -> int:
    try:
        timeout = int(value)
    except (TypeError, ValueError) as error:
        raise DemoError("timeout 必须是正整数") from error
    if timeout <= 0:
        raise DemoError("timeout 必须是正整数")
    return timeout


def _parse_http_url(value: str, label: str) -> tuple[Any, str]:
    raw = str(value or "").strip()
    parsed = urlparse(raw)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise DemoError(f"{label} 必须是 http(s) URL")
    if parsed.username or parsed.password:
        raise DemoError(f"{label} 不应包含用户名或密码")
    if parsed.fragment:
        raise DemoError(f"{label} 不应包含 URL fragment")
    return parsed, raw


def _normalize_ingestion_url(value: str) -> str:
    parsed, _raw = _parse_http_url(value, "--dap-url")
    path = parsed.path.rstrip("/")
    if path in {"", "/"}:
        path = INGESTION_PATH
    elif path != INGESTION_PATH:
        raise DemoError(
            f"--dap-url 必须是 DAP 根地址或 {INGESTION_PATH}"
        )
    return urlunparse((parsed.scheme, parsed.netloc, path, "", parsed.query, ""))


def _dap_base_url(value: str) -> str:
    parsed, _raw = _parse_http_url(value, "--dap-url")
    return urlunparse((parsed.scheme, parsed.netloc, "", "", "", ""))


def _environment_secrets() -> tuple[str, ...]:
    return tuple(
        value
        for name in (SESSION_ENV, LEGACY_SESSION_ENV, USERNAME_ENV, PASSWORD_ENV)
        if (value := os.environ.get(name, ""))
    )


def _redact(value: Any, secrets: tuple[str, ...] = ()) -> str:
    result = str(value or "")
    for secret in (*secrets, *_environment_secrets()):
        if secret:
            result = result.replace(secret, "[REDACTED]")
    result = re.sub(
        r"(?i)(password|passwd|pwd|secret|token|session|cookie|authorization)"
        r"(\s*[:=]\s*)([^,;\s\"'}]+)",
        r"\1=[REDACTED]",
        result,
    )
    result = re.sub(
        r"(?i)(://[^/\s:@]+:)[^/\s@]+@",
        r"\1[REDACTED]@",
        result,
    )
    return result[:500]


def _cookie_header(value: str) -> str:
    cookie = value.strip()
    if cookie.lower().startswith("session="):
        return cookie
    return f"session={cookie}"


def _response_status(response: Any) -> int:
    return int(getattr(response, "status", getattr(response, "code", 200)))


def _response_body(response: Any) -> str:
    value = response.read()
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    return str(value or "")


def _error_detail(error: HTTPError, *, secrets: tuple[str, ...] = ()) -> str:
    try:
        body = error.read().decode("utf-8", errors="replace")
    except (AttributeError, OSError, TypeError, UnicodeError, ValueError):
        body = ""
    detail = ""
    try:
        parsed = json.loads(body)
        if isinstance(parsed, Mapping):
            nested = parsed.get("error")
            if isinstance(nested, Mapping):
                detail = str(nested.get("message") or nested.get("code") or "")
            if not detail:
                detail = str(parsed.get("message") or parsed.get("status") or "")
    except (TypeError, ValueError):
        detail = ""
    if not detail:
        detail = body.strip().replace("\n", " ")[:300]
    suffix = f": {_redact(detail, secrets)}" if detail else ""
    return f"HTTP {error.code}{suffix}"


def _set_cookie_values(response: Any) -> list[str]:
    headers = getattr(response, "headers", None)
    if headers is None:
        return []
    get_all = getattr(headers, "get_all", None)
    if callable(get_all):
        values = get_all("Set-Cookie") or get_all("set-cookie") or []
        if isinstance(values, str):
            return [values]
        return list(values)
    get = getattr(headers, "get", None)
    if callable(get):
        value = get("Set-Cookie") or get("set-cookie")
        if value:
            return [value]
    return []


def _login(dap_url: str, username: str, password: str, *, timeout: int) -> str:
    url = _dap_base_url(dap_url) + LOGIN_PATH
    body = json.dumps(
        {"username": username, "password": password}, ensure_ascii=False
    ).encode("utf-8")
    request = Request(
        url,
        data=body,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            status = _response_status(response)
            _response_body(response)
            if status >= 400:
                raise DemoError(f"DAP 登录失败：HTTP {status}")
            cookies = _set_cookie_values(response)
    except DemoError:
        raise
    except HTTPError as error:
        raise DemoError(
            f"DAP 登录失败：{_error_detail(error, secrets=(password,))}"
        ) from error
    except (URLError, TimeoutError, OSError) as error:
        raise DemoError(
            f"DAP 登录请求失败：{_redact(error, (password,))}"
        ) from error

    for cookie in cookies:
        match = re.search(r"(?:^|;\s*)session=([^;]+)", str(cookie), re.IGNORECASE)
        if match:
            return match.group(1)
    raise DemoError("DAP 登录成功但没有返回 session cookie")


def _session_cookie(dap_url: str, *, timeout: int) -> str:
    session = os.environ.get(SESSION_ENV) or os.environ.get(LEGACY_SESSION_ENV)
    if session:
        return session
    username = os.environ.get(USERNAME_ENV, "")
    password = os.environ.get(PASSWORD_ENV, "")
    if bool(username) != bool(password):
        raise DemoError(
            f"请同时设置 {USERNAME_ENV} 和 {PASSWORD_ENV}，或直接设置 {SESSION_ENV}"
        )
    if not username:
        raise DemoError(
            f"认证需要 {SESSION_ENV}，或同时设置 {USERNAME_ENV} 和 {PASSWORD_ENV}"
        )
    return _login(dap_url, username, password, timeout=timeout)


def post_assets(
    dap_url: str,
    payload: Mapping[str, Any],
    *,
    session_cookie: str,
    timeout: int = DEFAULT_TIMEOUT,
) -> tuple[int, str]:
    """Submit one existing Asset Contract over the public HTTP API."""
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if session_cookie:
        headers["Cookie"] = _cookie_header(session_cookie)
    request = Request(
        _normalize_ingestion_url(dap_url),
        data=body,
        headers=headers,
        method="POST",
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            return _response_status(response), _response_body(response)
    except HTTPError as error:
        raise DemoError(
            f"DAP Metadata API 请求失败：{_error_detail(error, secrets=(session_cookie,))}"
        ) from error
    except (URLError, TimeoutError, OSError) as error:
        raise DemoError(
            f"DAP Metadata API 不可达：{_redact(error, (session_cookie,))}"
        ) from error


def _safe_preview(value: Any) -> Any:
    if isinstance(value, Mapping):
        result: dict[str, Any] = {}
        for key, item in value.items():
            key_text = str(key)
            if any(part in key_text.casefold() for part in _SENSITIVE_KEY_PARTS):
                result[key_text] = "[REDACTED]"
            else:
                result[key_text] = _safe_preview(item)
        return result
    if isinstance(value, list):
        return [_safe_preview(item) for item in value]
    if isinstance(value, str):
        return _redact(value)
    return value


def _asset_counts(payload: Mapping[str, Any]) -> tuple[int, int]:
    assets = payload.get("assets", [])
    fields = sum(
        len(asset.get("fields", []))
        for asset in assets
        if isinstance(asset, Mapping) and isinstance(asset.get("fields", []), list)
    )
    return len(assets), fields


def run_preview(payload: Mapping[str, Any]) -> int:
    """Print a local preview; deliberately do not authenticate or make HTTP."""
    asset_count, field_count = _asset_counts(payload)
    print("Preview：仅本地读取和校验，未发送 HTTP 请求。")
    print(f"Contract: {payload.get('contractVersion')}")
    print(f"Assets: {asset_count}; fields: {field_count}")
    print("Payload:")
    print(json.dumps(_safe_preview(payload), ensure_ascii=False, indent=2))
    return 0


def run_sync(payload: Mapping[str, Any], dap_url: str, *, timeout: int) -> int:
    session = _session_cookie(dap_url, timeout=timeout)
    status, response_body = post_assets(
        dap_url,
        payload,
        session_cookie=session,
        timeout=timeout,
    )
    if status not in {200, 201}:
        raise DemoError(f"DAP Metadata API 返回未预期的 HTTP {status}")

    print(f"Sync 成功（HTTP {status}）。")
    try:
        result = json.loads(response_body)
    except (TypeError, ValueError):
        result = None
    if isinstance(result, Mapping):
        if result.get("status"):
            print(f"Status: {_redact(result['status'])}")
        summary = result.get("summary")
        if isinstance(summary, Mapping):
            print(
                "Summary: "
                + _redact(json.dumps(summary, ensure_ascii=False, sort_keys=True))
            )
    return 0


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Import a prepared JSON Asset Metadata Contract into DAP"
    )
    parser.add_argument("--file", required=True, type=Path, help="Asset Contract JSON file")
    parser.add_argument(
        "--dap-url",
        required=True,
        help="DAP root URL or /api/metadata/assets/ingestions URL",
    )
    parser.add_argument(
        "--timeout",
        type=_validate_timeout,
        default=DEFAULT_TIMEOUT,
        help=f"HTTP timeout in seconds (default: {DEFAULT_TIMEOUT})",
    )
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("preview", help="validate and print the payload locally")
    commands.add_parser("sync", help="authenticate and submit the payload")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        payload = load_payload(args.file)
        if args.command == "preview":
            return run_preview(payload)
        return run_sync(payload, args.dap_url, timeout=args.timeout)
    except DemoError as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("Error: 操作已取消", file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
