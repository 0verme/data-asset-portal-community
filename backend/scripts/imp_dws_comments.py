"""Parse DWS mapping scripts and submit a Field Mapping import contract."""

from __future__ import annotations

import argparse
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx  # pyright: ignore[reportMissingImports]

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.db.facade import fetch_all, resolve_db_profile_name  # noqa: E402, I001


# 默认脚本目录：优先环境变量，其次 generic 部署路径。
# 作者本机工作区路径不再作为默认值入库。
DEFAULT_DIRECTORY = os.environ.get(
    "DWS_SCRIPT_DIR", "/opt/data-asset-portal/dws-scripts"
)

DEFAULT_TARGET_LAYER = "DWF"
DEFAULT_MAPPING_RULE = "\u76f4\u63a5\u6620\u5c04"
FALLBACK_MAPPING_RULE = "\u5f85\u8865\u5145"
DATE_MAPPING_RULE = "\u65e5\u671f\u683c\u5f0f\u5316"
LOAD_MODE_FULL = "full"
LOAD_MODE_INCR = "incr"
LOAD_MODE_INCR_ZIP = "incr_zip"
LOAD_MODE_FULL_ZIP = "full_zip"
MAX_SOURCE_FIELD_COMMENT_LENGTH = 1000

INSERT_SELECT_RE = re.compile(
    r"INSERT\s+INTO\s+([A-Z0-9_.$\"]+)\s*(\((.*?)\))?\s*SELECT\s+(.*?)\s+FROM\s",
    re.IGNORECASE | re.DOTALL,
)


@dataclass
class FieldMappingRow:
    source_field_name: str
    target_field_name: str
    field_order: int
    mapping_rule: str
    source_field_comment: str = ""


@dataclass
class TableMappingRow:
    upstream_system_id: int
    file_path: str
    source_table: str
    source_table_name: str
    source_table_cn: str
    target_table_name: str
    load_mode: str
    table_desc: str
    fields: list[FieldMappingRow]
    source_columns: dict[str, dict[str, str]]


@dataclass
class RecvDwfMeta:
    load_mode: str
    data_source: str


@dataclass
class ParsedScriptRow:
    file_index: int
    file_path: str
    source_table: str
    source_table_name: str
    target_table: str
    recv_dwf_meta: RecvDwfMeta
    upstream_system_id: int
    description: str
    fields: list[FieldMappingRow]


def _positive_int(value: str) -> int:
    try:
        parsed = int(str(value))
    except (TypeError, ValueError) as error:
        raise argparse.ArgumentTypeError("must be a positive integer") from error
    if parsed < 1:
        raise argparse.ArgumentTypeError("must be a positive integer")
    return parsed


def _positive_float(value: str) -> float:
    try:
        parsed = float(str(value))
    except (TypeError, ValueError) as error:
        raise argparse.ArgumentTypeError("must be greater than zero") from error
    if parsed <= 0:
        raise argparse.ArgumentTypeError("must be greater than zero")
    return parsed


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Parse DWS INSERT...SELECT scripts and submit Field Mapping imports through the Portal API."
    )
    parser.add_argument(
        "--profile",
        default=None,
        help="Source metadata database profile. Defaults to ASSET_DB_PROFILE or gauss_primary.",
    )
    parser.add_argument(
        "--directory",
        default=DEFAULT_DIRECTORY,
        help="Directory containing ETL Python files. Defaults to DWS_SCRIPT_DIR env or /opt/data-asset-portal/dws-scripts.",
    )
    parser.add_argument(
        "--api-base-url",
        default=os.environ.get("DAP_API_BASE_URL", ""),
        help="Portal API base URL. Can also be set with DAP_API_BASE_URL.",
    )
    parser.add_argument(
        "--session-cookie",
        default=os.environ.get("DAP_SESSION_COOKIE"),
        help="Existing Portal session cookie value. Prefer DAP_SESSION_COOKIE; never commit it.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate and classify imports without changing Portal data.",
    )
    parser.add_argument(
        "--batch-size",
        type=_positive_int,
        default=100,
        help="Number of table mappings per API request (default: 100).",
    )
    parser.add_argument(
        "--timeout",
        type=_positive_float,
        default=30.0,
        help="HTTP request timeout in seconds (default: 30).",
    )
    return parser.parse_args()


def normalize_sql(sql: str) -> str:
    sql = re.sub(r"--.*?$", "", sql, flags=re.MULTILINE)
    sql = re.sub(r"/\*.*?\*/", "", sql, flags=re.DOTALL)
    return sql.strip()


def split_select_items(text: str) -> list[str]:
    items: list[str] = []
    current: list[str] = []
    depth = 0
    quote_char = ""

    for char in text:
        if quote_char:
            current.append(char)
            if char == quote_char:
                quote_char = ""
            continue

        if char in ("'", '"'):
            quote_char = char
            current.append(char)
            continue

        if char == "(":
            depth += 1
            current.append(char)
            continue

        if char == ")":
            depth = max(depth - 1, 0)
            current.append(char)
            continue

        if char == "," and depth == 0:
            item = "".join(current).strip()
            if item:
                items.append(item)
            current = []
            continue

        current.append(char)

    tail = "".join(current).strip()
    if tail:
        items.append(tail)
    return items


def parse_target_fields(raw_fields: str | None) -> list[str]:
    if not raw_fields:
        return []
    return [
        field.strip().strip('"').upper()
        for field in split_select_items(raw_fields)
        if field.strip()
    ]


def extract_block(sql: str, start_pattern: str, end_pattern: str) -> str:
    match = re.search(
        start_pattern + r"(.*?)" + end_pattern,
        sql,
        re.IGNORECASE | re.DOTALL,
    )
    if not match:
        return ""
    return match.group(1)


def extract_line_comment_items(block: str) -> list[tuple[str, str]]:
    items: list[tuple[str, str]] = []
    for raw_line in block.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        code_part, _sep, comment_part = line.partition("--")
        code = code_part.strip().lstrip(",").rstrip(",").strip()
        if not code:
            continue
        items.append((code, comment_part.strip()))
    return items


def extract_target_field_comments(sql: str) -> list[str]:
    block = extract_block(sql, r"INSERT\s+INTO\s+[A-Z0-9_.$\"]+\s*\(", r"\)\s*SELECT\b")
    return [comment for _field, comment in extract_line_comment_items(block)]


def extract_select_item_comments(sql: str) -> list[str]:
    block = extract_block(sql, r"\bSELECT\b", r"\bFROM\b")
    return [comment for _field, comment in extract_line_comment_items(block)]


def find_first_insert_sql(file_path: str) -> str:
    content = Path(file_path).read_text(encoding="utf-8")
    start = re.search(r"INSERT\s+INTO", content, re.IGNORECASE)
    if not start:
        return ""

    tail = content[start.start() :]
    markers: list[int] = []
    for pattern in (
        r'"""\s*$',
        r"'''\s*$",
        r"\n\s*run_sql",
        r"\n\s*def\s+",
        r"\n\s*class\s+",
    ):
        match = re.search(pattern, tail, re.IGNORECASE | re.MULTILINE)
        if match:
            markers.append(match.start())
    end = min(markers) if markers else len(tail)
    return tail[:end].strip()


def extract_function_description(file_path: str) -> str:
    content = Path(file_path).read_text(encoding="utf-8")
    match = re.search(r"(?:\u529f\u80fd\u63cf\u8ff0|功能描述)\s*[:：]\s*(.+)", content)
    if not match:
        return ""
    return match.group(1).strip().splitlines()[0]


def infer_load_mode(description: str, recv_plan: str) -> str:
    normalized_description = (description or "").strip()
    normalized_recv_plan = (recv_plan or "").strip().lower()

    if "全量" in normalized_description:
        return LOAD_MODE_FULL
    if "增量" in normalized_description:
        return LOAD_MODE_INCR
    if "拉链" in normalized_description:
        if normalized_recv_plan in {LOAD_MODE_FULL, LOAD_MODE_FULL_ZIP}:
            return LOAD_MODE_FULL_ZIP
        if normalized_recv_plan in {LOAD_MODE_INCR, LOAD_MODE_INCR_ZIP}:
            return LOAD_MODE_INCR_ZIP
        return LOAD_MODE_INCR_ZIP
    return normalized_recv_plan


def find_py_files(directory: str) -> list[str]:
    return [str(path) for path in Path(directory).rglob("*.py")]


def extract_table_mapping(sql: str) -> tuple[str, str]:
    normalized = re.sub(r"\s+", " ", normalize_sql(sql))
    insert_match = re.search(
        r"INSERT\s+INTO\s+([A-Z0-9_.$\"]+)", normalized, re.IGNORECASE
    )
    if not insert_match:
        raise ValueError("Cannot find target table after INSERT INTO")

    from_match = re.search(r"FROM\s+([A-Z0-9_.$\"]+)", normalized, re.IGNORECASE)
    if not from_match:
        raise ValueError("Cannot find source table after FROM")

    source_table = from_match.group(1).strip('"; ')
    target_table = insert_match.group(1).strip('"; ')
    return source_table.upper(), target_table.upper().replace("_TMP", "")


def parse_select_item(select_item: str, target_field: str) -> tuple[str, str]:
    item = re.sub(r"\s+", " ", select_item).strip()

    alias_match = re.search(r"\s+AS\s+[A-Z_][A-Z0-9_]*$", item, re.IGNORECASE)
    if alias_match:
        item = item[: alias_match.start()].strip()

    direct_match = re.fullmatch(
        r'(?:[A-Z_][A-Z0-9_]*\.)?"?([A-Z_][A-Z0-9_]*)"?', item, re.IGNORECASE
    )
    if direct_match:
        source_field = direct_match.group(1).upper()
        return source_field, infer_mapping_rule(item, source_field, target_field)

    fallback_field = re.sub(r"\s+", "", target_field).upper()
    return fallback_field, infer_mapping_rule(
        item, fallback_field, target_field, direct=False
    )


def infer_mapping_rule(
    select_item: str, source_field: str, target_field: str, direct: bool = True
) -> str:
    upper_item = select_item.upper()
    if not direct:
        if (
            "TO_DATE" in upper_item
            or "DATE_FORMAT" in upper_item
            or "YYYY-MM-DD" in upper_item
        ):
            return DATE_MAPPING_RULE
        return FALLBACK_MAPPING_RULE
    if source_field == target_field:
        return DEFAULT_MAPPING_RULE
    if source_field.endswith(("_DT", "_DATE")) or target_field.endswith("_DATE"):
        return DATE_MAPPING_RULE
    return DEFAULT_MAPPING_RULE


def extract_insert_select_mapping(sql: str) -> list[FieldMappingRow]:
    normalized = normalize_sql(sql)
    match = INSERT_SELECT_RE.search(normalized)
    if not match:
        return []

    target_fields = parse_target_fields(match.group(3))
    select_items = split_select_items(match.group(4))
    target_comments = extract_target_field_comments(sql)
    select_comments = extract_select_item_comments(sql)
    if not target_fields or not select_items:
        return []

    field_rows: list[FieldMappingRow] = []
    for index, (target_field, select_item) in enumerate(
        zip(target_fields, select_items, strict=False), start=1
    ):
        source_field_name, mapping_rule = parse_select_item(select_item, target_field)
        inline_comment = ""
        if index - 1 < len(select_comments):
            inline_comment = select_comments[index - 1]
        if not inline_comment and index - 1 < len(target_comments):
            inline_comment = target_comments[index - 1]
        field_rows.append(
            FieldMappingRow(
                source_field_name=source_field_name,
                target_field_name=target_field,
                field_order=index,
                mapping_rule=mapping_rule,
                source_field_comment=inline_comment,
            )
        )
    return field_rows


def parse_source_identity(source_table: str) -> tuple[str, str]:
    table_only = source_table.split(".")[-1].strip('"').upper()
    parts = [part for part in table_only.split("_") if part]
    if len(parts) >= 3:
        return parts[1].upper(), "_".join(parts[2:]).upper()
    if len(parts) >= 2:
        return parts[0].upper(), "_".join(parts[1:]).upper()
    return table_only, table_only


def split_schema_table(table_name: str) -> tuple[str | None, str]:
    if "." not in table_name:
        return None, table_name.strip('"').upper()
    schema_name, raw_table = table_name.split(".", 1)
    return schema_name.strip('"').upper(), raw_table.strip('"').upper()


def truncate_text(value: str, max_length: int) -> str:
    normalized = (value or "").strip()
    encoded = normalized.encode("utf-8")
    if len(encoded) <= max_length:
        return normalized
    return encoded[:max_length].decode("utf-8", errors="ignore")


def rows_to_dicts(columns: list[str], rows: list[tuple]) -> list[dict[str, object]]:
    return [dict(zip(columns, row, strict=True)) for row in rows]


def _safe_int(value: object, default: int = 0) -> int:
    try:
        return int(str(value))
    except (TypeError, ValueError, OverflowError):
        return default


def build_schema_name_set(table_names: list[str]) -> set[str]:
    schema_names = {
        schema_name
        for schema_name, _raw_table in (
            split_schema_table(name) for name in table_names
        )
        if schema_name
    }
    return schema_names or {"DWO"}


# Source Metadata Read-only Adapter: the following queries only read DWS/source
# metadata needed to construct the public import payload.
def load_upstream_system_map(profile: str) -> dict[str, int]:
    """Resolve only unique machine/readable upstream identities.

    ``system_name`` is intentionally excluded: it is a display attribute and
    may be shared by multiple upstream systems.  ``system_abbr`` is also
    accepted only while it remains unambiguous; duplicate abbreviations are
    omitted instead of silently selecting the first row.
    """
    sql = """
SELECT
    system_pk,
    UPPER(COALESCE(system_abbr, '')) AS system_abbr,
    UPPER(COALESCE(system_id, '')) AS system_id
FROM dwp.p_upstream_system
WHERE is_deleted = 'N'
"""
    columns, rows = fetch_all(profile, sql)
    candidates: dict[str, set[int]] = {}
    for row in rows_to_dicts(columns, rows):
        system_pk = _safe_int(row.get("system_pk"))
        if system_pk <= 0:
            continue
        for key in ("system_abbr", "system_id"):
            value = str(row.get(key) or "").strip().upper()
            if value:
                candidates.setdefault(value, set()).add(system_pk)
    return {
        key: next(iter(system_pks))
        for key, system_pks in candidates.items()
        if len(system_pks) == 1
    }


def load_recv_dwf_map(profile: str) -> dict[str, RecvDwfMeta]:
    try:
        columns, rows = fetch_all(
            profile,
            "SELECT recv_plan, data_source, table_name FROM dwp.p_recv_dwf",
        )
    except Exception:
        return {}

    mapping: dict[str, RecvDwfMeta] = {}
    for row in rows_to_dicts(columns, rows):
        table_name = str(row.get("table_name") or "").strip().upper()
        recv_plan = str(row.get("recv_plan") or "").strip().lower()
        data_source = str(row.get("data_source") or "").strip().upper()
        if table_name:
            mapping[table_name] = RecvDwfMeta(
                load_mode=recv_plan, data_source=data_source
            )
    return mapping


def load_table_comment_map(
    profile: str, table_names: list[str]
) -> dict[tuple[str | None, str], str]:
    if not table_names:
        return {}

    comments: dict[tuple[str | None, str], str] = {}
    for schema_name in sorted(build_schema_name_set(table_names)):
        print(f"[meta] loading table comments for schema={schema_name}")
        sql = """
SELECT COALESCE(MAX("comments"), '') AS table_comment
     , UPPER(table_name) AS raw_table
FROM all_tab_comments
WHERE UPPER(owner) = ?
GROUP BY UPPER(table_name)
"""
        columns, rows = fetch_all(profile, sql, params=(schema_name,))
        for row in rows_to_dicts(columns, rows):
            raw_table = str(row["raw_table"]).upper()
            comments[(schema_name, raw_table)] = str(
                row.get("table_comment") or ""
            ).strip()
    return comments


def load_source_column_map(
    profile: str, table_names: list[str]
) -> dict[str, dict[str, dict[str, str]]]:
    if not table_names:
        return {}

    comments_by_table: dict[tuple[str | None, str], dict[str, str]] = {}
    for schema_name in sorted(build_schema_name_set(table_names)):
        print(f"[meta] loading column comments for schema={schema_name}")
        comment_sql = """
SELECT UPPER(column_name) AS column_name, COALESCE("comments", '') AS column_comment
     , UPPER(table_name) AS raw_table
FROM all_col_comments
WHERE UPPER(owner) = ?
"""
        comment_columns, comment_rows = fetch_all(
            profile, comment_sql, params=(schema_name,)
        )
        for row in rows_to_dicts(comment_columns, comment_rows):
            raw_table = str(row["raw_table"]).upper()
            comments_by_table.setdefault((schema_name, raw_table), {})[
                str(row["column_name"]).upper()
            ] = str(row.get("column_comment") or "").strip()

    data_types_by_table: dict[tuple[str | None, str], dict[str, str]] = {}
    for schema_name in sorted(build_schema_name_set(table_names)):
        print(f"[meta] loading column types for schema={schema_name}")
        type_sql = """
SELECT
    UPPER(COALESCE(table_schema, '')) AS table_schema,
    UPPER(table_name) AS raw_table,
    UPPER(column_name) AS column_name,
    COALESCE(
        CASE
            WHEN character_maximum_length IS NOT NULL THEN data_type || '(' || character_maximum_length || ')'
            WHEN numeric_precision IS NOT NULL AND numeric_scale IS NOT NULL THEN data_type || '(' || numeric_precision || ',' || numeric_scale || ')'
            WHEN numeric_precision IS NOT NULL THEN data_type || '(' || numeric_precision || ')'
            ELSE data_type
        END,
        ''
    ) AS data_type
FROM information_schema.columns
WHERE UPPER(table_schema) = ?
"""
        type_columns, type_rows = fetch_all(profile, type_sql, params=(schema_name,))
        for row in rows_to_dicts(type_columns, type_rows):
            raw_table = str(row["raw_table"]).upper()
            key = (schema_name, raw_table)
            data_types_by_table.setdefault(key, {})[str(row["column_name"]).upper()] = (
                str(row.get("data_type") or "").strip().upper()
            )

    result: dict[str, dict[str, dict[str, str]]] = {}
    for table_name in table_names:
        schema_name, raw_table = split_schema_table(table_name)
        key = (schema_name, raw_table)
        comments = comments_by_table.get(key, {})
        data_types = data_types_by_table.get(key, {})
        column_map: dict[str, dict[str, str]] = {}
        for column_name in set(comments) | set(data_types):
            column_map[column_name] = {
                "comment": comments.get(column_name, ""),
                "type": data_types.get(column_name, ""),
            }
        result[table_name] = column_map
    return result


def build_table_rows(profile: str, directory: str) -> list[TableMappingRow]:
    upstream_system_map = load_upstream_system_map(profile)
    recv_dwf_map = load_recv_dwf_map(profile)

    parsed_rows: list[ParsedScriptRow] = []
    skipped_tables: list[str] = []
    for file_index, py_file in enumerate(find_py_files(directory), start=1):
        insert_sql = find_first_insert_sql(py_file)
        if not insert_sql:
            continue

        fields = extract_insert_select_mapping(insert_sql)
        if not fields:
            continue

        source_table, target_table = extract_table_mapping(insert_sql)
        _legacy_system_abbr, source_table_name = parse_source_identity(source_table)
        recv_dwf_meta = recv_dwf_map.get(target_table)
        if recv_dwf_meta is None:
            skipped_tables.append(
                f"skip: missing p_recv_dwf metadata, target_table={target_table}, file={py_file}"
            )
            print(f"[skip] missing p_recv_dwf metadata: {target_table} ({py_file})")
            continue

        upstream_system_id = upstream_system_map.get(recv_dwf_meta.data_source)
        if upstream_system_id is None:
            skipped_tables.append(
                f"skip: missing or ambiguous upstream system identity, "
                f"data_source={recv_dwf_meta.data_source}, target_table={target_table}, file={py_file}"
            )
            print(
                f"[skip] missing or ambiguous upstream system identity: "
                f"data_source={recv_dwf_meta.data_source}, target_table={target_table} ({py_file})"
            )
            continue

        description = extract_function_description(py_file)
        load_mode = infer_load_mode(description, recv_dwf_meta.load_mode)
        parsed_rows.append(
            ParsedScriptRow(
                file_index=file_index,
                file_path=py_file,
                source_table=source_table,
                source_table_name=source_table_name,
                target_table=target_table,
                recv_dwf_meta=RecvDwfMeta(
                    load_mode=load_mode, data_source=recv_dwf_meta.data_source
                ),
                upstream_system_id=upstream_system_id,
                description=description,
                fields=fields,
            )
        )
        print(f"{file_index}: {source_table} -> {target_table}")

    source_tables = [row.source_table for row in parsed_rows]
    source_columns_map = load_source_column_map(profile, source_tables)
    table_comment_map = load_table_comment_map(profile, source_tables)

    table_rows: list[TableMappingRow] = []
    for row in parsed_rows:
        source_columns = source_columns_map.get(row.source_table, {})
        source_table_cn = (
            table_comment_map.get(split_schema_table(row.source_table), "")
            or row.source_table_name
        )
        table_rows.append(
            TableMappingRow(
                upstream_system_id=row.upstream_system_id,
                file_path=row.file_path,
                source_table=row.source_table,
                source_table_name=row.source_table_name,
                source_table_cn=source_table_cn,
                target_table_name=row.target_table,
                load_mode=row.recv_dwf_meta.load_mode,
                table_desc=row.description,
                fields=row.fields,
                source_columns=source_columns,
            )
        )
    if skipped_tables:
        print(f"Skipped {len(skipped_tables)} table(s).")
    return table_rows


def validate_table_rows(table_rows: list[TableMappingRow]) -> None:
    duplicate_messages: list[str] = []
    for table_index, table_row in enumerate(table_rows, start=1):
        seen_pairs: set[tuple[str, str]] = set()
        duplicate_pairs: list[tuple[str, str]] = []
        for field in table_row.fields:
            source_field_name = (field.source_field_name or "").strip().upper()
            target_field_name = (field.target_field_name or "").strip().upper()
            if not source_field_name:
                continue
            pair = (source_field_name, target_field_name)
            if pair in seen_pairs and pair not in duplicate_pairs:
                duplicate_pairs.append(pair)
                continue
            seen_pairs.add(pair)
        if duplicate_pairs:
            duplicate_messages.append(
                f"item={table_index}, source_table={table_row.source_table}, "
                f"target_table={table_row.target_table_name}, file={table_row.file_path}, "
                "duplicate_field_mappings="
                + "; ".join(
                    f"{source_field_name} -> {target_field_name or '<EMPTY>'}"
                    for source_field_name, target_field_name in duplicate_pairs
                )
            )
    if duplicate_messages:
        raise ValueError(
            "Duplicate source/target field mapping detected before API submission.\n"
            + "\n".join(duplicate_messages)
        )


def _import_field_payload(
    field: FieldMappingRow, table_row: TableMappingRow
) -> dict[str, object]:
    column_meta = table_row.source_columns.get(field.source_field_name, {})
    source_field_comment = truncate_text(
        field.source_field_comment or column_meta.get("comment", ""),
        MAX_SOURCE_FIELD_COMMENT_LENGTH,
    )
    return {
        "sourceField": field.source_field_name,
        "sourceType": column_meta.get("type") or None,
        "sourceComment": source_field_comment or None,
        "targetField": field.target_field_name or None,
        "mappingRule": field.mapping_rule or FALLBACK_MAPPING_RULE,
        "fieldOrder": field.field_order,
    }


def build_import_payload(
    table_rows: list[TableMappingRow], *, dry_run: bool = False
) -> dict[str, object]:
    """Build the public contract without touching the Portal database."""
    items = []
    for table_row in table_rows:
        items.append(
            {
                "sourceSystemId": table_row.upstream_system_id,
                "sourceTable": table_row.source_table_name,
                "sourceTableCn": table_row.source_table_cn or None,
                "targetLayer": DEFAULT_TARGET_LAYER,
                "targetTable": table_row.target_table_name or None,
                "loadMode": table_row.load_mode or None,
                "tableDesc": table_row.table_desc or None,
                "fields": [
                    _import_field_payload(field, table_row)
                    for field in table_row.fields
                ],
            }
        )
    return {"mode": "upsert", "dryRun": dry_run, "items": items}


class FieldMappingApiError(RuntimeError):
    """A transport or contract error returned by the Field Mapping API."""


class FieldMappingApiClient:
    """Small synchronous client for the existing Portal session contract."""

    def __init__(
        self,
        base_url: str,
        *,
        timeout: float = 30.0,
        session_cookie: str | None = None,
        client: httpx.Client | None = None,
    ) -> None:
        normalized_url = (base_url or "").strip().rstrip("/")
        if not normalized_url:
            raise ValueError("api base URL must be provided")
        headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
        }
        if client is None:
            self._client = httpx.Client(
                base_url=normalized_url,
                timeout=timeout,
                headers=headers,
            )
        else:
            self._client = client
            self._client.headers.update(headers)
        self._owns_client = client is None
        cookie = (session_cookie or "").strip()
        if cookie:
            self._client.headers.update({"Cookie": cookie})

    def close(self) -> None:
        if self._owns_client:
            self._client.close()

    def __enter__(self) -> FieldMappingApiClient:
        return self

    def __exit__(self, _exc_type, _exc_value, _traceback) -> None:
        self.close()

    def import_mappings(self, payload: dict[str, object]) -> dict[str, Any]:
        try:
            response = self._client.post("/api/field-mappings/import", json=payload)
        except httpx.HTTPError as error:
            raise FieldMappingApiError(
                "Field Mapping API request failed; check the API URL and timeout"
            ) from error
        try:
            data = response.json()
        except ValueError as error:
            raise FieldMappingApiError(
                f"Field Mapping API returned invalid JSON (HTTP {response.status_code})"
            ) from error
        if response.status_code >= 400:
            error_data = data.get("error") if isinstance(data, dict) else None
            message = (
                error_data.get("message")
                if isinstance(error_data, dict)
                else "request rejected"
            )
            raise FieldMappingApiError(
                f"Field Mapping API rejected the batch (HTTP {response.status_code}): {message}"
            )
        if not isinstance(data, dict) or not isinstance(data.get("summary"), dict):
            raise FieldMappingApiError(
                "Field Mapping API response did not match the import contract"
            )
        return data


def execute_import(
    client: FieldMappingApiClient,
    table_rows: list[TableMappingRow],
    *,
    dry_run: bool = False,
    batch_size: int = 100,
) -> dict[str, int]:
    """Submit table mappings in bounded batches and aggregate API summaries."""
    if batch_size < 1:
        raise ValueError("batch_size must be a positive integer")
    summary = {
        "received": 0,
        "created": 0,
        "updated": 0,
        "unchanged": 0,
        "failed": 0,
        "fieldCount": 0,
    }
    for start in range(0, len(table_rows), batch_size):
        batch = table_rows[start : start + batch_size]
        result = client.import_mappings(build_import_payload(batch, dry_run=dry_run))
        batch_summary = result["summary"]
        for key in summary:
            summary[key] += _safe_int(batch_summary.get(key))
        print(
            f"[batch {start // batch_size + 1}] received={batch_summary.get('received', 0)} "
            f"created={batch_summary.get('created', 0)} "
            f"updated={batch_summary.get('updated', 0)} "
            f"unchanged={batch_summary.get('unchanged', 0)} "
            f"failed={batch_summary.get('failed', 0)}"
        )
        for item in result.get("items", []):
            if item.get("action") == "failed":
                print(
                    f"[failed] index={item.get('index')} identity={item.get('identity')} "
                    f"error={item.get('error')}",
                    file=sys.stderr,
                )
    print(
        f"Import summary: received={summary['received']} created={summary['created']} "
        f"updated={summary['updated']} unchanged={summary['unchanged']} "
        f"failed={summary['failed']} fieldCount={summary['fieldCount']}"
    )
    return summary


def main() -> None:
    args = parse_args()
    profile = (
        (args.profile or "").strip()
        or os.environ.get("ASSET_DB_PROFILE", "").strip()
        or resolve_db_profile_name(fallback="gauss_primary")
    )
    api_base_url = (args.api_base_url or "").strip()
    if not api_base_url:
        raise SystemExit("--api-base-url or DAP_API_BASE_URL is required")
    table_rows = build_table_rows(profile, args.directory)
    validate_table_rows(table_rows)
    try:
        with FieldMappingApiClient(
            api_base_url,
            timeout=args.timeout,
            session_cookie=args.session_cookie,
        ) as client:
            summary = execute_import(
                client,
                table_rows,
                dry_run=args.dry_run,
                batch_size=args.batch_size,
            )
    except FieldMappingApiError as error:
        print(f"[error] {error}", file=sys.stderr)
        raise SystemExit(1) from error
    if summary["failed"]:
        raise SystemExit("Field Mapping API reported failed item(s)")
    print("Finished submitting Field Mapping imports through the Portal API.")


if __name__ == "__main__":
    main()
