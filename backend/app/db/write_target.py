"""Fail-closed resolution and validation for application write targets.

This module deliberately does not infer a target from database permissions or
rewrite historical physical schema names. It accepts only explicit Profile
targets (except SQLite's fixed internal ``dwp`` attachment).
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import re

from .providers import LOGICAL_SCHEMA, gaussdb_schema_sql_identifier

_IDENTIFIER = re.compile(r"[A-Za-z_][A-Za-z0-9_]*\Z")
_WORD = re.compile(r"[A-Za-z_$][A-Za-z0-9_$]*")


class WriteTargetError(ValueError):
    """A statement cannot be proven to write to its effective Profile target."""


@dataclass(frozen=True)
class EffectiveWriteTarget:
    provider: str
    database: str | None = None
    schema: str | None = None

    def rendered_schema(self) -> str:
        if self.provider == "mysql":
            return ""
        if self.provider == "gaussdb":
            return gaussdb_schema_sql_identifier(self.schema or "")
        return self.schema or ""


def resolve_write_target(config: dict) -> EffectiveWriteTarget:
    """Resolve a write target without using legacy physical-schema fallbacks."""
    provider = str(config.get("type") or "").strip().lower()
    if provider == "sqlite":
        database = str(config.get("database") or "").strip()
        if not database:
            raise WriteTargetError("SQLite application writes require an explicit database file")
        return EffectiveWriteTarget(provider="sqlite", database=database, schema="dwp")

    if provider == "mysql":
        database = str(config.get("database") or "").strip()
        if not database:
            raise WriteTargetError("MySQL application writes require an explicit database")
        return EffectiveWriteTarget(provider="mysql", database=database)

    if provider == "postgres":
        schema = config.get("schema")
        if not isinstance(schema, str) or not schema.strip():
            raise WriteTargetError(
                "PostgreSQL application writes require an explicit Profile schema"
            )
        schema = schema.strip()
        if not _IDENTIFIER.fullmatch(schema):
            raise WriteTargetError("PostgreSQL Profile schema is not a safe SQL identifier")
        # The provider emits the configured schema as an unquoted PostgreSQL
        # identifier, so PostgreSQL folds it to lower case.
        return EffectiveWriteTarget(provider="postgres", schema=schema.lower())

    if provider == "gaussdb":
        schema = config.get("schema")
        if not isinstance(schema, str) or not _IDENTIFIER.fullmatch(schema):
            raise WriteTargetError(
                "GaussDB/DWS application writes require an explicit safe Profile schema"
            )
        return EffectiveWriteTarget(provider="gaussdb", schema=schema)

    label = provider or "<empty>"
    raise WriteTargetError(
        f"Unsupported database provider for application writes: {label}"
    )


@dataclass(frozen=True)
class _Token:
    kind: str
    value: str
    start: int
    end: int
    quoted: bool = False


def _quoted_identifier(sql: str, start: int, opener: str, closer: str) -> tuple[str, int]:
    index = start + 1
    value = []
    while index < len(sql):
        character = sql[index]
        if character == closer:
            if index + 1 < len(sql) and sql[index + 1] == closer:
                value.append(closer)
                index += 2
                continue
            return "".join(value), index + 1
        value.append(character)
        index += 1
    raise WriteTargetError("Unterminated quoted identifier in SQL")


def _skip_quoted(
    sql: str, start: int, quote: str, *, backslash_escapes: bool = False
) -> int:
    index = start + 1
    while index < len(sql):
        if backslash_escapes and sql[index] == "\\" and index + 1 < len(sql):
            index += 2
        elif sql[index] == quote:
            if index + 1 < len(sql) and sql[index + 1] == quote:
                index += 2
            else:
                return index + 1
        else:
            index += 1
    raise WriteTargetError("Unterminated string literal in SQL")


def _lex(
    sql: str,
    *,
    backslash_escapes: bool = False,
    mysql_comments: bool = False,
) -> list[_Token]:
    """Tokenize identifiers/operators while treating values and comments as opaque."""
    tokens: list[_Token] = []
    index = 0
    while index < len(sql):
        character = sql[index]
        if character.isspace():
            index += 1
            continue
        dash_comment = sql.startswith("--", index) and (
            not mysql_comments
            or index + 2 == len(sql)
            or sql[index + 2].isspace()
            or ord(sql[index + 2]) < 32
        )
        if dash_comment or (mysql_comments and character == "#"):
            newline = sql.find("\n", index)
            index = len(sql) if newline < 0 else newline + 1
            continue
        if sql.startswith("/*", index):
            if mysql_comments and (
                sql[index : index + 3] == "/*!"
                or sql[index : index + 4].upper() == "/*M!"
            ):
                raise WriteTargetError(
                    "Executable MySQL comments are unsupported through the write facade"
                )
            if mysql_comments:
                close = sql.find("*/", index + 2)
                if close < 0:
                    raise WriteTargetError("Unterminated block comment in SQL")
                index = close + 2
                continue
            depth = 1
            index += 2
            while index < len(sql) and depth:
                if sql.startswith("/*", index):
                    depth += 1
                    index += 2
                elif sql.startswith("*/", index):
                    depth -= 1
                    index += 2
                else:
                    index += 1
            if depth:
                raise WriteTargetError("Unterminated block comment in SQL")
            continue
        if character == "'":
            escape_string_prefix = (
                index > 0
                and sql[index - 1] in {"e", "E"}
                and (index == 1 or not (sql[index - 2].isalnum() or sql[index - 2] in "_$"))
            )
            index = _skip_quoted(
                sql,
                index,
                character,
                backslash_escapes=backslash_escapes or escape_string_prefix,
            )
            continue
        if character in {'"', '`'}:
            value, end = _quoted_identifier(sql, index, character, character)
            tokens.append(_Token("identifier", value, index, end, quoted=True))
            index = end
            continue
        if character == "[":
            value, end = _quoted_identifier(sql, index, character, "]")
            tokens.append(_Token("identifier", value, index, end, quoted=True))
            index = end
            continue
        if character == "$":
            delimiter = re.match(r"\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$", sql[index:])
            if delimiter:
                marker = delimiter.group(0)
                close = sql.find(marker, index + len(marker))
                if close < 0:
                    raise WriteTargetError("Unterminated dollar-quoted string in SQL")
                index = close + len(marker)
                continue
        match = _WORD.match(sql, index)
        if match:
            tokens.append(_Token("identifier", match.group(0), index, match.end()))
            index = match.end()
            continue
        tokens.append(_Token("symbol", character, index, index + 1))
        index += 1
    return tokens


def _lex_for_provider(sql: str, provider: str | None) -> list[_Token]:
    # Server settings can change whether a backslash escapes a quote. Accept
    # the statement only when both SQL interpretations yield identical tokens.
    # MySQL additionally treats # comments as syntax and -- as a comment only
    # when it is followed by whitespace/control.
    mysql_comments = provider == "mysql"
    standard_tokens = escaped_tokens = None
    standard_error = escaped_error = None
    try:
        standard_tokens = _lex(sql, mysql_comments=mysql_comments)
    except WriteTargetError as error:
        standard_error = error
    try:
        escaped_tokens = _lex(
            sql, backslash_escapes=True, mysql_comments=mysql_comments
        )
    except WriteTargetError as error:
        escaped_error = error
    if standard_error or escaped_error:
        if (
            standard_error is not None
            and escaped_error is not None
            and str(standard_error) == str(escaped_error)
        ):
            raise standard_error
        raise WriteTargetError(
            "SQL string escaping is ambiguous across supported session modes"
        ) from (standard_error or escaped_error)
    if standard_tokens != escaped_tokens:
        raise WriteTargetError(
            "SQL string escaping is ambiguous across supported session modes"
        )
    return standard_tokens


def rewrite_logical_schema(sql: str, target: EffectiveWriteTarget) -> str:
    """Rewrite only a lexical ``__app__.<identifier>`` schema qualifier."""
    tokens = _lex_for_provider(sql, target.provider)
    replacements: list[tuple[int, int, str]] = []
    for index, token in enumerate(tokens[:-2]):
        if token.kind != "identifier":
            continue
        logical = token.value == LOGICAL_SCHEMA
        if not token.quoted:
            logical = token.value.lower() == LOGICAL_SCHEMA.lower()
        if not logical or tokens[index + 1].value != ".":
            continue
        dot = tokens[index + 1]
        table = tokens[index + 2]
        if table.kind != "identifier":
            raise WriteTargetError("Logical schema qualifier must precede a table identifier")
        if sql[token.end:dot.start].strip():
            raise WriteTargetError("Comments between logical schema and dot are unsupported")
        if target.provider == "mysql":
            replacements.append((token.start, dot.end, ""))
        else:
            replacements.append((token.start, token.end, target.rendered_schema()))
    for start, end, replacement in reversed(replacements):
        sql = sql[:start] + replacement + sql[end:]
    return sql


def _identifier_at(tokens: list[_Token], index: int) -> tuple[_Token, int]:
    if index >= len(tokens) or tokens[index].kind != "identifier":
        raise WriteTargetError("Write statement has an unrecognized or ambiguous target")
    return tokens[index], index + 1


def _qualified_name_at(tokens: list[_Token], index: int) -> tuple[str | None, _Token, int]:
    first, following = _identifier_at(tokens, index)
    if following < len(tokens) and tokens[following].value == ".":
        table, after_table = _identifier_at(tokens, following + 1)
        if after_table < len(tokens) and tokens[after_table].value == ".":
            raise WriteTargetError("Three-part write targets are unsupported")
        return first.value, table, after_table
    return None, first, following


def _matches_target(schema: str, quoted: bool, target: EffectiveWriteTarget) -> bool:
    if target.provider == "mysql":
        return schema == target.database
    expected = target.schema or ""
    if quoted:
        return schema == expected
    if target.provider == "postgres":
        return schema.lower() == expected
    if target.provider == "gaussdb":
        if quoted:
            return schema == expected
        return expected.islower() and schema.lower() == expected
    return schema.lower() == expected.lower() if expected.islower() else schema == expected


def _check_qualified_name(
    schema: str | None,
    schema_token: _Token | None,
    target: EffectiveWriteTarget,
) -> None:
    if schema is None:
        if target.provider == "sqlite":
            raise WriteTargetError(
                "SQLite application writes must explicitly target the attached dwp database"
            )
        return
    if schema == LOGICAL_SCHEMA and schema_token is not None:
        schema = target.schema or ""
    if schema_token is not None and not _matches_target(schema, schema_token.quoted, target):
        raise WriteTargetError(
            f"Write target schema/database '{schema}' does not match the effective Profile target"
        )


def _check_target_at(tokens: list[_Token], index: int, target: EffectiveWriteTarget) -> int:
    schema, table, after = _qualified_name_at(tokens, index)
    schema_token = tokens[index] if schema is not None else None
    _check_qualified_name(schema, schema_token, target)
    return after


def _check_table_target_list(
    tokens: list[_Token],
    index: int,
    target: EffectiveWriteTarget,
    *,
    allow_only: bool = False,
    allow_inheritance: bool = False,
) -> int:
    """Validate each table in TRUNCATE/LOCK lists, including per-item modifiers."""
    while True:
        if index < len(tokens) and tokens[index].value.upper() == "ONLY":
            if not allow_only:
                raise WriteTargetError("ONLY table targets are unsupported for this provider")
            index += 1
        index = _check_target_at(tokens, index, target)
        if index < len(tokens) and tokens[index].value == "*":
            if not allow_inheritance:
                raise WriteTargetError("Inherited table targets are unsupported for this provider")
            index += 1
        if index >= len(tokens) or tokens[index].value != ",":
            return index
        index += 1


def _next_keyword(tokens: list[_Token], index: int, stop: set[str]) -> int | None:
    for position in range(index, len(tokens)):
        value = tokens[position].value.upper()
        if value in stop:
            return position
        if tokens[position].value == ";":
            return None
    return None


def sql_has_write_keyword(sql: str, provider: str | None = None) -> bool:
    """Return whether SQL contains a write/DDL/session-mutation keyword."""
    return any(
        token.kind == "identifier"
        and not token.quoted
        and token.value.upper()
        in {
            "INSERT", "INTO", "REPLACE", "MERGE", "UPDATE", "DELETE", "CREATE", "ALTER",
            "DROP", "TRUNCATE", "COPY", "LOCK", "CALL", "EXEC", "EXECUTE",
            "DO", "SET", "USE", "RENAME", "GRANT", "REVOKE", "ANALYZE",
            "VACUUM", "REINDEX", "REFRESH", "COMMENT", "CLUSTER", "LOAD",
            "CHECKPOINT", "DISCARD", "RESET", "PREPARE", "DEALLOCATE", "PRAGMA",
            "ATTACH", "DETACH", "REASSIGN", "IMPORT", "SECURITY", "BEGIN",
            "START", "COMMIT", "ROLLBACK", "SAVEPOINT", "RELEASE", "END", "ABORT",
            "LISTEN", "UNLISTEN", "NOTIFY", "UNLOCK",
        }
        for token in _lex_for_provider(sql, provider)
    )


def validate_write_sql(sql: str, target: EffectiveWriteTarget) -> bool:
    """Validate every recognizable DML/DDL target; return whether SQL writes."""
    tokens = _lex_for_provider(sql, target.provider)
    writes = False
    index = 0
    unsupported = {
        "CALL", "EXEC", "EXECUTE", "DO", "SET", "USE", "RENAME", "GRANT",
        "REVOKE", "ANALYZE", "VACUUM", "REINDEX", "REFRESH", "COMMENT",
        "CLUSTER", "LOAD", "CHECKPOINT", "DISCARD", "RESET", "PREPARE",
        "DEALLOCATE", "PRAGMA", "ATTACH", "DETACH", "REASSIGN", "IMPORT",
        "SECURITY", "BEGIN", "START", "COMMIT", "ROLLBACK", "SAVEPOINT",
        "RELEASE", "END", "ABORT", "LISTEN", "UNLISTEN", "NOTIFY", "UNLOCK",
    }
    while index < len(tokens):
        token = tokens[index]
        keyword = (
            token.value.upper()
            if token.kind == "identifier" and not token.quoted
            else ""
        )
        previous_token = tokens[index - 1] if index else None
        previous = (
            previous_token.value.upper()
            if previous_token is not None
            and previous_token.kind == "identifier"
            and not previous_token.quoted
            else previous_token.value if previous_token is not None else ""
        )
        if keyword in unsupported and (index == 0 or previous == ";"):
            raise WriteTargetError(
                f"Statement '{keyword}' is not allowed through the generic write facade"
            )
        if keyword == "INTO" and previous not in {"INSERT", "REPLACE", "MERGE"}:
            raise WriteTargetError("SELECT INTO is not allowed through the generic write facade")

        if keyword in {"INSERT", "REPLACE", "MERGE"}:
            into = _next_keyword(tokens, index + 1, {"INTO", ";"})
            if into is None or tokens[into].value.upper() != "INTO":
                raise WriteTargetError(f"Cannot determine {keyword} write target")
            target_index = into + 1
            if target_index < len(tokens) and tokens[target_index].value.upper() == "ONLY":
                target_index += 1
            index = _check_target_at(tokens, target_index, target)
            writes = True
            continue

        if keyword == "UPDATE" and previous not in {"DO", "KEY"}:
            target_index = index + 1
            if target_index < len(tokens) and tokens[target_index].value.upper() == "ONLY":
                target_index += 1
            index = _check_target_at(tokens, target_index, target)
            if target.provider == "mysql":
                set_pos = _next_keyword(tokens, index, {"SET", ";"})
                if set_pos is None or tokens[set_pos].value.upper() != "SET":
                    raise WriteTargetError("Cannot determine MySQL UPDATE target list")
                if any(
                    item.value == "," or item.value.upper() in {"JOIN", "STRAIGHT_JOIN"}
                    for item in tokens[index:set_pos]
                ):
                    raise WriteTargetError(
                        "Multi-table MySQL UPDATE is not allowed through the write facade"
                    )
            writes = True
            continue

        if keyword == "DELETE" and previous != "ON":
            if index + 1 >= len(tokens) or tokens[index + 1].value.upper() != "FROM":
                raise WriteTargetError("Cannot determine DELETE write target")
            target_index = index + 2
            if target_index < len(tokens) and tokens[target_index].value.upper() == "ONLY":
                target_index += 1
            index = _check_target_at(tokens, target_index, target)
            if (
                target.provider == "mysql"
                and index < len(tokens)
                and tokens[index].value == ","
            ):
                raise WriteTargetError(
                    "Multi-table MySQL DELETE is not allowed through the write facade"
                )
            writes = True
            continue

        if keyword in {"CREATE", "ALTER", "DROP"} and (index == 0 or previous == ";"):
            if (
                keyword == "CREATE"
                and index + 1 < len(tokens)
                and tokens[index + 1].value.upper() in {"TEMP", "TEMPORARY"}
            ):
                raise WriteTargetError(
                    "Temporary table DDL is not allowed through the generic write facade"
                )
            object_pos = index + 1
            modifiers = {
                "OR", "REPLACE", "TEMP", "TEMPORARY", "UNLOGGED", "UNIQUE",
                "IF", "NOT", "EXISTS", "CONCURRENTLY",
            }
            while object_pos < len(tokens) and tokens[object_pos].value.upper() in modifiers:
                object_pos += 1
            if object_pos >= len(tokens):
                raise WriteTargetError(f"Cannot determine {keyword} DDL target")
            object_type = tokens[object_pos].value.upper()
            if object_type in {"SCHEMA", "DATABASE", "FUNCTION", "PROCEDURE", "TRIGGER", "VIEW"}:
                raise WriteTargetError(
                    f"{keyword} {object_type} is outside the application write facade"
                )
            if object_type == "TABLE":
                target_index = object_pos + 1
                if (
                    keyword == "ALTER"
                    and target_index < len(tokens)
                    and tokens[target_index].value.upper() == "ALL"
                ):
                    raise WriteTargetError(
                        "ALTER TABLE ALL is outside the application write facade"
                    )
                if target_index < len(tokens) and tokens[target_index].value.upper() == "ONLY":
                    target_index += 1
                if target_index < len(tokens) and tokens[target_index].value.upper() == "IF":
                    target_index += 1
                if target_index < len(tokens) and tokens[target_index].value.upper() == "NOT":
                    target_index += 1
                if target_index < len(tokens) and tokens[target_index].value.upper() == "EXISTS":
                    target_index += 1
                index = _check_target_at(tokens, target_index, target)
                if keyword == "ALTER":
                    for position in range(index, len(tokens) - 1):
                        pair = (
                            tokens[position].value.upper(),
                            tokens[position + 1].value.upper(),
                        )
                        if pair == ("SET", "SCHEMA") or pair in {
                            ("ATTACH", "PARTITION"),
                            ("DETACH", "PARTITION"),
                        }:
                            raise WriteTargetError(
                                "Cross-schema table movement/partition DDL is not allowed"
                            )
                        if target.provider == "mysql" and pair in {
                            ("RENAME", "TO"), ("RENAME", "AS")
                        }:
                            destination = position + 2
                            schema, _table, _after = _qualified_name_at(
                                tokens, destination
                            )
                            schema_token = tokens[destination] if schema is not None else None
                            _check_qualified_name(schema, schema_token, target)
                        if target.provider == "mysql" and pair == (
                            "EXCHANGE", "PARTITION"
                        ):
                            with_pos = _next_keyword(tokens, position + 2, {"WITH", ";"})
                            if (
                                with_pos is None
                                or with_pos + 1 >= len(tokens)
                                or tokens[with_pos + 1].value.upper() != "TABLE"
                            ):
                                raise WriteTargetError(
                                    "Cannot determine MySQL EXCHANGE PARTITION table target"
                                )
                            _check_target_at(tokens, with_pos + 2, target)
                if keyword == "DROP":
                    while index < len(tokens) and tokens[index].value == ",":
                        index = _check_target_at(tokens, index + 1, target)
                writes = True
                continue
            if object_type == "INDEX":
                index_name_pos = object_pos + 1
                if (
                    index_name_pos < len(tokens)
                    and tokens[index_name_pos].value.upper() == "CONCURRENTLY"
                ):
                    index_name_pos += 1
                if index_name_pos < len(tokens) and tokens[index_name_pos].value.upper() == "IF":
                    index_name_pos += 1
                    if (
                        index_name_pos < len(tokens)
                        and tokens[index_name_pos].value.upper() == "NOT"
                    ):
                        index_name_pos += 1
                    if (
                        index_name_pos < len(tokens)
                        and tokens[index_name_pos].value.upper() == "EXISTS"
                    ):
                        index_name_pos += 1
                if index_name_pos >= len(tokens):
                    raise WriteTargetError(f"Cannot determine {keyword} INDEX target")
                # DROP INDEX targets the index object; CREATE INDEX targets
                # both its optional schema and the table after ON.
                name_schema, _name, after_name = _qualified_name_at(tokens, index_name_pos)
                if keyword == "DROP":
                    _check_qualified_name(
                        name_schema,
                        tokens[index_name_pos] if name_schema is not None else None,
                        target,
                    )
                    while after_name < len(tokens) and tokens[after_name].value == ",":
                        next_start = after_name + 1
                        next_schema, _name, after_name = _qualified_name_at(
                            tokens, next_start
                        )
                        _check_qualified_name(
                            next_schema,
                            tokens[next_start] if next_schema is not None else None,
                            target,
                        )
                elif name_schema is not None:
                    _check_qualified_name(name_schema, tokens[index_name_pos], target)
                if keyword == "CREATE":
                    on_pos = _next_keyword(tokens, after_name, {"ON", ";"})
                    if on_pos is None or tokens[on_pos].value.upper() != "ON":
                        raise WriteTargetError("Cannot determine CREATE INDEX table target")
                    _check_target_at(tokens, on_pos + 1, target)
                elif target.provider == "mysql":
                    on_pos = _next_keyword(tokens, after_name, {"ON", ";"})
                    if on_pos is not None and tokens[on_pos].value.upper() == "ON":
                        _check_target_at(tokens, on_pos + 1, target)
                index = after_name
                writes = True
                continue
            raise WriteTargetError(f"Unsupported {keyword} DDL object: {object_type}")

        if keyword == "LOCK" and target.provider == "mysql":
            if index + 1 >= len(tokens) or tokens[index + 1].value.upper() != "TABLES":
                raise WriteTargetError("Cannot determine MySQL LOCK TABLES target list")
            position = index + 2
            while position < len(tokens):
                position = _check_target_at(tokens, position, target)
                while position < len(tokens) and tokens[position].value != ",":
                    if tokens[position].value == ";":
                        break
                    position += 1
                if position >= len(tokens) or tokens[position].value == ";":
                    break
                position += 1
            writes = True
            index = position
            continue

        if keyword in {"TRUNCATE", "COPY", "LOCK"}:
            target_index = index + 1
            if keyword in {"TRUNCATE", "LOCK"}:
                if target_index < len(tokens) and tokens[target_index].value.upper() == "TABLE":
                    target_index += 1
                if (
                    keyword == "LOCK"
                    and target.provider != "mysql"
                    and target_index < len(tokens)
                    and tokens[target_index].value.upper() == "TABLES"
                ):
                    raise WriteTargetError("MySQL LOCK TABLES syntax is unsupported for this provider")
            if (
                keyword == "COPY"
                and target_index < len(tokens)
                and tokens[target_index].value.upper() == "BINARY"
            ):
                target_index += 1
            if keyword in {"LOCK", "TRUNCATE"}:
                index = _check_table_target_list(
                    tokens,
                    target_index,
                    target,
                    allow_only=target.provider in {"postgres", "gaussdb"},
                    allow_inheritance=target.provider in {"postgres", "gaussdb"},
                )
            else:
                index = _check_target_at(tokens, target_index, target)
            writes = True
            continue

        # A top-level-looking DML keyword without a supported target pattern
        # must not be silently treated as a read.
        if keyword in {"INSERT", "REPLACE", "MERGE", "UPDATE", "DELETE"}:
            raise WriteTargetError(f"Cannot determine {keyword} write target")
        index += 1
    return writes


def _execute_probe(connection, sql: str):
    if callable(getattr(connection, "exec_driver_sql", None)):
        result = connection.exec_driver_sql(sql)
        try:
            return result.fetchone()
        finally:
            result.close()
    cursor = connection.cursor()
    try:
        cursor.execute(sql)
        return cursor.fetchone()
    finally:
        cursor.close()


def _cursor_connection(cursor):
    for attribute in ("connection", "_connection", "conn"):
        connection = getattr(cursor, attribute, None)
        if connection is not None:
            return connection
    return None


def validate_connection_target(
    connection, config: dict, target: EffectiveWriteTarget | None = None
) -> None:
    """Verify the actual session before executing a write on it."""
    target = target or resolve_write_target(config)
    provider = target.provider
    if provider == "sqlite":
        if callable(getattr(connection, "exec_driver_sql", None)):
            result = connection.exec_driver_sql("PRAGMA database_list")
            try:
                databases = list(result.fetchall())
            finally:
                result.close()
        else:
            cursor = connection.cursor()
            try:
                cursor.execute("PRAGMA database_list")
                databases = list(cursor.fetchall())
            finally:
                cursor.close()
        attached = next((row for row in databases if len(row) >= 3 and row[1] == "dwp"), None)
        if attached is None:
            raise WriteTargetError("SQLite connection is missing the required dwp attachment")
        expected = str(target.database or "")
        actual = str(attached[2] or "")
        if expected == ":memory:":
            if actual:
                raise WriteTargetError(
                    "SQLite dwp attachment does not match the in-memory Profile target"
                )
        elif Path(actual).expanduser().resolve() != Path(expected).expanduser().resolve():
            raise WriteTargetError(
                "SQLite dwp attachment does not match the effective Profile database"
            )
        return

    if provider == "mysql":
        row = _execute_probe(connection, "SELECT DATABASE()")
        actual = row[0] if row else None
        if actual != target.database:
            raise WriteTargetError(
                "MySQL session database does not match the effective Profile target"
            )
        return

    if provider == "postgres":
        row = _execute_probe(
            connection,
            "SELECT current_schema(), current_schemas(false)",
        )
        if not row or row[0] != target.schema:
            raise WriteTargetError(
                "PostgreSQL session schema does not match the effective Profile target"
            )
        search_schemas = row[1]
        if isinstance(search_schemas, str):
            search_schemas = [
                item.strip().strip('"')
                for item in search_schemas.strip("{}").split(",")
                if item.strip()
            ]
        if not isinstance(search_schemas, (list, tuple)) or list(search_schemas) != [target.schema]:
            raise WriteTargetError(
                "PostgreSQL search_path is ambiguous for the effective Profile target"
            )
        return

    if provider == "gaussdb":
        java_connection = getattr(connection, "jconn", None)
        get_auto_commit = getattr(java_connection, "getAutoCommit", None)
        if not callable(get_auto_commit) or bool(get_auto_commit()):
            raise WriteTargetError(
                "GaussDB/DWS JDBC transaction state cannot be verified as non-autocommit"
            )
        row = _execute_probe(connection, "SELECT current_schema()")
        if not row or row[0] != target.schema:
            raise WriteTargetError("GaussDB/DWS JDBC current_schema does not match Profile schema")
        return

    raise WriteTargetError(f"Unsupported database provider for application writes: {provider}")


def validate_cursor_target(
    cursor, config: dict, target: EffectiveWriteTarget | None = None
) -> None:
    connection = _cursor_connection(cursor)
    if connection is None:
        raise WriteTargetError("Caller-owned cursor has no verifiable parent connection")
    validate_connection_target(connection, config, target)
