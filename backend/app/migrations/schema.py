"""Baseline initialization, schema reflection, drift comparison and stamping."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

from ..db.providers import gaussdb_schema_sql_identifier
from ..db.registry import get_provider

BASELINE_REVISION = "0001_baseline"
SUPPORTED_DIALECTS = ("sqlite", "postgresql", "mysql", "dws")
SCHEMA_ROOT = Path(__file__).resolve().parents[2] / "schema"
TABLE_RE = re.compile(r"CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(?:dwp\.)?([A-Za-z0-9_]+)", re.I)
CREATE_TABLE_RE = re.compile(
    r"CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+"
    r"(?:(?:[A-Za-z0-9_\"`]+)\.)?(?P<table>[A-Za-z0-9_\"`]+)\s*\(",
    re.I,
)


@dataclass(frozen=True)
class ForeignKeySpec:
    columns: tuple[str, ...]
    referenced_table: str
    referenced_columns: tuple[str, ...]
    on_delete: str | None = None


@dataclass
class ColumnSpec:
    name: str
    type_name: str
    nullable: bool
    default: str | None
    primary_key: bool = False
    generated_by_default: bool = False


@dataclass
class IndexSpec:
    name: str
    columns: tuple[str, ...]
    unique: bool = False


@dataclass
class TableSpec:
    name: str
    columns: dict[str, ColumnSpec] = field(default_factory=dict)
    primary_key: tuple[str, ...] = ()
    unique_constraints: set[tuple[str, ...]] = field(default_factory=set)
    foreign_keys: set[ForeignKeySpec] = field(default_factory=set)
    indexes: dict[str, IndexSpec] = field(default_factory=dict)
    # Catalog constraint names are needed by the forward-only DWS adapter to
    # drop a legacy UNIQUE without guessing an auto-generated name.
    unique_constraint_names: dict[tuple[str, ...], str] = field(default_factory=dict)


@dataclass
class SchemaModel:
    tables: dict[str, TableSpec] = field(default_factory=dict)


@dataclass(frozen=True)
class ReflectionQuery:
    name: str
    sql: str
    params: tuple[Any, ...] = ()


@dataclass(frozen=True)
class SchemaMismatch:
    table: str
    object_type: str
    object_name: str
    expected: Any
    actual: Any
    reason: str

    def detail(self) -> str:
        return (
            f"table: {self.table}\n"
            f"object: {self.object_type}.{self.object_name}\n"
            f"expected: {self.expected!r}\n"
            f"actual: {self.actual!r}\n"
            f"reason: {self.reason}"
        )


def baseline_path(dialect: str, root: Path = SCHEMA_ROOT) -> Path:
    if dialect not in SUPPORTED_DIALECTS:
        raise ValueError(f"unsupported database dialect: {dialect}")
    path = root / f"{dialect}.sql"
    if not path.is_file():
        raise FileNotFoundError(f"database baseline not found: {path}")
    return path


def baseline_tables(dialect: str, root: Path = SCHEMA_ROOT) -> tuple[str, ...]:
    return tuple(TABLE_RE.findall(baseline_path(dialect, root).read_text(encoding="utf-8")))


def _split_sql_statements(sql: str) -> list[str]:
    """Split the baseline SQL subset without splitting quoted text or comments."""
    statements: list[str] = []
    current: list[str] = []
    quote: str | None = None
    line_comment = False
    block_depth = 0
    dollar_quote: str | None = None
    index = 0
    while index < len(sql):
        character = sql[index]
        pair = sql[index:index + 2]

        if line_comment:
            current.append(character)
            if character == "\n":
                line_comment = False
            index += 1
            continue
        if block_depth:
            if pair == "/*":
                current.extend(pair)
                block_depth += 1
                index += 2
            elif pair == "*/":
                current.extend(pair)
                block_depth -= 1
                index += 2
            else:
                current.append(character)
                index += 1
            continue
        if dollar_quote:
            if sql.startswith(dollar_quote, index):
                current.extend(dollar_quote)
                index += len(dollar_quote)
                dollar_quote = None
            else:
                current.append(character)
                index += 1
            continue
        if quote:
            current.append(character)
            if character == "\\" and quote in {"'", "`"} and index + 1 < len(sql):
                current.append(sql[index + 1])
                index += 2
                continue
            if character == quote:
                if index + 1 < len(sql) and sql[index + 1] == quote:
                    current.append(sql[index + 1])
                    index += 2
                    continue
                quote = None
            index += 1
            continue

        if pair == "--":
            current.extend(pair)
            line_comment = True
            index += 2
        elif pair == "/*":
            current.extend(pair)
            block_depth = 1
            index += 2
        elif character == "$":
            match = re.match(r"\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$", sql[index:])
            if match:
                dollar_quote = match.group(0)
                current.extend(dollar_quote)
                index += len(dollar_quote)
            else:
                current.append(character)
                index += 1
        elif character in "'\"`":
            quote = character
            current.append(character)
            index += 1
        elif character == ";":
            statement = "".join(current).strip()
            if statement:
                statements.append(statement)
            current = []
            index += 1
        else:
            current.append(character)
            index += 1

    if quote or block_depth or dollar_quote:
        raise ValueError("unterminated quote or comment in SQL baseline")
    statement = "".join(current).strip()
    if statement:
        statements.append(statement)
    return statements


def _split_top_level(text: str) -> list[str]:
    parts: list[str] = []
    current: list[str] = []
    depth = 0
    quote: str | None = None
    index = 0
    while index < len(text):
        character = text[index]
        if quote:
            current.append(character)
            if character == quote:
                if index + 1 < len(text) and text[index + 1] == quote:
                    current.append(text[index + 1])
                    index += 1
                else:
                    quote = None
        elif character in "'\"`":
            quote = character
            current.append(character)
        elif character == "(":
            depth += 1
            current.append(character)
        elif character == ")":
            depth -= 1
            current.append(character)
        elif character == "," and depth == 0:
            parts.append("".join(current).strip())
            current = []
        else:
            current.append(character)
        index += 1
    if "".join(current).strip():
        parts.append("".join(current).strip())
    return parts


def _identifier(value: str) -> str:
    return value.strip().strip('"`').lower()


def _identifier_list(value: str) -> tuple[str, ...]:
    return tuple(_identifier(item) for item in _split_top_level(value.strip().strip("()")) if item.strip())


def _table_name(value: str) -> str:
    return _identifier(value.split(".")[-1])


def _find_matching_parenthesis(sql: str, opening: int) -> int:
    depth = 1
    quote: str | None = None
    index = opening + 1
    while index < len(sql):
        character = sql[index]
        if quote:
            if character == quote:
                if index + 1 < len(sql) and sql[index + 1] == quote:
                    index += 1
                else:
                    quote = None
        elif character in "'\"`":
            quote = character
        elif character == "(":
            depth += 1
        elif character == ")":
            depth -= 1
            if depth == 0:
                return index
        index += 1
    raise ValueError("unterminated CREATE TABLE definition in baseline")


def _type_name(declaration: str) -> str:
    declaration = " ".join(declaration.strip().upper().split())
    match = re.match(
        r"(DOUBLE\s+PRECISION|CHARACTER\s+VARYING|CHARACTER|TIMESTAMP(?:\s+WITH(?:OUT)?\s+TIME\s+ZONE)?|"
        r"VARCHAR|CHAR|TEXT|BIGSERIAL|BIGINT|SMALLINT|INTEGER|INT|DECIMAL|NUMERIC|DATE|DATETIME|JSON|BOOLEAN|"
        r"REAL|FLOAT|BLOB)(?:\s*\(([^)]*)\))?",
        declaration,
        re.I,
    )
    if not match:
        return declaration.split()[0] if declaration else "UNKNOWN"
    base = re.sub(r"\s+", " ", match.group(1).upper())
    params = (match.group(2) or "").replace(" ", "")
    aliases = {
        "CHARACTER VARYING": "VARCHAR",
        "CHARACTER": "CHAR",
        "BIGSERIAL": "BIGINT",
        "INT": "INTEGER",
        "NUMERIC": "DECIMAL",
        "DOUBLE PRECISION": "FLOAT",
    }
    base = aliases.get(base, base)
    if base == "TIMESTAMP WITH TIME ZONE" or base == "TIMESTAMP WITHOUT TIME ZONE":
        base = "TIMESTAMP"
    return f"{base}({params})" if params else base


def _default_token(rest: str) -> str | None:
    # GENERATED BY DEFAULT AS IDENTITY is not a column default.
    rest = re.sub(r"\bGENERATED\s+BY\s+DEFAULT\s+AS\s+IDENTITY\b", "", rest, flags=re.I)
    match = re.search(r"\bDEFAULT\s+", rest, re.I)
    if not match:
        return None
    index = match.end()
    while index < len(rest) and rest[index].isspace():
        index += 1
    if index >= len(rest):
        return None
    if rest[index] in "'\"":
        quote = rest[index]
        end = index + 1
        while end < len(rest):
            if rest[end] == quote:
                if end + 1 < len(rest) and rest[end + 1] == quote:
                    end += 2
                    continue
                return rest[index:end + 1]
            end += 1
        return rest[index:]
    if rest[index] == "(":
        end = _find_matching_parenthesis(rest, index)
        return rest[index:end + 1]
    end = index
    while end < len(rest) and not rest[end].isspace():
        end += 1
    return rest[index:end]


def normalize_default(value: Any, type_name: str | None = None) -> str | None:
    """Normalize only the default forms used by the Community baseline."""
    if value is None:
        return None
    expression = str(value).strip()
    while expression.startswith("(") and expression.endswith(")"):
        try:
            if _find_matching_parenthesis(expression, 0) != len(expression) - 1:
                break
        except ValueError:
            break
        expression = expression[1:-1].strip()
    expression = re.sub(r"::[A-Za-z0-9_ .\[\]]+$", "", expression).strip()
    upper = expression.upper()
    if upper == "NULL":
        return None
    if upper in {"CURRENT_TIMESTAMP", "CURRENT_TIMESTAMP()", "NOW()", "CURRENT_DATE", "CURRENT_DATE()"}:
        return "CURRENT_TIMESTAMP" if upper.startswith(("CURRENT_TIMESTAMP", "NOW")) else "CURRENT_DATE"
    if len(expression) >= 2 and expression[0] == expression[-1] and expression[0] in "'\"":
        expression = expression[1:-1].replace(expression[0] * 2, expression[0])
    elif type_name and type_name.startswith(("CHAR", "VARCHAR", "TEXT")):
        # MySQL information_schema returns character defaults without quotes.
        expression = expression.strip("'")
    if type_name and type_name in {"INTEGER", "BIGINT", "SMALLINT", "DECIMAL", "FLOAT"}:
        try:
            number = Decimal(expression)
            return format(number.normalize(), "f")
        except (InvalidOperation, ValueError):
            pass
    return expression


def _is_sequence_default(value: Any) -> bool:
    if value is None:
        return False
    return bool(
        re.fullmatch(
            r"\s*nextval\s*\(\s*'(?:''|[^'])*'\s*(?:::\s*regclass)?\s*\)"
            r"\s*(?:::\s*(?:bigint|int8))?\s*",
            str(value),
            re.I,
        )
    )


def _normalize_reflected_column_default(
    value: Any,
    type_name: str,
    *,
    db_type: str,
    expected_column: ColumnSpec | None,
) -> str | None:
    if (
        db_type == "gaussdb"
        and expected_column is not None
        and expected_column.generated_by_default
        and _is_sequence_default(value)
    ):
        return None
    return normalize_default(value, type_name)


def _foreign_key_from_text(text: str) -> ForeignKeySpec | None:
    match = re.search(
        r"FOREIGN\s+KEY\s*\((?P<columns>[^)]*)\)\s+REFERENCES\s+"
        r"(?P<table>[A-Za-z0-9_\"`.]+)\s*\((?P<ref>[^)]*)\)(?P<actions>.*)",
        text,
        re.I | re.S,
    )
    if not match:
        return None
    delete_match = re.search(r"ON\s+DELETE\s+([A-Za-z ]+?)(?:\s+ON\s+UPDATE|$)", match.group("actions"), re.I)
    on_delete = " ".join(delete_match.group(1).upper().split()) if delete_match else None
    return ForeignKeySpec(
        _identifier_list(match.group("columns")),
        _table_name(match.group("table")),
        _identifier_list(match.group("ref")),
        on_delete,
    )


def _add_constraint(table: TableSpec, definition: str):
    normalized = " ".join(definition.split())
    upper = normalized.upper()
    if upper.startswith("CONSTRAINT "):
        normalized = normalized.split(None, 2)[-1] if len(normalized.split(None, 2)) == 3 else ""
        upper = normalized.upper()
    if upper.startswith("PRIMARY KEY"):
        table.primary_key = _identifier_list(normalized[normalized.find("("):])
        for column_name in table.primary_key:
            if column_name in table.columns:
                table.columns[column_name].primary_key = True
                table.columns[column_name].nullable = False
    elif upper.startswith("UNIQUE"):
        columns_start = normalized.find("(")
        if columns_start >= 0:
            table.unique_constraints.add(_identifier_list(normalized[columns_start:]))
    elif "FOREIGN KEY" in upper:
        foreign_key = _foreign_key_from_text(normalized)
        if foreign_key:
            table.foreign_keys.add(foreign_key)


def _parse_baseline_schema(dialect: str, root: Path) -> SchemaModel:
    sql = baseline_path(dialect, root).read_text(encoding="utf-8")
    model = SchemaModel()
    for match in CREATE_TABLE_RE.finditer(sql):
        table = TableSpec(_identifier(match.group("table")))
        closing = _find_matching_parenthesis(sql, match.end() - 1)
        for definition in _split_top_level(sql[match.end():closing]):
            if not definition:
                continue
            normalized = " ".join(definition.split())
            upper = normalized.upper()
            if upper.startswith(("CONSTRAINT ", "PRIMARY KEY", "UNIQUE", "CHECK", "FOREIGN KEY")):
                _add_constraint(table, normalized)
                continue
            column_match = re.match(r"(?P<name>[A-Za-z0-9_\"`]+)\s+(?P<rest>.+)", normalized, re.S)
            if not column_match:
                continue
            name = _identifier(column_match.group("name"))
            rest = column_match.group("rest")
            type_name = _type_name(rest)
            primary = bool(re.search(r"\bPRIMARY\s+KEY\b", rest, re.I))
            column = ColumnSpec(
                name=name,
                type_name=type_name,
                nullable=not bool(re.search(r"\bNOT\s+NULL\b", rest, re.I)) and not primary,
                default=normalize_default(_default_token(rest), type_name),
                primary_key=primary,
                generated_by_default=(
                    bool(re.match(r"\s*BIGSERIAL\b", rest, re.I))
                    or bool(re.search(r"\bGENERATED\s+BY\s+DEFAULT\s+AS\s+IDENTITY\b", rest, re.I))
                ),
            )
            table.columns[name] = column
            if primary:
                table.primary_key = (name,)
            if re.search(r"\bUNIQUE\b", rest, re.I):
                table.unique_constraints.add((name,))
            foreign_key = _foreign_key_from_text(rest)
            if foreign_key:
                table.foreign_keys.add(foreign_key)
        model.tables[table.name] = table

    for statement in _split_sql_statements(sql):
        index_match = re.search(
            r"CREATE\s+(?P<unique>UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?"
            r"(?P<name>[A-Za-z0-9_\"`.]+)\s+ON\s+(?P<table>[A-Za-z0-9_\"`.]+)\s*"
            r"\((?P<columns>[^)]*)\)", statement, re.I | re.S,
        )
        if index_match:
            table = model.tables.get(_table_name(index_match.group("table")))
            if table:
                name = _table_name(index_match.group("name"))
                table.indexes[name] = IndexSpec(
                    name=name,
                    columns=_identifier_list(index_match.group("columns")),
                    unique=bool(index_match.group("unique")),
                )
        alter_match = re.search(
            r"ALTER\s+TABLE\s+(?P<table>[A-Za-z0-9_\"`.]+)\s+ADD\s+"
            r"(?:CONSTRAINT\s+[A-Za-z0-9_\"`]+\s+)?(?P<constraint>.+)",
            statement,
            re.I | re.S,
        )
        if alter_match:
            table = model.tables.get(_table_name(alter_match.group("table")))
            if table:
                _add_constraint(table, alter_match.group("constraint"))
    return model


def baseline_schema(dialect: str, root: Path = SCHEMA_ROOT) -> SchemaModel:
    return _parse_baseline_schema(dialect, root)


def baseline_columns(dialect: str, root: Path = SCHEMA_ROOT) -> dict[str, set[str]]:
    return {name: set(table.columns) for name, table in baseline_schema(dialect, root).tables.items()}


def baseline_table_statements(
    dialect: str, tables: tuple[str, ...] | list[str] | set[str], root: Path = SCHEMA_ROOT
) -> tuple[str, ...]:
    """Return canonical baseline DDL for *tables* and their explicit indexes.

    Only ``CREATE TABLE`` and ``CREATE INDEX`` statements are returned; schema
    creation, ``ALTER TABLE`` and unrelated objects are intentionally excluded.
    The DWS adapters use this to create missing module tables with the exact
    distribution/constraint contract of the canonical baseline instead of
    duplicating historical DDL.
    """
    wanted = {name.lower() for name in tables}
    statements: list[str] = []
    for statement in _split_sql_statements(baseline_path(dialect, root).read_text(encoding="utf-8")):
        table_match = CREATE_TABLE_RE.search(statement)
        if table_match:
            if _identifier(table_match.group("table")) in wanted:
                statements.append(statement)
            continue
        index_match = re.search(
            r"CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?"
            r"[A-Za-z0-9_\"`.]+\s+ON\s+(?P<table>[A-Za-z0-9_\"`.]+)",
            statement,
            re.I,
        )
        if index_match and _table_name(index_match.group("table")) in wanted:
            statements.append(statement)
    return tuple(statements)


def verify_baselines(root: Path = SCHEMA_ROOT) -> tuple[str, ...]:
    expected = None
    for dialect in SUPPORTED_DIALECTS:
        names = set(baseline_tables(dialect, root))
        if expected is None:
            expected = names
        elif names != expected:
            missing = sorted(expected - names)
            extra = sorted(names - expected)
            raise ValueError(f"baseline schema mismatch for {dialect}: missing={missing}, extra={extra}")
    return tuple(sorted(expected or ()))


def _dws_schema(config: dict) -> str:
    provider = get_provider(config["type"])
    if provider.name != "gaussdb":
        raise ValueError("DWS migration requires a GaussDB profile")
    return provider.physical_schema(config)


def _prefix(config: dict) -> str:
    provider = get_provider(config["type"])
    schema = provider.physical_schema(config)
    if provider.name == "gaussdb":
        schema = gaussdb_schema_sql_identifier(schema)
    return f"{schema}." if schema else ""


def _render_schema_qualified_identifiers(
    sql: str, canonical_schema: str, target_schema: str
) -> str:
    """Map only SQL schema identifiers, leaving literals and comments intact."""
    rendered: list[str] = []
    target = gaussdb_schema_sql_identifier(target_schema)
    index = 0
    while index < len(sql):
        pair = sql[index:index + 2]
        character = sql[index]

        if pair == "--":
            end = sql.find("\n", index)
            if end < 0:
                rendered.append(sql[index:])
                break
            rendered.append(sql[index:end + 1])
            index = end + 1
            continue
        if pair == "/*":
            depth = 1
            end = index + 2
            while end < len(sql) and depth:
                nested = sql[end:end + 2]
                if nested == "/*":
                    depth += 1
                    end += 2
                elif nested == "*/":
                    depth -= 1
                    end += 2
                else:
                    end += 1
            rendered.append(sql[index:end])
            index = end
            continue
        if character == "$":
            match = re.match(r"\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$", sql[index:])
            if match:
                delimiter = match.group(0)
                close = sql.find(delimiter, index + len(delimiter))
                end = len(sql) if close < 0 else close + len(delimiter)
                rendered.append(sql[index:end])
                index = end
                continue
        if character == "'":
            end = index + 1
            while end < len(sql):
                if sql[end] == "\\" and end + 1 < len(sql):
                    end += 2
                elif sql[end] == "'":
                    if end + 1 < len(sql) and sql[end + 1] == "'":
                        end += 2
                    else:
                        end += 1
                        break
                else:
                    end += 1
            rendered.append(sql[index:end])
            index = end
            continue
        if character == '"':
            end = index + 1
            identifier: list[str] = []
            while end < len(sql):
                if sql[end] == '"':
                    if end + 1 < len(sql) and sql[end + 1] == '"':
                        identifier.append('"')
                        end += 2
                    else:
                        end += 1
                        break
                else:
                    identifier.append(sql[end])
                    end += 1
            after = end
            while after < len(sql) and sql[after].isspace():
                after += 1
            if (
                "".join(identifier) == canonical_schema
                and after < len(sql)
                and sql[after] == "."
            ):
                rendered.append(target + sql[end:after + 1])
                index = after + 1
            else:
                rendered.append(sql[index:end])
                index = end
            continue
        if character == "`":
            end = index + 1
            while end < len(sql):
                if sql[end] == "`":
                    if end + 1 < len(sql) and sql[end + 1] == "`":
                        end += 2
                    else:
                        end += 1
                        break
                else:
                    end += 1
            rendered.append(sql[index:end])
            index = end
            continue

        match = re.match(r"[A-Za-z_][A-Za-z0-9_$]*", sql[index:])
        if match:
            token = match.group(0)
            end = index + len(token)
            after = end
            while after < len(sql) and sql[after].isspace():
                after += 1
            is_schema = token.lower() == canonical_schema.lower()
            if is_schema and after < len(sql) and sql[after] == ".":
                rendered.append(target + sql[end:after + 1])
                index = after + 1
            else:
                rendered.append(token)
                index = end
            continue

        rendered.append(character)
        index += 1
    return "".join(rendered)


def render_baseline_for_profile(
    config: dict, dialect: str, root: Path = SCHEMA_ROOT
) -> str:
    """Render a canonical baseline for a profile without rewriting SQL values."""
    sql = baseline_path(dialect, root).read_text(encoding="utf-8")
    if dialect != "dws":
        return sql
    schema = _dws_schema(config)
    return _render_schema_qualified_identifiers(sql, "dwp", schema)


def _execute(connection, sql: str, *, split: bool):
    cursor = connection.cursor()
    try:
        statements = _split_sql_statements(sql) if split else (sql,)
        for statement in statements:
            if statement.strip():
                cursor.execute(statement)
    finally:
        cursor.close()


def _ledger_exists(connection, config: dict) -> bool:
    provider = get_provider(config["type"])
    cursor = connection.cursor()
    try:
        if provider.name == "sqlite":
            cursor.execute(
                "SELECT 1 FROM dwp.sqlite_master "
                "WHERE type = 'table' AND name = 'alembic_version'"
            )
        elif provider.name == "mysql":
            cursor.execute(
                "SELECT 1 FROM information_schema.tables "
                f"WHERE table_schema = DATABASE() AND table_name = {provider.placeholder}",
                ("alembic_version",),
            )
        else:
            schema = provider.physical_schema(config)
            if not schema:
                raise ValueError("database profile requires a physical schema for migration checks")
            cursor.execute(
                "SELECT 1 FROM information_schema.tables "
                f"WHERE table_schema = {provider.placeholder} "
                f"AND table_name = {provider.placeholder}",
                (schema, "alembic_version"),
            )
        return cursor.fetchone() is not None
    finally:
        cursor.close()


def current_revision(connection, config: dict) -> str | None:
    if not _ledger_exists(connection, config):
        return None

    cursor = connection.cursor()
    try:
        cursor.execute(f"SELECT version_num FROM {_prefix(config)}alembic_version")
        rows = cursor.fetchall()
        if len(rows) != 1:
            raise RuntimeError(
                "alembic_version must contain exactly one revision; "
                f"found {len(rows)} rows"
            )
        revision = rows[0][0]
        if revision is None or not str(revision).strip():
            raise RuntimeError("alembic_version contains an empty revision")
        return str(revision)
    finally:
        cursor.close()


def _assert_dws_schema_exists(connection, config: dict):
    schema = _dws_schema(config)
    cursor = connection.cursor()
    try:
        cursor.execute(
            "SELECT 1 FROM information_schema.schemata WHERE schema_name = ?",
            (schema,),
        )
        exists = cursor.fetchone() is not None
    finally:
        cursor.close()
    if not exists:
        raise RuntimeError(
            f"target schema '{schema}' does not exist; create it before applying migrations"
        )


def _has_user_tables(connection, config: dict) -> bool:
    db_type = config["type"]
    cursor = connection.cursor()
    try:
        if db_type == "sqlite":
            cursor.execute(
                "SELECT 1 FROM dwp.sqlite_master WHERE type='table' "
                "AND name <> 'alembic_version' LIMIT 1"
            )
        elif db_type == "mysql":
            cursor.execute(
                "SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() "
                "AND table_name <> 'alembic_version' LIMIT 1"
            )
        else:
            schema = get_provider(db_type).physical_schema(config)
            if not schema:
                raise ValueError("database profile requires a physical schema for migration checks")
            placeholder = get_provider(db_type).placeholder
            cursor.execute(
                "SELECT 1 FROM information_schema.tables WHERE table_schema = " + placeholder
                + " AND table_name <> 'alembic_version' LIMIT 1",
                (schema,),
            )
        return cursor.fetchone() is not None
    finally:
        cursor.close()


def stamp_revision(connection, config: dict, revision: str) -> None:
    """Record *revision* as the last fully verified logical revision."""
    _stamp(connection, config, revision)


def _stamp(connection, config: dict, revision: str = BASELINE_REVISION):
    prefix = _prefix(config)
    _execute(
        connection,
        f"CREATE TABLE IF NOT EXISTS {prefix}alembic_version "
        "(version_num VARCHAR(32) NOT NULL PRIMARY KEY)",
        split=False,
    )
    cursor = connection.cursor()
    try:
        cursor.execute(f"DELETE FROM {prefix}alembic_version")
        cursor.execute(
            f"INSERT INTO {prefix}alembic_version (version_num) VALUES ({get_provider(config['type']).placeholder})",
            (revision,),
        )
    finally:
        cursor.close()


def initialize(
    connection,
    config: dict,
    dialect: str,
    root: Path = SCHEMA_ROOT,
    *,
    initial_revision: str = BASELINE_REVISION,
) -> bool:
    if dialect == "dws":
        _assert_dws_schema_exists(connection, config)
    if current_revision(connection, config) is not None:
        return False
    if _has_user_tables(connection, config):
        raise RuntimeError("database already contains user tables; verify it and use baseline/stamp")
    sql = render_baseline_for_profile(config, dialect, root)
    try:
        _execute(connection, sql, split=dialect in {"sqlite", "mysql", "dws"})
        if dialect == "dws":
            # DWS's canonical baseline already represents repository head. The
            # physical schema must verify before any logical revision is recorded.
            verify_database(connection, config, dialect, root)
        _stamp(connection, config, initial_revision)
        connection.commit()
        return True
    except Exception:
        connection.rollback()
        raise


def _sqlite_identifier(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def _add_actual_constraint(table: TableSpec, constraint_type: str, name: str, columns: tuple[str, ...], ref_table=None, ref_columns=(), on_delete=None):
    if constraint_type == "PRIMARY KEY":
        table.primary_key = columns
    elif constraint_type == "UNIQUE":
        table.unique_constraints.add(columns)
    elif constraint_type == "FOREIGN KEY":
        table.foreign_keys.add(ForeignKeySpec(columns, ref_table or "", ref_columns, on_delete))


def _reflect_sqlite(connection, expected: SchemaModel) -> SchemaModel:
    model = SchemaModel()
    cursor = connection.cursor()
    try:
        cursor.execute("SELECT name FROM dwp.sqlite_master WHERE type='table'")
        actual_tables = {_identifier(row[0]) for row in cursor.fetchall()}
        app_tables = {
            name for name in actual_tables
            if name != "alembic_version" and (name in expected.tables or name.startswith("p_"))
        }
        for name in sorted(app_tables):
            table = TableSpec(name)
            cursor.execute(f"PRAGMA dwp.table_info({_sqlite_identifier(name)})")
            primary_key_columns = []
            for row in cursor.fetchall():
                column_name = _identifier(row[1])
                type_name = _type_name(str(row[2] or ""))
                table.columns[column_name] = ColumnSpec(
                    column_name,
                    type_name,
                    not bool(row[3]) and not bool(row[5]),
                    normalize_default(row[4], type_name),
                    bool(row[5]),
                )
                if row[5]:
                    primary_key_columns.append((int(row[5]), column_name))
            table.primary_key = tuple(column for _, column in sorted(primary_key_columns))
            cursor.execute(f"PRAGMA dwp.index_list({_sqlite_identifier(name)})")
            indexes = cursor.fetchall()
            for row in indexes:
                index_name = _identifier(row[1])
                unique = bool(row[2])
                origin = str(row[3] or "c") if len(row) > 3 else "c"
                if origin == "u":
                    cursor.execute(f"PRAGMA dwp.index_info({_sqlite_identifier(index_name)})")
                    columns = tuple(_identifier(item[2]) for item in cursor.fetchall() if item[2] is not None)
                    table.unique_constraints.add(columns)
                elif origin == "c":
                    cursor.execute(f"PRAGMA dwp.index_info({_sqlite_identifier(index_name)})")
                    columns = tuple(_identifier(item[2]) for item in cursor.fetchall() if item[2] is not None)
                    table.indexes[index_name] = IndexSpec(index_name, columns, unique)
            cursor.execute(f"PRAGMA dwp.foreign_key_list({_sqlite_identifier(name)})")
            foreign_keys: dict[int, list[Any]] = {}
            for row in cursor.fetchall():
                # id, sequence, referenced table, from, to, on_update, on_delete, match
                foreign_keys.setdefault(int(row[0]), []).append(row)
            for rows in foreign_keys.values():
                ordered = sorted(rows, key=lambda item: int(item[1]))
                table.foreign_keys.add(
                    ForeignKeySpec(
                        tuple(_identifier(item[3]) for item in ordered),
                        _identifier(ordered[0][2]),
                        tuple(_identifier(item[4]) for item in ordered),
                        " ".join(str(ordered[0][6] or "").upper().split()) or None,
                    )
                )
            model.tables[name] = table
    finally:
        cursor.close()
    return model


def _schema_for_reflection(config: dict) -> str:
    return get_provider(config["type"]).physical_schema(config)


def _column_type(data_type: Any, length: Any, precision: Any, scale: Any) -> str:
    name = str(data_type or "").upper()
    if name in {"CHARACTER VARYING", "VARCHAR", "CHAR", "CHARACTER"} and length:
        name = f"{name}({length})"
    elif name in {"DECIMAL", "NUMERIC"} and precision:
        name = f"{name}({precision}{',' + str(scale) if scale is not None else ''})"
    return _type_name(name)


def _reflection_metadata_queries(config: dict) -> tuple[ReflectionQuery, ...]:
    """Build the exact catalog queries consumed by information-schema reflection.

    PostgreSQL and GaussDB(DWS) deliberately have separate catalog SQL. DWS
    returns raw ordered catalog vectors and expands them in Python, avoiding
    PostgreSQL 9.3+ LATERAL and correlated set-returning functions in FROM.
    """
    provider = get_provider(config["type"])
    db_type = provider.name
    placeholder = provider.placeholder
    schema = provider.physical_schema(config)

    if db_type == "mysql":
        columns = ReflectionQuery(
            "columns reflection",
            "SELECT table_name, column_name, data_type, character_maximum_length, "
            "numeric_precision, numeric_scale, is_nullable, column_default "
            "FROM information_schema.columns WHERE table_schema = DATABASE() "
            "ORDER BY table_name, ordinal_position",
        )
    else:
        columns = ReflectionQuery(
            "columns reflection",
            "SELECT table_name, column_name, data_type, character_maximum_length, "
            "numeric_precision, numeric_scale, is_nullable, column_default "
            "FROM information_schema.columns WHERE table_schema = " + placeholder + " "
            "ORDER BY table_name, ordinal_position",
            (schema,),
        )

    if db_type == "mysql":
        constraints = ReflectionQuery(
            "constraints reflection",
            "SELECT tc.table_name, tc.constraint_type, tc.constraint_name, kcu.column_name, "
            "kcu.ordinal_position, kcu.referenced_table_name, kcu.referenced_column_name "
            "FROM information_schema.table_constraints tc "
            "JOIN information_schema.key_column_usage kcu ON tc.constraint_schema=kcu.constraint_schema "
            "AND tc.table_name=kcu.table_name AND tc.constraint_name=kcu.constraint_name "
            "WHERE tc.constraint_schema=DATABASE() "
            "ORDER BY tc.table_name,kcu.constraint_name,kcu.ordinal_position",
        )
    elif db_type == "postgres":
        # Keep PostgreSQL's existing catalog query and ordered array expansion
        # unchanged; the DWS branch below is intentionally separate.
        constraints = ReflectionQuery(
            "constraints reflection",
            "SELECT t.relname, CASE c.contype WHEN 'p' THEN 'PRIMARY KEY' "
            "WHEN 'u' THEN 'UNIQUE' WHEN 'f' THEN 'FOREIGN KEY' END, c.conname, "
            "a.attname, k.ord, rt.relname, ra.attname, "
            "CASE c.confdeltype WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT' "
            "WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' WHEN 'd' THEN 'SET DEFAULT' END "
            "FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid "
            "JOIN pg_namespace n ON n.oid=t.relnamespace "
            "JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum,ord) ON TRUE "
            "JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum "
            "LEFT JOIN pg_class rt ON rt.oid=c.confrelid "
            "LEFT JOIN LATERAL unnest(c.confkey) WITH ORDINALITY AS rk(attnum,ord) ON rk.ord=k.ord "
            "LEFT JOIN pg_attribute ra ON ra.attrelid=c.confrelid AND ra.attnum=rk.attnum "
            "WHERE n.nspname=" + placeholder + " AND c.contype IN ('p','u','f') "
            "ORDER BY t.relname,c.conname,k.ord",
            (schema,),
        )
    elif db_type == "gaussdb":
        constraints = ReflectionQuery(
            "constraints reflection",
            "SELECT t.relname, CASE c.contype WHEN 'p' THEN 'PRIMARY KEY' "
            "WHEN 'u' THEN 'UNIQUE' WHEN 'f' THEN 'FOREIGN KEY' END, c.conname, "
            "c.conkey, c.conrelid, rt.relname, c.confrelid, c.confkey, "
            "CASE c.confdeltype WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT' "
            "WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' WHEN 'd' THEN 'SET DEFAULT' END "
            "FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid "
            "JOIN pg_namespace n ON n.oid=t.relnamespace "
            "LEFT JOIN pg_class rt ON rt.oid=c.confrelid "
            "WHERE n.nspname=" + placeholder + " AND c.contype IN ('p','u','f') "
            "ORDER BY t.relname,c.conname",
            (schema,),
        )
        attributes = ReflectionQuery(
            "attributes reflection",
            "SELECT a.attrelid, a.attnum, a.attname FROM pg_attribute a "
            "WHERE a.attnum > 0 AND NOT a.attisdropped AND a.attrelid IN ("
            "SELECT t.oid FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace "
            "WHERE n.nspname=" + placeholder + " "
            "UNION "
            "SELECT c.confrelid FROM pg_constraint c "
            "JOIN pg_class t ON t.oid=c.conrelid "
            "JOIN pg_namespace n ON n.oid=t.relnamespace "
            "WHERE n.nspname=" + placeholder + " AND c.contype='f') "
            "ORDER BY a.attrelid,a.attnum",
            (schema, schema),
        )
    else:
        raise ValueError(f"schema reflection is not supported for provider: {db_type}")

    if db_type == "mysql":
        referential_constraints = ReflectionQuery(
            "referential constraints",
            "SELECT constraint_name, delete_rule FROM information_schema.referential_constraints "
            "WHERE constraint_schema=DATABASE()",
        )
        indexes = ReflectionQuery(
            "indexes reflection",
            "SELECT table_name, index_name, non_unique, seq_in_index, column_name "
            "FROM information_schema.statistics WHERE table_schema=DATABASE() "
            "ORDER BY table_name,index_name,seq_in_index",
        )
    else:
        referential_constraints = ReflectionQuery(
            "referential constraints",
            "SELECT constraint_name, delete_rule FROM information_schema.referential_constraints "
            "WHERE constraint_schema=" + placeholder,
            (schema,),
        )
        if db_type == "postgres":
            indexes = ReflectionQuery(
                "indexes reflection",
                "SELECT t.relname, i.relname, ix.indisunique, k.ord, a.attname "
                "FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace "
                "JOIN pg_index ix ON t.oid=ix.indrelid JOIN pg_class i ON i.oid=ix.indexrelid "
                "JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum,ord) ON TRUE "
                "JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum "
                "WHERE n.nspname=" + placeholder + " AND t.relkind='r' "
                "ORDER BY t.relname,i.relname,k.ord",
                (schema,),
            )
        elif db_type == "gaussdb":
            indexes = ReflectionQuery(
                "indexes reflection",
                "SELECT t.relname, i.relname, ix.indisunique, ix.indkey, ix.indrelid "
                "FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace "
                "JOIN pg_index ix ON t.oid=ix.indrelid JOIN pg_class i ON i.oid=ix.indexrelid "
                "WHERE n.nspname=" + placeholder + " AND t.relkind='r' "
                "ORDER BY t.relname,i.relname",
                (schema,),
            )
        else:
            raise ValueError(f"schema reflection is not supported for provider: {db_type}")

    if db_type == "gaussdb":
        return (columns, attributes, constraints, referential_constraints, indexes)
    return (columns, constraints, referential_constraints, indexes)


def _normalize_gaussdb_catalog_vector(value: Any) -> tuple[int, ...]:
    """Normalize common JDBC/Python renderings of a GaussDB attnum vector.

    Supported values are PostgreSQL-style text (``{1,2}``), int2vector text
    (``1 2``), Python list/tuple, and integer-indexable Java array objects.
    Unknown or malformed representations fail explicitly instead of looking
    like an empty catalog vector.
    """
    value_type = f"{type(value).__module__}.{type(value).__qualname__}"

    def unsupported() -> ValueError:
        return ValueError(
            "unsupported GaussDB catalog vector representation: " + value_type
        )

    if isinstance(value, str):
        text = value.strip()
        if text.startswith("{") or text.endswith("}"):
            if not (text.startswith("{") and text.endswith("}")):
                raise unsupported()
            contents = text[1:-1].strip()
            if not contents:
                return ()
            tokens = contents.split(",")
        elif "{" in text or "}" in text:
            raise unsupported()
        elif "," in text:
            tokens = text.split(",")
        else:
            tokens = text.split()
        if not tokens:
            raise unsupported()
        raw_values = tokens
    elif isinstance(value, (list, tuple)):
        raw_values = value
    elif isinstance(value, (bytes, bytearray, memoryview)):
        raise unsupported()
    else:
        # JPype Java arrays are indexable but are not Python list/tuple values.
        try:
            raw_values = tuple(value[index] for index in range(len(value)))
        except Exception as exc:
            raise unsupported() from exc

    attnums: list[int] = []
    for item in raw_values:
        if isinstance(item, bool):
            raise unsupported()
        token = str(item).strip()
        if not re.fullmatch(r"[+-]?\d+", token):
            raise unsupported()
        attnums.append(int(token))
    return tuple(attnums)


def _gaussdb_attribute_name(
    attribute_names: dict[tuple[int, int], str], relation_id: Any, attnum: int
) -> str:
    try:
        return attribute_names[(int(relation_id), attnum)]
    except (KeyError, TypeError, ValueError) as exc:
        raise RuntimeError(
            "GaussDB catalog reflection could not resolve attnum "
            f"{attnum} for relation {relation_id}"
        ) from exc


def _gaussdb_attribute_names(
    cursor, query: ReflectionQuery
) -> dict[tuple[int, int], str]:
    names: dict[tuple[int, int], str] = {}
    for relation_id, attnum, name in _execute_reflection_query(cursor, query):
        key = (int(relation_id), int(attnum))
        names[key] = _identifier(name)
    return names


def _gaussdb_constraint_rows(
    cursor,
    query: ReflectionQuery,
    attribute_names: dict[tuple[int, int], str],
) -> list[tuple[Any, ...]]:
    """Expand raw DWS constraint vectors into the common ordered row contract."""
    result: list[tuple[Any, ...]] = []
    for row in _execute_reflection_query(cursor, query):
        table_name, kind, constraint_name = row[:3]
        try:
            child_attnums = _normalize_gaussdb_catalog_vector(row[3])
        except ValueError as exc:
            raise ValueError(
                f"GaussDB constraints reflection for {constraint_name}: {exc}"
            ) from exc
        child_relation_id = row[4]
        referenced_table = row[5]
        referenced_relation_id = row[6]
        delete_action = row[8]
        is_foreign_key = str(kind).upper() == "FOREIGN KEY"
        if not child_attnums:
            raise RuntimeError(
                f"GaussDB catalog constraint {constraint_name} has an empty conkey"
            )

        parent_attnums: tuple[int, ...] = ()
        if is_foreign_key:
            try:
                parent_attnums = _normalize_gaussdb_catalog_vector(row[7])
            except ValueError as exc:
                raise ValueError(
                    f"GaussDB constraints reflection for {constraint_name}: {exc}"
                ) from exc
            if len(child_attnums) != len(parent_attnums):
                raise RuntimeError(
                    f"GaussDB catalog foreign key {constraint_name} has mismatched "
                    "conkey/confkey lengths"
                )
            if referenced_table is None or referenced_relation_id is None:
                raise RuntimeError(
                    f"GaussDB catalog foreign key {constraint_name} is missing its parent relation"
                )

        for ordinal, child_attnum in enumerate(child_attnums, start=1):
            column_name = _gaussdb_attribute_name(
                attribute_names, child_relation_id, child_attnum
            )
            referenced_column = None
            if is_foreign_key:
                referenced_column = _gaussdb_attribute_name(
                    attribute_names, referenced_relation_id, parent_attnums[ordinal - 1]
                )
            result.append(
                (
                    table_name,
                    kind,
                    constraint_name,
                    column_name,
                    ordinal,
                    referenced_table,
                    referenced_column,
                    delete_action,
                )
            )
    return result


def _gaussdb_index_rows(
    cursor,
    query: ReflectionQuery,
    attribute_names: dict[tuple[int, int], str],
) -> list[tuple[Any, ...]]:
    """Expand raw DWS index vectors, preserving each attnum's ordinal position."""
    result: list[tuple[Any, ...]] = []
    for table_name, index_name, is_unique, vector, relation_id in _execute_reflection_query(
        cursor, query
    ):
        try:
            attnums = _normalize_gaussdb_catalog_vector(vector)
        except ValueError as exc:
            raise ValueError(
                f"GaussDB indexes reflection for {index_name}: {exc}"
            ) from exc
        if not attnums:
            raise RuntimeError(f"GaussDB catalog index {index_name} has an empty indkey")
        for ordinal, attnum in enumerate(attnums, start=1):
            # Expression index entries use attnum 0; the existing catalog join
            # also omitted them because they have no ordinary pg_attribute name.
            if attnum == 0:
                continue
            column_name = _gaussdb_attribute_name(attribute_names, relation_id, attnum)
            result.append((table_name, index_name, is_unique, ordinal, column_name))
    return result


def _execute_reflection_query(cursor, query: ReflectionQuery) -> list[Any]:
    try:
        if query.params:
            cursor.execute(query.sql, query.params)
        else:
            cursor.execute(query.sql)
        return cursor.fetchall()
    except Exception as exc:
        raise RuntimeError(
            f"schema reflection query '{query.name}' failed: {exc}"
        ) from exc


def _reflect_information_schema(connection, config: dict, expected: SchemaModel) -> SchemaModel:
    db_type = get_provider(config["type"]).name
    queries = {
        query.name: query for query in _reflection_metadata_queries(config)
    }
    model = SchemaModel()
    cursor = connection.cursor()
    try:
        rows = _execute_reflection_query(cursor, queries["columns reflection"])
        for row in rows:
            name = _identifier(row[0])
            if name == "alembic_version" or (name not in expected.tables and not name.startswith("p_")):
                continue
            table = model.tables.setdefault(name, TableSpec(name))
            column_name = _identifier(row[1])
            type_name = _column_type(row[2], row[3], row[4], row[5])
            expected_table = expected.tables.get(name)
            expected_column = (
                expected_table.columns.get(column_name)
                if expected_table is not None
                else None
            )
            table.columns[column_name] = ColumnSpec(
                column_name,
                type_name,
                str(row[6]).upper() == "YES",
                _normalize_reflected_column_default(
                    row[7],
                    type_name,
                    db_type=db_type,
                    expected_column=expected_column,
                ),
            )

        if db_type == "gaussdb":
            attribute_names = _gaussdb_attribute_names(
                cursor, queries["attributes reflection"]
            )
            constraint_rows = _gaussdb_constraint_rows(
                cursor, queries["constraints reflection"], attribute_names
            )
        else:
            attribute_names = {}
            constraint_rows = _execute_reflection_query(
                cursor, queries["constraints reflection"]
            )

        grouped: dict[tuple[str, str, str], list[Any]] = {}
        for row in constraint_rows:
            table_name = _identifier(row[0])
            if table_name in model.tables:
                grouped.setdefault((table_name, str(row[1]).upper(), _identifier(row[2])), []).append(row)
        delete_rules = {
            _identifier(row[0]): " ".join(str(row[1]).upper().split())
            for row in _execute_reflection_query(cursor, queries["referential constraints"])
        }
        for (table_name, kind, constraint_name), rows in grouped.items():
            table = model.tables[table_name]
            ordered = sorted(rows, key=lambda item: int(item[4]))
            columns = tuple(_identifier(item[3]) for item in ordered)
            if kind == "FOREIGN KEY":
                _add_actual_constraint(
                    table, kind, constraint_name, columns,
                    _identifier(ordered[0][5]),
                    tuple(_identifier(item[6]) for item in ordered),
                    delete_rules.get(constraint_name),
                )
            elif kind == "UNIQUE":
                # MySQL exposes CREATE UNIQUE INDEX as a UNIQUE table
                # constraint in information_schema.  The baseline parser
                # intentionally keeps explicit indexes separate, so preserve
                # that distinction during reflection.
                expected_table = expected.tables.get(table_name)
                expected_index = (
                    expected_table.indexes.get(constraint_name)
                    if expected_table is not None
                    else None
                )
                if expected_index is not None and expected_index.unique and expected_index.columns == columns:
                    continue
                _add_actual_constraint(table, kind, constraint_name, columns)
                table.unique_constraint_names.setdefault(columns, constraint_name)
            elif kind == "PRIMARY KEY":
                _add_actual_constraint(table, kind, constraint_name, columns)
        for table in model.tables.values():
            for column_name in table.primary_key:
                if column_name in table.columns:
                    table.columns[column_name].primary_key = True
                    table.columns[column_name].nullable = False

        if db_type == "gaussdb":
            index_rows = _gaussdb_index_rows(
                cursor, queries["indexes reflection"], attribute_names
            )
        else:
            index_rows = _execute_reflection_query(cursor, queries["indexes reflection"])

        indexes: dict[tuple[str, str], list[Any]] = {}
        for row in index_rows:
            table_name = _identifier(row[0])
            if table_name in model.tables:
                indexes.setdefault((table_name, _identifier(row[1])), []).append(row)
        for (table_name, index_name), rows in indexes.items():
            ordered = sorted(rows, key=lambda item: int(item[3]))
            columns = tuple(_identifier(item[4]) for item in ordered if item[4] is not None)
            # Supporting indexes for PK/UNIQUE are intentionally not part of the
            # explicit index contract; unique constraints are compared above.
            if index_name in model.tables[table_name].indexes or not any(
                columns == unique for unique in model.tables[table_name].unique_constraints
            ):
                model.tables[table_name].indexes[index_name] = IndexSpec(
                    index_name,
                    columns,
                    bool(not rows[0][2]) if db_type == "mysql" else bool(rows[0][2]),
                )
    finally:
        cursor.close()
    return model


def reflect_schema(connection, config: dict, expected: SchemaModel | None = None) -> SchemaModel:
    """Reflect one connection using its database-native metadata APIs."""
    if expected is None:
        expected = SchemaModel()
    if config["type"] == "sqlite":
        return _reflect_sqlite(connection, expected)
    return _reflect_information_schema(connection, config, expected)


def compare_schema(expected: SchemaModel, actual: SchemaModel) -> list[SchemaMismatch]:
    mismatches: list[SchemaMismatch] = []
    expected_names = set(expected.tables)
    actual_app_names = {name for name in actual.tables if name.startswith("p_")}
    for table_name in sorted(expected_names - set(actual.tables)):
        mismatches.append(SchemaMismatch(table_name, "table", table_name, "present", "missing", "missing table"))
    for table_name in sorted(actual_app_names - expected_names):
        mismatches.append(SchemaMismatch(table_name, "table", table_name, "not present", "present", "unexpected application table"))
    for table_name in sorted(expected_names & set(actual.tables)):
        expected_table = expected.tables[table_name]
        actual_table = actual.tables[table_name]
        for column_name in sorted(set(expected_table.columns) - set(actual_table.columns)):
            mismatches.append(SchemaMismatch(table_name, "column", column_name, expected_table.columns[column_name], "missing", "missing column"))
        for column_name in sorted(set(actual_table.columns) - set(expected_table.columns)):
            mismatches.append(SchemaMismatch(table_name, "column", column_name, "not present", actual_table.columns[column_name], "unexpected application column"))
        for column_name in sorted(set(expected_table.columns) & set(actual_table.columns)):
            expected_column = expected_table.columns[column_name]
            actual_column = actual_table.columns[column_name]
            checks = (
                ("type", expected_column.type_name, actual_column.type_name),
                ("nullable", expected_column.nullable, actual_column.nullable),
                ("default", expected_column.default, actual_column.default),
                ("primary_key", expected_column.primary_key, actual_column.primary_key),
            )
            for object_type, expected_value, actual_value in checks:
                if expected_value != actual_value:
                    mismatches.append(SchemaMismatch(table_name, object_type, column_name, expected_value, actual_value, f"{object_type} drift"))
        if expected_table.primary_key != actual_table.primary_key:
            mismatches.append(SchemaMismatch(table_name, "constraint", "PRIMARY KEY", expected_table.primary_key, actual_table.primary_key, "primary key drift"))
        if expected_table.unique_constraints != actual_table.unique_constraints:
            mismatches.append(SchemaMismatch(table_name, "constraint", "UNIQUE", sorted(expected_table.unique_constraints), sorted(actual_table.unique_constraints), "unique constraint drift"))
        if expected_table.foreign_keys != actual_table.foreign_keys:
            mismatches.append(SchemaMismatch(table_name, "constraint", "FOREIGN KEY", sorted(expected_table.foreign_keys, key=repr), sorted(actual_table.foreign_keys, key=repr), "foreign key drift"))
        for index_name, expected_index in sorted(expected_table.indexes.items()):
            actual_index = actual_table.indexes.get(index_name)
            if actual_index is None:
                mismatches.append(SchemaMismatch(table_name, "index", index_name, expected_index, "missing", "missing index"))
            elif (expected_index.columns, expected_index.unique) != (actual_index.columns, actual_index.unique):
                mismatches.append(SchemaMismatch(table_name, "index", index_name, expected_index, actual_index, "index definition drift"))
    return mismatches


def _format_schema_mismatches(mismatches: list[SchemaMismatch]) -> str:
    summary: list[str] = []
    missing_tables = [item.table for item in mismatches if item.object_type == "table" and item.reason == "missing table"]
    missing_columns = sorted({item.table for item in mismatches if item.object_type == "column" and item.reason == "missing column"})
    if missing_tables:
        summary.append(f"missing tables: {', '.join(missing_tables)}")
    if missing_columns:
        summary.append(f"missing columns: {', '.join(missing_columns)}")
    details = "\n\n".join(item.detail() for item in mismatches)
    return "Schema verification failed:\n" + "\n".join(summary) + ("\n\n" if summary else "") + details


def verify_database(connection, config: dict, dialect: str, root: Path = SCHEMA_ROOT):
    expected = baseline_schema(dialect, root)
    actual = reflect_schema(connection, config, expected)
    mismatches = compare_schema(expected, actual)
    if mismatches:
        raise RuntimeError(_format_schema_mismatches(mismatches))
    return current_revision(connection, config)


def stamp_existing(connection, config: dict, dialect: str, root: Path = SCHEMA_ROOT):
    # Verification is deliberately outside the write transaction: any mismatch
    # raises before alembic_version is created or modified.
    verify_database(connection, config, dialect, root)
    try:
        _stamp(connection, config)
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    return BASELINE_REVISION
