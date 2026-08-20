"""SQLAlchemy Core execution boundary for portable application CRUD."""

from __future__ import annotations

import re

from sqlalchemy import func, select
from sqlalchemy.dialects import postgresql
from sqlalchemy.sql.elements import TextClause
from sqlalchemy.sql.expression import ClauseElement

from .facade import (
    _commit_if_needed,
    _rollback_if_needed,
    active_transaction_connection,
    connect_with_profile,
    get_db_profile,
    get_engine,
)
from .metadata import LOGICAL_SCHEMA, metadata
from .registry import get_provider
_SCHEMA_TOKEN_RE = re.compile(r"__\[SCHEMA___app__\]")


def _schema_translate_map(config: dict) -> dict:
    provider = get_provider(config["type"])
    return {LOGICAL_SCHEMA: provider.physical_schema(config)}


def _compile(profile: str, statement, dialect=None):
    """Compile Core for a raw DB-API connection."""
    config = get_db_profile(profile)
    provider = get_provider(config["type"])
    dialect = dialect or postgresql.dialect(paramstyle="qmark")
    compiled = statement.compile(
        dialect=dialect,
        schema_translate_map=_schema_translate_map(config),
        compile_kwargs={"render_postcompile": True},
    )
    physical_schema = provider.physical_schema(config)
    sql = str(compiled)
    if physical_schema:
        sql = _SCHEMA_TOKEN_RE.sub(physical_schema, sql)
        sql = sql.replace(f"{LOGICAL_SCHEMA}.", f"{physical_schema}.")
    else:
        sql = re.sub(_SCHEMA_TOKEN_RE.pattern + r"\.", "", sql)
        sql = sql.replace(f"{LOGICAL_SCHEMA}.", "")
    if compiled.positiontup:
        params = tuple(compiled.params[name] for name in compiled.positiontup)
    else:
        params = compiled.params
    return sql, params


def _is_core_statement(statement) -> bool:
    return isinstance(statement, (ClauseElement, TextClause))


def _normalize_core_statement(statement):
    if _is_core_statement(statement):
        return statement
    raise TypeError("statement must be a SQLAlchemy Core clause or text()")


def fetch_all_core(profile: str, statement):
    """Execute a SQLAlchemy Select and return the facade's columns/rows shape."""
    statement = _normalize_core_statement(statement)
    config = get_db_profile(profile)
    provider = get_provider(config["type"])
    shared = active_transaction_connection(profile)
    engine = get_engine(profile, config=config)
    if engine is not None and shared is None:
        with engine.connect().execution_options(
            schema_translate_map=_schema_translate_map(config)
        ) as connection:
            result = connection.execute(statement)
            return list(result.keys()), [tuple(row) for row in result.fetchall()]

    connection = shared or connect_with_profile(profile)
    owns_connection = shared is None
    cursor = connection.cursor()
    try:
        sql, params = _compile(profile, statement, engine.dialect if engine is not None else None)
        cursor.execute(sql, params)
        columns = [item[0] for item in cursor.description] if cursor.description else []
        return columns, cursor.fetchall()
    finally:
        cursor.close()
        if owns_connection:
            connection.close()


def _execute_on_shared_or_owned(profile: str, runner):
    """Run write work on the active transaction connection or a dedicated one."""
    config = get_db_profile(profile)
    shared = active_transaction_connection(profile)
    engine = get_engine(profile, config=config)
    if engine is not None and shared is None:
        with engine.begin() as connection:
            return runner(connection, engine=engine, shared=False, config=config)

    connection = shared or connect_with_profile(profile)
    try:
        result = runner(connection, engine=engine, shared=shared is not None, config=config)
        if shared is None:
            _commit_if_needed(connection)
        return result
    except Exception:
        if shared is None:
            _rollback_if_needed(connection)
        raise
    finally:
        if shared is None:
            connection.close()


def execute_core(profile: str, statement) -> int:
    """Execute a SQLAlchemy Insert/Update/Delete and return affected rows."""
    statement = _normalize_core_statement(statement)

    def _run(connection, *, engine, shared, config):
        if engine is not None and not shared:
            result = connection.execution_options(
                schema_translate_map=_schema_translate_map(config)
            ).execute(statement)
            return int(result.rowcount or 0)
        cursor = connection.cursor()
        try:
            sql, params = _compile(profile, statement, engine.dialect if engine is not None else None)
            cursor.execute(sql, params)
            return int(cursor.rowcount or 0)
        finally:
            cursor.close()

    return _execute_on_shared_or_owned(profile, _run)


def execute_many_core(profile: str, statement, rows) -> int:
    """Execute one Core statement for each parameter mapping on a single connection."""
    statement = _normalize_core_statement(statement)
    payloads = [dict(row) for row in (rows or [])]
    if not payloads:
        return 0

    def _run(connection, *, engine, shared, config):
        if engine is not None and not shared:
            result = connection.execution_options(
                schema_translate_map=_schema_translate_map(config)
            ).execute(statement, payloads)
            return int(result.rowcount or 0)
        cursor = connection.cursor()
        try:
            affected = 0
            compile_dialect = engine.dialect if engine is not None else None
            for row in payloads:
                bound = statement.values(**row) if hasattr(statement, "values") else statement
                sql, params = _compile(profile, bound, compile_dialect)
                cursor.execute(sql, params)
                affected += int(cursor.rowcount or 0)
            return affected
        finally:
            cursor.close()

    return _execute_on_shared_or_owned(profile, _run)


def execute_statements_core(profile: str, statements) -> int:
    """Execute Core statements in order on one connection / transaction."""
    items = [_normalize_core_statement(statement) for statement in statements]
    if not items:
        return 0

    def _run(connection, *, engine, shared, config):
        if engine is not None and not shared:
            bound = connection.execution_options(schema_translate_map=_schema_translate_map(config))
            affected = 0
            for statement in items:
                result = bound.execute(statement)
                affected += int(result.rowcount or 0)
            return affected
        cursor = connection.cursor()
        try:
            affected = 0
            compile_dialect = engine.dialect if engine is not None else None
            for statement in items:
                sql, params = _compile(profile, statement, compile_dialect)
                cursor.execute(sql, params)
                affected += int(cursor.rowcount or 0)
            return affected
        finally:
            cursor.close()

    return _execute_on_shared_or_owned(profile, _run)


def next_pk(profile: str, table, column) -> int:
    """Allocate the next integer primary key with the historical MAX(id)+1 rule."""
    statement = select(func.coalesce(func.max(column), 0) + 1)
    if table is not None:
        statement = statement.select_from(table)
    _columns, rows = fetch_all_core(profile, statement)
    return int(rows[0][0])
