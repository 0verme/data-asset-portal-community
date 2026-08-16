from __future__ import annotations

import re


PG_DWS_DATA_TYPES = [
    "VARCHAR(32)",
    "VARCHAR(64)",
    "VARCHAR(128)",
    "VARCHAR(255)",
    "TEXT",
    "INTEGER",
    "BIGINT",
    "NUMERIC(18,2)",
    "NUMERIC(20,6)",
    "DATE",
    "TIMESTAMP",
    "BOOLEAN",
]

DEFAULT_DATA_TYPE = "VARCHAR(64)"

_DECIMAL_RE = re.compile(r"^(?:decimal|numeric)\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)$", re.IGNORECASE)
_VARCHAR_RE = re.compile(r"^(?:varchar|character varying)\s*\(\s*(\d+)\s*\)$", re.IGNORECASE)

_LEGACY_TYPE_MAP = {
    "string": DEFAULT_DATA_TYPE,
    "text": "TEXT",
    "int": "INTEGER",
    "integer": "INTEGER",
    "bigint": "BIGINT",
    "date": "DATE",
    "timestamp": "TIMESTAMP",
    "boolean": "BOOLEAN",
    "double": "NUMERIC(20,6)",
    "float": "NUMERIC(20,6)",
}


def normalize_data_type(raw_type: str | None) -> str:
    value = str(raw_type or "").strip()
    if not value:
        return DEFAULT_DATA_TYPE

    normalized = value.lower()
    decimal_match = _DECIMAL_RE.fullmatch(normalized)
    if decimal_match:
        precision, scale = decimal_match.groups()
        return f"NUMERIC({precision},{scale})"

    varchar_match = _VARCHAR_RE.fullmatch(normalized)
    if varchar_match:
        return f"VARCHAR({varchar_match.group(1)})"

    if normalized == "varchar":
        return DEFAULT_DATA_TYPE

    if normalized in {"decimal", "numeric"}:
        return "NUMERIC(18,2)"

    if normalized in _LEGACY_TYPE_MAP:
        return _LEGACY_TYPE_MAP[normalized]

    return value.upper()
