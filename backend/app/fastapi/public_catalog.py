"""Public catalog response boundaries and anonymous navigation helpers.

Field exposure is centralized in :mod:`backend.app.security.public_field_policy`.
This module only wires the policy into HTTP response projection and anonymous
navigation, so display, search, and matchedFields always share one source.
"""

from __future__ import annotations

import re
from typing import Any

from ..application import RequestContext
from ..authorization.core import AuthorizationService
from ..security.public_field_policy import (
    normalized_key,
    project_public_value,
)
from ..settings import PublicCatalogProfile, get_public_catalog_profile

_PUBLIC_MENU_EXCLUDED_CODES = {"system", "system-management"}

_PUBLIC_API_SAMPLE_KEYS = frozenset(
    {
        "example",
        "examples",
        "examplevalue",
        "default",
        "defaultvalue",
        "sample",
        "sampledata",
        "samplevalue",
    }
)

_SENSITIVE_PARAMETER_NAME = re.compile(
    r"(?:authorization|authentication|auth[-_]?type|cookie|password|secret|token|"
    r"credential|signature|api[-_]?key|access[-_]?key|private[-_]?key|"
    r"user[-_]?name|login[-_]?name|account[-_]?name|service[-_]?account|"
    r"db[-_]?user|database[-_]?user)",
    re.IGNORECASE,
)


def project_public_catalog_value(
    value: Any,
    *,
    profile: PublicCatalogProfile | None = None,
    hide_person_identity: bool | None = None,
) -> Any:
    """Project nested catalog data using the centralized field policy."""
    return project_public_value(
        value,
        profile=profile,
        hide_person_identity=hide_person_identity,
    )


def profile_for_request(
    context: RequestContext,
    authorization: AuthorizationService,
) -> PublicCatalogProfile:
    """Use anonymous policy for guests while keeping authenticated metadata behavior."""
    return "internal" if is_authenticated_request(context, authorization) else get_public_catalog_profile()


def is_authenticated_request(
    context: RequestContext,
    authorization: AuthorizationService,
) -> bool:
    """Return whether the current identity is still valid.

    An expired or otherwise invalid session cookie must use the anonymous
    projection rather than trusting the cookie's role string.
    """
    try:
        decision = authorization.authenticate(context.identity)
        return bool(decision.authenticated and decision.reason == "authenticated")
    except Exception:
        return False


def public_navigation_menus(items: Any) -> list[dict[str, Any]]:
    """Keep enabled, non-management menus and apply the active public profile."""
    if get_public_catalog_profile() == "disabled":
        return []
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
        result.append(project_public_catalog_value(item))
    return result


def redact_public_manual_code_table(
    item: Any, *, profile: PublicCatalogProfile | None = None
) -> Any:
    """Project a manual code-table record through the shared field policy."""
    return project_public_catalog_value(item, profile=profile)


def redact_public_report(
    item: Any, *, profile: PublicCatalogProfile | None = None
) -> Any:
    """Project a report record through the shared field policy."""
    return project_public_catalog_value(item, profile=profile)


def redact_public_api_asset(
    item: Any, *, profile: PublicCatalogProfile | None = None
) -> Any:
    """Publish API schema without credentials, audit samples, or connection data."""
    result = project_public_catalog_value(item, profile=profile)
    if not isinstance(result, dict):
        return result

    def remove_examples(value: Any) -> Any:
        if isinstance(value, dict):
            return {
                key: remove_examples(child)
                for key, child in value.items()
                if normalized_key(key) not in _PUBLIC_API_SAMPLE_KEYS
            }
        if isinstance(value, list):
            return [remove_examples(child) for child in value]
        return value

    result = remove_examples(result)
    for collection_key in ("params", "responseFields"):
        rows = result.get(collection_key)
        if not isinstance(rows, list):
            continue
        result[collection_key] = [
            row
            for row in rows
            if isinstance(row, dict)
            and not _SENSITIVE_PARAMETER_NAME.search(str(row.get("name") or ""))
        ]
    return result


def redact_public_upstream_system(
    item: Any, *, profile: PublicCatalogProfile | None = None
) -> Any:
    """Project an upstream system through the shared profile policy.

    ``internal`` keeps safe connection locator metadata (host / db / schema);
    ``strict`` removes it. Credentials stay permanently hidden.
    """
    return project_public_catalog_value(item, profile=profile)


def redact_public_push_system(
    item: Any, *, profile: PublicCatalogProfile | None = None
) -> Any:
    """Remove connection configuration while retaining safe business metadata."""
    return project_public_catalog_value(item, profile=profile)


def redact_public_lineage(
    value: Any, *, profile: PublicCatalogProfile | None = None
) -> Any:
    """Redact internal IDs, connection values and diagnostic evidence in lineage."""
    return project_public_catalog_value(value, profile=profile)
