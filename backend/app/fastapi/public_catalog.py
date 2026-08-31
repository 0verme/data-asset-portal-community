"""Public catalog response boundaries and anonymous navigation helpers."""

from __future__ import annotations

import re
from copy import deepcopy
from typing import Any

from ..application import RequestContext
from ..authorization.core import AuthorizationService


_PUBLIC_MENU_EXCLUDED_CODES = {"system", "system-management"}
_PUBLIC_AUDIT_KEYS = {"createdby", "updatedby"}
_PUBLIC_SENSITIVE_KEYS = {
    "account",
    "accesskey",
    "apikey",
    "auth",
    "authorization",
    "connectionstring",
    "cookie",
    "credential",
    "dsn",
    "host",
    "jdbcurl",
    "password",
    "port",
    "privatekey",
    "secret",
    "session",
    "token",
    "uri",
    "url",
    "user",
    "username",
}
_PUBLIC_PUSH_SYSTEM_HIDDEN_KEYS = {
    "host",
    "port",
    "account",
    "auth",
    "downstreamcontact",
    "datadevelopercontact",
    "contact",
    "credential",
    "password",
    "secret",
    "token",
    "username",
}
_PUBLIC_PUSH_JOB_HIDDEN_KEYS = {
    "sourcepath",
    "targetpath",
    "delimiter",
    "encoding",
    "rowcnt",
    "fields",
    "password",
    "secret",
    "token",
    "credential",
}
_SENSITIVE_PARAMETER_NAME = re.compile(
    r"(?:authorization|cookie|password|secret|token|credential|signature|"
    r"api[-_]?key|access[-_]?key|private[-_]?key)",
    re.IGNORECASE,
)
_SENSITIVE_LINEAGE_KEYS = {
    "account",
    "accesskey",
    "apikey",
    "auth",
    "authorization",
    "connectionstring",
    "cookie",
    "credential",
    "dsn",
    "host",
    "jdbcurl",
    "password",
    "port",
    "privatekey",
    "secret",
    "session",
    "sourcerecordid",
    "token",
    "uri",
    "url",
    "user",
    "username",
}
_SENSITIVE_LINEAGE_KEY_PARTS = (
    "password",
    "secret",
    "token",
    "credential",
    "authorization",
    "cookie",
    "connectionstring",
    "jdbcurl",
    "privatekey",
    "accesskey",
    "apikey",
)
_CONNECTION_VALUE = re.compile(
    r"(?:jdbc:[^\s]+|(?:https?|ftp)://[^\s]+|(?:postgres(?:ql)?|mysql)://[^\s]+)",
    re.IGNORECASE,
)
_SENSITIVE_TEXT_VALUE = re.compile(
    r"(?:password|token|secret|authorization|api[-_]?key|access[-_]?key)"
    r"\s*[:=]\s*[^\s,;]+",
    re.IGNORECASE,
)


def _redact_text(value: str) -> str:
    return _SENSITIVE_TEXT_VALUE.sub("[已隐藏]", _CONNECTION_VALUE.sub("[已隐藏]", value))


def _redact_public_value(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: _redact_public_value(child) for key, child in value.items()}
    if isinstance(value, list):
        return [_redact_public_value(child) for child in value]
    if isinstance(value, str):
        return _redact_text(value)
    return deepcopy(value)


def is_authenticated_request(
    context: RequestContext,
    authorization: AuthorizationService,
) -> bool:
    """Return whether the current identity is still valid.

    Public routes may receive an expired or otherwise invalid session cookie.
    Such a request must use the anonymous/redacted projection rather than
    trusting the cookie's role string.
    """
    try:
        decision = authorization.authenticate(context.identity)
        return bool(decision.authenticated and decision.reason == "authenticated")
    except Exception:
        # Fail closed for the projection decision. The business service still
        # owns its normal data-source error contract.
        return False


def public_navigation_menus(items: Any) -> list[dict[str, Any]]:
    """Keep only enabled, non-management menu entries for anonymous users."""
    result: list[dict[str, Any]] = []
    for item in items if isinstance(items, list) else []:
        if not isinstance(item, dict):
            continue
        code = str(item.get("code") or "").strip().lower()
        path = str(item.get("path") or "").strip().lower()
        status = str(item.get("status") or "").strip().lower()
        if (
            status == "disabled"
            or item.get("adminOnly")
            or code in _PUBLIC_MENU_EXCLUDED_CODES
            or path.startswith("/system-management")
        ):
            continue
        result.append(_redact_public_value({
            key: deepcopy(value)
            for key, value in item.items()
            if str(key).replace("_", "").replace("-", "").lower()
            not in _PUBLIC_AUDIT_KEYS | _PUBLIC_SENSITIVE_KEYS
        }))
    return result


def redact_public_manual_code_table(item: Any) -> Any:
    """Remove audit actor and credential fields from a public code-table record."""
    if not isinstance(item, dict):
        return item
    return _redact_public_value({
        key: deepcopy(value)
        for key, value in item.items()
        if str(key).replace("_", "").replace("-", "").lower()
        not in _PUBLIC_AUDIT_KEYS | _PUBLIC_SENSITIVE_KEYS
    })


def redact_public_report(item: Any) -> Any:
    """Remove audit actor and credential fields from a public report record."""
    if not isinstance(item, dict):
        return item
    return _redact_public_value({
        key: deepcopy(value)
        for key, value in item.items()
        if str(key).replace("_", "").replace("-", "").lower()
        not in _PUBLIC_AUDIT_KEYS | _PUBLIC_SENSITIVE_KEYS
    })


def redact_public_api_asset(item: Any) -> Any:
    """Publish API documentation without credentials or audit actors."""
    if not isinstance(item, dict):
        return item
    result = _redact_public_value({
        key: deepcopy(value)
        for key, value in item.items()
        if str(key).replace("_", "").replace("-", "").lower()
        not in _PUBLIC_AUDIT_KEYS | _PUBLIC_SENSITIVE_KEYS
    })

    params = []
    for parameter in result.get("params") if isinstance(result.get("params"), list) else []:
        if not isinstance(parameter, dict):
            continue
        name = str(parameter.get("name") or "")
        if _SENSITIVE_PARAMETER_NAME.search(name):
            continue
        # Parameter examples are arbitrary user data; they are not required
        # to browse the API catalog and may contain secrets.
        params.append({key: deepcopy(value) for key, value in parameter.items() if key != "example"})
    result["params"] = params

    response_fields = []
    for field in result.get("responseFields") if isinstance(result.get("responseFields"), list) else []:
        if not isinstance(field, dict):
            continue
        if _SENSITIVE_PARAMETER_NAME.search(str(field.get("name") or "")):
            continue
        # Response examples can contain real payloads. Keep the field contract
        # while omitting the sample value from the public projection.
        response_fields.append({key: deepcopy(value) for key, value in field.items() if key != "example"})
    result["responseFields"] = response_fields
    return result


def redact_public_push_system(item: Any) -> Any:
    """Remove connection and contact details from public push metadata."""
    if not isinstance(item, dict):
        return item
    result = _redact_public_value({
        key: deepcopy(value)
        for key, value in item.items()
        if str(key).replace("_", "").replace("-", "").lower()
        not in _PUBLIC_PUSH_SYSTEM_HIDDEN_KEYS | _PUBLIC_SENSITIVE_KEYS
    })
    jobs = []
    for job in result.get("jobs") if isinstance(result.get("jobs"), list) else []:
        if not isinstance(job, dict):
            continue
        jobs.append(_redact_public_value({
            key: deepcopy(value)
            for key, value in job.items()
            if str(key).replace("_", "").replace("-", "").lower()
            not in _PUBLIC_PUSH_JOB_HIDDEN_KEYS | _PUBLIC_SENSITIVE_KEYS
        }))
    result["jobs"] = jobs
    return result


def _safe_lineage_key(key: Any) -> bool:
    normalized = str(key).replace("_", "").replace("-", "").lower()
    if normalized in _SENSITIVE_LINEAGE_KEYS:
        return False
    return not any(part in normalized for part in _SENSITIVE_LINEAGE_KEY_PARTS)


def _redact_lineage_value(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: _redact_lineage_value(child)
            for key, child in value.items()
            if _safe_lineage_key(key) and str(key).replace("_", "").replace("-", "").lower() != "diagnostics"
        }
    if isinstance(value, list):
        return [_redact_lineage_value(child) for child in value]
    if isinstance(value, str):
        return _redact_text(value)
    return deepcopy(value)


def redact_public_lineage(value: Any) -> Any:
    """Redact connection-like values from lineage nodes and evidence."""
    return _redact_lineage_value(value)
