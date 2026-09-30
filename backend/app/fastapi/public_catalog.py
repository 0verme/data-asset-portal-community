"""Public catalog response boundaries and anonymous navigation helpers."""

from __future__ import annotations

import re
from copy import deepcopy
from typing import Any

from ..application import RequestContext
from ..authorization.core import AuthorizationService
from ..settings import PublicCatalogProfile, get_public_catalog_profile

_PUBLIC_MENU_EXCLUDED_CODES = {"system", "system-management"}

# These fields are never included in ordinary catalog projections, regardless
# of profile or caller identity. Privileged connection details remain available
# only through the protected admin-detail routes.
_PUBLIC_ALWAYS_HIDDEN_KEYS = frozenset(
    {
        "account",
        "accountname",
        "accountusername",
        "databaseaccount",
        "dbaccount",
        "serviceaccount",
        "accesskey",
        "authentication",
        "authtype",
        "authmode",
        "apikey",
        "auth",
        "authorization",
        "connection",
        "connectionconfig",
        "connectiondetails",
        "connectionoptions",
        "connectionstring",
        "connectionuser",
        "connectionusername",
        "connectionaccount",
        "connectionaccountname",
        "connectionurl",
        "connectionuri",
        "connectiondsn",
        "cookie",
        "credential",
        "createdby",
        "createdbyid",
        "createdbyname",
        "createby",
        "createbyname",
        "createduser",
        "createdusername",
        "creator",
        "creatorname",
        "delimiter",
        "encoding",
        "rowcnt",
        "fieldcount",
        "database",
        "databaseconnection",
        "databaseconfig",
        "databasehost",
        "databasename",
        "databaseusername",
        "databasepassword",
        "databaseport",
        "databaseurl",
        "databaseuser",
        "dbconfig",
        "dbhost",
        "dbname",
        "dbusername",
        "dbpassword",
        "dbport",
        "dbuser",
        "diagnostics",
        "dsn",
        "endpoint",
        "filepath",
        "confpath",
        "configpath",
        "host",
        "hostname",
        "ip",
        "ipaddress",
        "server",
        "serveraddress",
        "serverip",
        "serverhost",
        "hostaddress",
        "serverport",
        "portnumber",
        "jdbcurl",
        "lastmodifiedby",
        "lastupdatedby",
        "lastupdatedbyname",
        "logpath",
        "modifiedby",
        "modifiedbyname",
        "operator",
        "operatorid",
        "operatorname",
        "password",
        "port",
        "portno",
        "privatekey",
        "registeredby",
        "reviewer",
        "reviewerid",
        "reviewername",
        "auditedby",
        "audituser",
        "approvedby",
        "session",
        "sourcerecordid",
        "sourcepath",
        "sourcefilepath",
        "targetpath",
        "updatedby",
        "updateby",
        "updatebyname",
        "updatedbyid",
        "updatedbyname",
        "updateduser",
        "updatedusername",
        "updater",
        "updatername",
        "targetfilepath",
        "token",
        "uri",
        "url",
        "user",
        "userid",
        "useridentifier",
        "username",
        "workdir",
        "workingdirectory",
    }
)

# Exact normalized keys only: ownerDepartment, ownerTeam and ownershipType are
# ordinary business metadata and must not be removed by matching "owner".
_PUBLIC_PERSON_IDENTITY_KEYS = frozenset(
    {
        "owner",
        "ownername",
        "ownerid",
        "owneruserid",
        "ownerusername",
        "owneremail",
        "ownerphone",
        "maintainer",
        "maintainername",
        "maintainerid",
        "maintaineruserid",
        "maintainerusername",
        "maintaineremail",
        "maintainerphone",
        "contact",
        "contactname",
        "contactperson",
        "contactid",
        "contactemail",
        "contactphone",
        "contactmobile",
        "downstreamcontact",
        "downstreamcontactname",
        "downstreamcontactid",
        "downstreamcontactemail",
        "downstreamcontactphone",
        "datadevelopercontact",
        "datadevelopercontactname",
        "datadevelopercontactid",
        "datadevelopercontactemail",
        "datadevelopercontactphone",
        "registrar",
        "registrarname",
        "responsible",
        "responsiblename",
        "responsibleperson",
        "responsiblepersonname",
        "dutyowner",
        "dutyownername",
        "employee",
        "employeename",
        "staff",
        "staffname",
        "person",
        "personname",
        "registrarid",
        "email",
        "phone",
        "mobile",
        "telephone",
    }
)

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

_CREDENTIAL_KEY_PARTS = (
    "password",
    "secret",
    "token",
    "credential",
    "authorization",
    "cookie",
    "privatekey",
    "accesskey",
    "apikey",
)
_SENSITIVE_PARAMETER_NAME = re.compile(
    r"(?:authorization|authentication|auth[-_]?type|cookie|password|secret|token|"
    r"credential|signature|api[-_]?key|access[-_]?key|private[-_]?key|"
    r"user[-_]?name|login[-_]?name|account[-_]?name|service[-_]?account|"
    r"db[-_]?user|database[-_]?user)",
    re.IGNORECASE,
)
_CONNECTION_VALUE = re.compile(
    r"(?:jdbc:[^\s]+|(?:https?|ftp)://[^\s]+|"
    r"(?:postgres(?:ql)?|mysql)://[^\s]+)",
    re.IGNORECASE,
)
_SENSITIVE_TEXT_VALUE = re.compile(
    r"(?:authorization|authentication|cookie|password|passphrase|secret|token|"
    r"credential|signature|api[-_]?key|access[-_]?key|private[-_]?key|"
    r"account(?:name)?|user(?:name)?|database(?:user|name)?|db(?:user|name)?|"
    r"schema|host|hostname|port|url|uri|dsn|"
    r"path|directory|(?:file|source|target|config|log|work)[-_]?"
    r"(?:path|dir|directory))"
    r"\s*[:=]\s*[^\s,;]+",
    re.IGNORECASE,
)


def _normalized_key(key: Any) -> str:
    return str(key).replace("_", "").replace("-", "").lower()


def _is_always_hidden_key(key: Any) -> bool:
    normalized = _normalized_key(key)
    if normalized in _PUBLIC_ALWAYS_HIDDEN_KEYS:
        return True
    return any(part in normalized for part in _CREDENTIAL_KEY_PARTS) or "diagnostic" in normalized


def _is_person_identity_key(key: Any) -> bool:
    return _normalized_key(key) in _PUBLIC_PERSON_IDENTITY_KEYS


def _redact_text(value: str) -> str:
    return _SENSITIVE_TEXT_VALUE.sub(
        "[已隐藏]", _CONNECTION_VALUE.sub("[已隐藏]", value)
    )


def project_public_catalog_value(
    value: Any,
    *,
    profile: PublicCatalogProfile | None = None,
    hide_person_identity: bool | None = None,
) -> Any:
    """Project nested catalog data using the centralized field policy."""
    selected_profile = profile or get_public_catalog_profile()
    hide_people = (
        selected_profile == "strict"
        if hide_person_identity is None
        else hide_person_identity
    )
    if isinstance(value, dict):
        return {
            key: project_public_catalog_value(
                child,
                profile=selected_profile,
                hide_person_identity=hide_people,
            )
            for key, child in value.items()
            if not _is_always_hidden_key(key)
            and not (hide_people and _is_person_identity_key(key))
        }
    if isinstance(value, list):
        return [
            project_public_catalog_value(
                child,
                profile=selected_profile,
                hide_person_identity=hide_people,
            )
            for child in value
        ]
    if isinstance(value, str):
        return _redact_text(value)
    return deepcopy(value)


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
                if _normalized_key(key) not in _PUBLIC_API_SAMPLE_KEYS
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
    """Hide source connection names in addition to shared sensitive fields."""
    projected = project_public_catalog_value(item, profile=profile)

    def remove_connection_schema(value: Any) -> Any:
        if isinstance(value, dict):
            return {
                key: remove_connection_schema(child)
                for key, child in value.items()
                if _normalized_key(key) not in {"db", "database", "schema", "schemaname"}
            }
        if isinstance(value, list):
            return [remove_connection_schema(child) for child in value]
        return value

    return remove_connection_schema(projected)


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
