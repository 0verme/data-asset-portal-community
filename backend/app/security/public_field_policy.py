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

"""Centralized public catalog field policy.

This is the single source of truth shared by public catalog response
projection and anonymous unified search. It answers, for the active
``PUBLIC_CATALOG_PROFILE``:

- which fields may be displayed,
- which fields may be searched / returned in ``matchedFields``,
- which fields are permanently hidden credentials.

Profiles
--------
``internal``
    Enterprise intranet catalog. Connection locator metadata (host, port,
    database, schema, safe JDBC endpoint) and ordinary business contact
    metadata are public. Credentials stay hidden.
``strict``
    Public demo / high-security deployments. Connection locator metadata and
    person identity are hidden *and* excluded from anonymous search, so a
    hidden field can never be used as a search side channel.
``disabled``
    Anonymous catalog and search are blocked upstream. The projection falls
    back to the strict field set defensively.

Credential material (account, username, password, token, secret, credential,
private key, access key, cookie, authorization/authentication) is permanently
hidden in every profile. Connection strings and free text are sanitized so
``jdbc:postgresql://host:5432/db?user=x&password=y`` never exposes credential
parameters.
"""

from __future__ import annotations

import re
from copy import deepcopy
from typing import Any

from ..settings import PublicCatalogProfile, get_public_catalog_profile

FIELD_CLASS_BUSINESS = "business"
FIELD_CLASS_CONNECTION = "connection"
FIELD_CLASS_PERSON = "person"

# Profile -> field class visibility. This drives projection, search matcher
# filtering, upstream keyword matching, and matchedFields in one place.
PUBLIC_FIELD_POLICY: dict[str, dict[str, bool]] = {
    "internal": {FIELD_CLASS_CONNECTION: True, FIELD_CLASS_PERSON: True},
    "strict": {FIELD_CLASS_CONNECTION: False, FIELD_CLASS_PERSON: False},
    "disabled": {FIELD_CLASS_CONNECTION: False, FIELD_CLASS_PERSON: False},
}

# Never included in ordinary catalog projections, regardless of profile or
# caller identity: credentials, authentication material, audit actors,
# internal paths, diagnostics, and credential-bearing connection strings.
# Privileged connection details remain available only through protected
# admin-detail routes.
PUBLIC_ALWAYS_HIDDEN_KEYS = frozenset(
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
        "databaseconnection",
        "databaseconfig",
        "databaseusername",
        "databasepassword",
        "databaseurl",
        "databaseuser",
        "dbconfig",
        "dbusername",
        "dbpassword",
        "dbuser",
        "diagnostics",
        "dsn",
        "filepath",
        "confpath",
        "configpath",
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

# Connection locator metadata. ``internal`` publishes and searches these;
# ``strict`` hides them. Credential-bearing connection strings above stay
# permanently hidden.
PUBLIC_CONNECTION_METADATA_KEYS = frozenset(
    {
        "host",
        "hostname",
        "hostaddress",
        "ip",
        "ipaddress",
        "server",
        "serveraddress",
        "serverip",
        "serverhost",
        "port",
        "portnumber",
        "portno",
        "serverport",
        "databaseport",
        "dbport",
        "database",
        "databasename",
        "db",
        "dbname",
        "databasehost",
        "dbhost",
        "schema",
        "schemaname",
        "jdbcurl",
        "endpoint",
    }
)

# Exact normalized keys only: ownerDepartment, ownerTeam and ownershipType are
# ordinary business metadata and must not be removed by matching "owner".
PUBLIC_PERSON_IDENTITY_KEYS = frozenset(
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

# Query parameter / key=value names that carry credentials. ``user`` alone is
# included because JDBC URLs commonly use ``?user=...``.
_CREDENTIAL_PARAMETER = re.compile(
    r"^(?:"
    r"authorization|authentication|auth(?:[-_]?type)?|cookie|"
    r"password|passwd|pwd|sslpassword|secret|token|credential|signature|"
    r"api[-_]?key|access[-_]?key|private[-_]?key|"
    r"user(?:[-_]?name)?|login[-_]?name|account(?:[-_]?name)?|"
    r"service[-_]?account|db[-_]?user|database[-_]?user|"
    r"truststorepassword|keystorepassword"
    r")$",
    re.IGNORECASE,
)

_CONNECTION_URI = re.compile(
    r"(?:"
    r"jdbc:[A-Za-z0-9._+-]+:[^\s'\"<>]+"
    r"|(?:https?|ftp|postgres(?:ql)?|mysql|mariadb|oracle|sqlserver|"
    r"mongodb(?:\+srv)?|redis|amqp|kafka)://[^\s'\"<>]+"
    r")",
    re.IGNORECASE,
)

_CREDENTIAL_TEXT = re.compile(
    r"(?:authorization|authentication|cookie|password|passphrase|secret|token|"
    r"credential|signature|api[-_]?key|access[-_]?key|private[-_]?key|"
    r"account(?:name)?|user(?:name)?|database[-_]?user|db[-_]?user)"
    r"\s*[:=]\s*[^\s,;]+",
    re.IGNORECASE,
)

_PATH_TEXT = re.compile(
    r"(?:path|directory|dir)\s*[:=]\s*[^\s,;]+|"
    r"(?:file|source|target|config|log|work)[-_]?(?:path|dir|directory)"
    r"\s*[:=]\s*[^\s,;]+",
    re.IGNORECASE,
)

_CONNECTION_LOCATOR_TEXT = re.compile(
    r"(?:schema|host|hostname|port|endpoint|dsn|url|uri|database|db)"
    r"\s*[:=]\s*[^\s,;]+",
    re.IGNORECASE,
)

_REDACTED = "[已隐藏]"


def normalized_key(key: Any) -> str:
    """Normalize a field name for policy matching (``db_name`` -> ``dbname``)."""
    return str(key).replace("_", "").replace("-", "").lower()


def resolve_public_profile(
    profile: PublicCatalogProfile | None = None,
) -> PublicCatalogProfile:
    """Return the effective profile, failing closed to ``strict`` if unknown."""
    if profile is None:
        return get_public_catalog_profile()
    value = str(profile).strip().lower()
    if value in PUBLIC_FIELD_POLICY:
        return value  # type: ignore[return-value]
    return "strict"


def is_always_hidden_key(key: Any) -> bool:
    """Return whether a key is hidden in every profile."""
    normalized = normalized_key(key)
    if normalized in PUBLIC_ALWAYS_HIDDEN_KEYS:
        return True
    return any(part in normalized for part in _CREDENTIAL_KEY_PARTS) or "diagnostic" in normalized


def is_connection_metadata_key(key: Any) -> bool:
    """Return whether a key is profile-controlled connection metadata."""
    return normalized_key(key) in PUBLIC_CONNECTION_METADATA_KEYS


def is_person_identity_key(key: Any) -> bool:
    """Return whether a key identifies a natural person."""
    return normalized_key(key) in PUBLIC_PERSON_IDENTITY_KEYS


def public_field_class_visible(
    field_class: Any, profile: PublicCatalogProfile | None = None
) -> bool:
    """Return whether a search field class is visible for the profile.

    Unclassified fields are ordinary business metadata and stay visible.
    Unknown classes fail closed.
    """
    normalized = str(field_class or FIELD_CLASS_BUSINESS).strip().lower()
    if normalized in ("", FIELD_CLASS_BUSINESS, "public"):
        return True
    return bool(PUBLIC_FIELD_POLICY[resolve_public_profile(profile)].get(normalized, False))


def public_key_visible(key: Any, profile: PublicCatalogProfile | None = None) -> bool:
    """Return whether a projected key is visible for the profile."""
    if is_always_hidden_key(key):
        return False
    if is_connection_metadata_key(key) and not public_field_class_visible(
        FIELD_CLASS_CONNECTION, profile
    ):
        return False
    if is_person_identity_key(key) and not public_field_class_visible(
        FIELD_CLASS_PERSON, profile
    ):
        return False
    return True


def _is_credential_parameter(name: str) -> bool:
    return bool(_CREDENTIAL_PARAMETER.match(str(name or "").strip()))


def _strip_userinfo(uri: str) -> str:
    match = re.match(
        r"^([A-Za-z][A-Za-z0-9+.-]*(?::[A-Za-z0-9+._-]+)?://)([^/@]*)@(.*)$",
        uri,
    )
    if not match:
        return uri
    return f"{match.group(1)}{match.group(3)}"


def _strip_credential_query(uri: str) -> str:
    if "?" not in uri:
        return uri
    base, _, query = uri.partition("?")
    fragment = ""
    if "#" in query:
        query, _, fragment = query.partition("#")
    kept = [
        pair
        for pair in query.split("&")
        if pair and not _is_credential_parameter(pair.split("=", 1)[0])
    ]
    result = base
    if kept:
        result += "?" + "&".join(kept)
    if fragment:
        result += "#" + fragment
    return result


def sanitize_connection_uri(uri: str) -> str:
    """Keep a connection endpoint while removing credential material.

    ``jdbc:postgresql://host:5432/db?user=x&password=y`` becomes
    ``jdbc:postgresql://host:5432/db``; non-credential query parameters such
    as ``sslmode`` are preserved.
    """
    return _strip_credential_query(_strip_userinfo(str(uri)))


def sanitize_connection_text(value: str) -> str:
    """Sanitize every connection URI embedded in a free-text value."""
    return _CONNECTION_URI.sub(lambda match: sanitize_connection_uri(match.group(0)), value)


def redact_public_text(value: str, profile: PublicCatalogProfile | None = None) -> str:
    """Redact credential, path, and (in strict) locator material from text."""
    selected = resolve_public_profile(profile)
    if public_field_class_visible(FIELD_CLASS_CONNECTION, selected):
        result = sanitize_connection_text(value)
    else:
        result = _CONNECTION_URI.sub(_REDACTED, value)
    result = _CREDENTIAL_TEXT.sub(_REDACTED, result)
    result = _PATH_TEXT.sub(_REDACTED, result)
    if not public_field_class_visible(FIELD_CLASS_CONNECTION, selected):
        result = _CONNECTION_LOCATOR_TEXT.sub(_REDACTED, result)
    return result


def project_public_value(
    value: Any,
    *,
    profile: PublicCatalogProfile | None = None,
    hide_person_identity: bool | None = None,
) -> Any:
    """Project nested catalog data using the centralized field policy.

    The same function backs display projection, search result projection, and
    matchedFields sanitization.
    """
    selected = resolve_public_profile(profile)
    hide_people = (
        not public_field_class_visible(FIELD_CLASS_PERSON, selected)
        if hide_person_identity is None
        else bool(hide_person_identity)
    )
    if isinstance(value, dict):
        return {
            key: project_public_value(
                child,
                profile=selected,
                hide_person_identity=hide_people,
            )
            for key, child in value.items()
            if public_key_visible(key, selected)
            and not (hide_people and is_person_identity_key(key))
        }
    if isinstance(value, list):
        return [
            project_public_value(
                child,
                profile=selected,
                hide_person_identity=hide_people,
            )
            for child in value
        ]
    if isinstance(value, str):
        return redact_public_text(value, profile=selected)
    return deepcopy(value)
