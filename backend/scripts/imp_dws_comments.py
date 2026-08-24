# -*- coding: utf-8 -*-
"""Load DWS mapping scripts into p_field_mapping_table and p_field_mapping_field."""

from __future__ import annotations

import argparse
import os
import re
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.db.facade import connect_with_profile, fetch_all, resolve_db_profile_name


# 默认脚本目录：优先环境变量，其次 generic 部署路径。
# 作者本机工作区路径不再作为默认值入库。
DEFAULT_DIRECTORY = os.environ.get(
    "DWS_SCRIPT_DIR", "/opt/data-asset-portal/dws-scripts"
)

DEFAULT_TARGET_LAYER = "DWF"
DEFAULT_MAPPING_RULE = "\u76f4\u63a5\u6620\u5c04"
FALLBACK_MAPPING_RULE = "\u5f85\u8865\u5145"
DATE_MAPPING_RULE = "\u65e5\u671f\u683c\u5f0f\u5316"
SYSTEM_USER = "system"
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
    field_total_count: int
    mapped_field_count: int
    table_desc: str
    latest_mapping_time: str
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


@dataclass
class FieldMappingTableLayout:
    has_upstream_system_id: bool
    has_system_pk: bool


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Parse DWS INSERT...SELECT scripts and load app field mapping tables."
    )
    parser.add_argument("--profile", default="gauss_primary", help="Database profile name. Defaults to ASSET_DB_PROFILE.")
    parser.add_argument(
        "--directory",
        default=DEFAULT_DIRECTORY,
        help="Directory containing ETL Python files. Defaults to DWS_SCRIPT_DIR env or /opt/data-asset-portal/dws-scripts.",
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
    return [field.strip().strip('"').upper() for field in split_select_items(raw_fields) if field.strip()]


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

    tail = content[start.start():]
    markers: list[int] = []
    for pattern in (r'"""\s*$', r"'''\s*$", r"\n\s*run_sql", r"\n\s*def\s+", r"\n\s*class\s+"):
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
    insert_match = re.search(r"INSERT\s+INTO\s+([A-Z0-9_.$\"]+)", normalized, re.IGNORECASE)
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

    direct_match = re.fullmatch(r'(?:[A-Z_][A-Z0-9_]*\.)?"?([A-Z_][A-Z0-9_]*)"?', item, re.IGNORECASE)
    if direct_match:
        source_field = direct_match.group(1).upper()
        return source_field, infer_mapping_rule(item, source_field, target_field)

    fallback_field = re.sub(r"\s+", "", target_field).upper()
    return fallback_field, infer_mapping_rule(item, fallback_field, target_field, direct=False)


def infer_mapping_rule(select_item: str, source_field: str, target_field: str, direct: bool = True) -> str:
    upper_item = select_item.upper()
    if not direct:
        if "TO_DATE" in upper_item or "DATE_FORMAT" in upper_item or "YYYY-MM-DD" in upper_item:
            return DATE_MAPPING_RULE
        return FALLBACK_MAPPING_RULE
    if source_field == target_field:
        return DEFAULT_MAPPING_RULE
    if source_field.endswith("_DT") or source_field.endswith("_DATE") or target_field.endswith("_DATE"):
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
    for index, (target_field, select_item) in enumerate(zip(target_fields, select_items), start=1):
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


def escape_sql(value: object) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, (int, float)):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def truncate_text(value: str, max_length: int) -> str:
    normalized = (value or "").strip()
    encoded = normalized.encode("utf-8")
    if len(encoded) <= max_length:
        return normalized
    return encoded[:max_length].decode("utf-8", errors="ignore")


def rows_to_dicts(columns: list[str], rows: list[tuple]) -> list[dict[str, object]]:
    return [dict(zip(columns, row)) for row in rows]


def build_schema_name_set(table_names: list[str]) -> set[str]:
    schema_names = {schema_name for schema_name, _raw_table in (split_schema_table(name) for name in table_names) if schema_name}
    return schema_names or {"DWO"}


def load_upstream_system_map(profile: str) -> dict[str, int]:
    sql = """
SELECT
    system_pk,
    UPPER(COALESCE(system_abbr, '')) AS system_abbr,
    UPPER(COALESCE(system_id, '')) AS system_id,
    UPPER(COALESCE(system_name, '')) AS system_name
FROM dwp.p_upstream_system
WHERE is_deleted = 'N'
"""
    columns, rows = fetch_all(profile, sql)
    mapping: dict[str, int] = {}
    for row in rows_to_dicts(columns, rows):
        system_pk = int(row["system_pk"])
        for key in ("system_abbr", "system_id", "system_name"):
            value = str(row.get(key) or "").strip().upper()
            if value and value not in mapping:
                mapping[value] = system_pk
    return mapping


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
            mapping[table_name] = RecvDwfMeta(load_mode=recv_plan, data_source=data_source)
    return mapping


def load_field_mapping_table_layout(profile: str) -> FieldMappingTableLayout:
    sql = """
SELECT UPPER(column_name) AS column_name
FROM information_schema.columns
WHERE UPPER(table_schema) = 'DWP'
  AND UPPER(table_name) = 'P_FIELD_MAPPING_TABLE'
"""
    columns, rows = fetch_all(profile, sql)
    column_names = {
        str(row["column_name"]).upper()
        for row in rows_to_dicts(columns, rows)
    }
    return FieldMappingTableLayout(
        has_upstream_system_id="UPSTREAM_SYSTEM_ID" in column_names,
        has_system_pk="SYSTEM_PK" in column_names,
    )


def load_table_comment_map(profile: str, table_names: list[str]) -> dict[tuple[str | None, str], str]:
    if not table_names:
        return {}

    comments: dict[tuple[str | None, str], str] = {}
    for schema_name in sorted(build_schema_name_set(table_names)):
        print(f"[meta] loading table comments for schema={schema_name}")
        sql = f"""
SELECT COALESCE(MAX("comments"), '') AS table_comment
     , UPPER(table_name) AS raw_table
FROM all_tab_comments
WHERE UPPER(owner) = {escape_sql(schema_name)}
GROUP BY UPPER(table_name)
"""
        columns, rows = fetch_all(profile, sql)
        for row in rows_to_dicts(columns, rows):
            raw_table = str(row["raw_table"]).upper()
            comments[(schema_name, raw_table)] = str(row.get("table_comment") or "").strip()
    return comments


def load_source_column_map(profile: str, table_names: list[str]) -> dict[str, dict[str, dict[str, str]]]:
    if not table_names:
        return {}

    table_pairs = {split_schema_table(table_name) for table_name in table_names}
    comments_by_table: dict[tuple[str | None, str], dict[str, str]] = {}
    for schema_name in sorted(build_schema_name_set(table_names)):
        print(f"[meta] loading column comments for schema={schema_name}")
        comment_sql = f"""
SELECT UPPER(column_name) AS column_name, COALESCE("comments", '') AS column_comment
     , UPPER(table_name) AS raw_table
FROM all_col_comments
WHERE UPPER(owner) = {escape_sql(schema_name)}
"""
        comment_columns, comment_rows = fetch_all(profile, comment_sql)
        for row in rows_to_dicts(comment_columns, comment_rows):
            raw_table = str(row["raw_table"]).upper()
            comments_by_table.setdefault((schema_name, raw_table), {})[str(row["column_name"]).upper()] = str(
                row.get("column_comment") or ""
            ).strip()

    data_types_by_table: dict[tuple[str | None, str], dict[str, str]] = {}
    for schema_name in sorted(build_schema_name_set(table_names)):
        print(f"[meta] loading column types for schema={schema_name}")
        type_sql = f"""
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
WHERE UPPER(table_schema) = {escape_sql(schema_name)}
"""
        type_columns, type_rows = fetch_all(profile, type_sql)
        for row in rows_to_dicts(type_columns, type_rows):
            raw_table = str(row["raw_table"]).upper()
            key = (schema_name, raw_table)
            data_types_by_table.setdefault(key, {})[str(row["column_name"]).upper()] = str(
                row.get("data_type") or ""
            ).strip().upper()

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
    now_text = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

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
            skipped_tables.append(f"skip: missing p_recv_dwf metadata, target_table={target_table}, file={py_file}")
            print(f"[skip] missing p_recv_dwf metadata: {target_table} ({py_file})")
            continue

        upstream_system_id = upstream_system_map.get(recv_dwf_meta.data_source)
        if upstream_system_id is None:
            skipped_tables.append(
                f"skip: missing upstream system, data_source={recv_dwf_meta.data_source}, "
                f"target_table={target_table}, file={py_file}"
            )
            print(
                f"[skip] missing upstream system: data_source={recv_dwf_meta.data_source}, "
                f"target_table={target_table} ({py_file})"
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
                recv_dwf_meta=RecvDwfMeta(load_mode=load_mode, data_source=recv_dwf_meta.data_source),
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
        source_table_cn = table_comment_map.get(split_schema_table(row.source_table), "") or row.source_table_name
        mapped_field_count = sum(1 for field in row.fields if field.target_field_name)
        table_rows.append(
            TableMappingRow(
                upstream_system_id=row.upstream_system_id,
                file_path=row.file_path,
                source_table=row.source_table,
                source_table_name=row.source_table_name,
                source_table_cn=source_table_cn,
                target_table_name=row.target_table,
                load_mode=row.recv_dwf_meta.load_mode,
                field_total_count=len(row.fields),
                mapped_field_count=mapped_field_count,
                table_desc=row.description,
                latest_mapping_time=now_text,
                fields=row.fields,
                source_columns=source_columns,
            )
        )
    if skipped_tables:
        print(f"Skipped {len(skipped_tables)} table(s).")
    return table_rows


def validate_table_rows(table_rows: list[TableMappingRow]) -> None:
    duplicate_messages: list[str] = []
    for table_pk, table_row in enumerate(table_rows, start=1):
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
                "table_pk={table_pk}, source_table={source_table}, source_table_name={source_table_name}, "
                "target_table={target_table}, file={file_path}, duplicate_field_mappings={duplicate_fields}".format(
                    table_pk=table_pk,
                    source_table=table_row.source_table,
                    source_table_name=table_row.source_table_name,
                    target_table=table_row.target_table_name,
                    file_path=table_row.file_path,
                    duplicate_fields="; ".join(
                        f"{source_field_name} -> {target_field_name or '<EMPTY>'}"
                        for source_field_name, target_field_name in duplicate_pairs
                    ),
                )
            )
    if duplicate_messages:
        raise ValueError(
            "Duplicate source/target field mapping detected before insert into dwp.p_field_mapping_field.\n"
            + "\n".join(duplicate_messages)
        )


def build_table_insert_statement(
    table_row: TableMappingRow,
    table_pk: int,
    layout: FieldMappingTableLayout,
    now_text: str,
) -> str:
    table_columns = ["table_pk"]
    table_values = [str(table_pk)]
    if layout.has_upstream_system_id:
        table_columns.append("upstream_system_id")
        table_values.append(str(table_row.upstream_system_id))
    if layout.has_system_pk:
        table_columns.append("system_pk")
        table_values.append(str(table_row.upstream_system_id))
    table_columns.extend(
        [
            "source_table_name",
            "source_table_cn",
            "target_layer_code",
            "target_table_name",
            "load_mode",
            "field_total_count",
            "mapped_field_count",
            "latest_mapping_time",
            "table_desc",
            "is_deleted",
            "created_by",
            "created_at",
            "updated_by",
            "updated_at",
        ]
    )
    table_values.extend(
        [
            escape_sql(table_row.source_table_name),
            escape_sql(table_row.source_table_cn),
            escape_sql(DEFAULT_TARGET_LAYER),
            escape_sql(table_row.target_table_name),
            escape_sql(table_row.load_mode),
            str(table_row.field_total_count),
            str(table_row.mapped_field_count),
            escape_sql(table_row.latest_mapping_time),
            escape_sql(table_row.table_desc),
            "'N'",
            escape_sql(SYSTEM_USER),
            escape_sql(now_text),
            escape_sql(SYSTEM_USER),
            escape_sql(now_text),
        ]
    )
    return f"""
INSERT INTO dwp.p_field_mapping_table (
    {', '.join(table_columns)}
) VALUES (
    {', '.join(table_values)}
)
""".strip()


def build_field_insert_statement(
    field: FieldMappingRow,
    table_row: TableMappingRow,
    table_pk: int,
    field_pk: int,
    now_text: str,
) -> str:
    column_meta = table_row.source_columns.get(field.source_field_name, {})
    source_field_comment = truncate_text(
        field.source_field_comment or column_meta.get("comment", ""),
        MAX_SOURCE_FIELD_COMMENT_LENGTH,
    )
    return f"""
INSERT INTO dwp.p_field_mapping_field (
    field_pk, table_pk, source_field_name, source_field_type, source_field_comment,
    target_field_name, mapping_rule, field_order, is_deleted,
    created_by, created_at, updated_by, updated_at
) VALUES (
    {field_pk},
    {table_pk},
    {escape_sql(field.source_field_name)},
    {escape_sql(column_meta.get('type', ''))},
    {escape_sql(source_field_comment)},
    {escape_sql(field.target_field_name)},
    {escape_sql(field.mapping_rule)},
    {field.field_order},
    'N',
    {escape_sql(SYSTEM_USER)},
    {escape_sql(now_text)},
    {escape_sql(SYSTEM_USER)},
    {escape_sql(now_text)}
)
""".strip()


def execute_import(profile: str, table_rows: list[TableMappingRow], layout: FieldMappingTableLayout) -> None:
    conn = None
    curs = None
    now_text = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    field_pk = 1
    imported_table_count = 0
    failed_tables: list[str] = []
    try:
        conn = connect_with_profile(profile)
        curs = conn.cursor()
        curs.execute("TRUNCATE TABLE dwp.p_field_mapping_field")
        curs.execute("TRUNCATE TABLE dwp.p_field_mapping_table")
        conn.commit()

        for table_pk, table_row in enumerate(table_rows, start=1):
            try:
                curs.execute(build_table_insert_statement(table_row, table_pk, layout, now_text))
                for field in table_row.fields:
                    curs.execute(build_field_insert_statement(field, table_row, table_pk, field_pk, now_text))
                    field_pk += 1
                conn.commit()
                imported_table_count += 1
            except Exception as exc:
                try:
                    conn.rollback()
                except Exception as rollback_exc:
                    raise RuntimeError(
                        f"Failed to roll back import for table_pk={table_pk}"
                    ) from rollback_exc
                failed_message = (
                    "table_pk={table_pk}, file={file_path}, source_table={source_table}, "
                    "source_table_name={source_table_name}, target_table={target_table}, "
                    "current_field_pk={field_pk}, error={error}".format(
                        table_pk=table_pk,
                        file_path=table_row.file_path,
                        source_table=table_row.source_table,
                        source_table_name=table_row.source_table_name,
                        target_table=table_row.target_table_name,
                        field_pk=field_pk,
                        error=exc,
                    )
                )
                failed_tables.append(failed_message)
                print(f"[skip] import failed: {failed_message}")

    except Exception:
        if conn is not None:
            try:
                conn.rollback()
            except Exception:
                pass
        raise
    finally:
        if curs is not None:
            try:
                curs.close()
            except Exception:
                pass
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass
    print(f"Imported {imported_table_count} table mappings successfully.")
    if failed_tables:
        print(f"Skipped {len(failed_tables)} table import error record(s).")
        for item in failed_tables:
            print(f"[failed] {item}")


def main() -> None:
    args = parse_args()
    profile = (args.profile or "").strip() or resolve_db_profile_name()
    table_rows = build_table_rows(profile, args.directory)
    validate_table_rows(table_rows)
    layout = load_field_mapping_table_layout(profile)
    print(
        f"[meta] field_mapping_table layout: "
        f"upstream_system_id={layout.has_upstream_system_id}, system_pk={layout.has_system_pk}"
    )
    execute_import(profile, table_rows, layout)
    print("Finished importing dwp.p_field_mapping_table / dwp.p_field_mapping_field")


if __name__ == "__main__":
    main()
