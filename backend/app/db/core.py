"""SQLAlchemy Core execution boundary for portable application CRUD."""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.dialects import postgresql
from sqlalchemy.sql.elements import TextClause
from sqlalchemy.sql.expression import ClauseElement

from .facade import (
    _commit_if_needed,
    _normalize_jdbc_bind_params,
    _rollback_if_needed,
    active_transaction_connection,
    connect_with_profile,
    get_db_profile,
    get_engine,
)
from .metadata import LOGICAL_SCHEMA
from .registry import get_provider
from .write_target import (
    EffectiveWriteTarget,
    WriteTargetError,
    resolve_write_target,
    rewrite_logical_schema,
    sql_has_write_keyword,
    validate_connection_target,
    validate_cursor_target,
    validate_write_sql,
)


def _schema_translate_map(config: dict) -> dict:
    provider = get_provider(config["type"])
    physical_schema = provider.physical_schema(config)
    if provider.name == "postgres" and physical_schema:
        # PostgreSQL's configured search_path and raw SQL identifiers are
        # unquoted, so their effective name is stripped and folded to lower case.
        physical_schema = physical_schema.strip().lower()
    return {LOGICAL_SCHEMA: physical_schema}


def _compile_statement(profile: str, statement, dialect=None, *, config=None):
    """Compile Core for a raw DB-API connection and keep the compiled object.

    The compiled object is returned so callers can rely on SQLAlchemy's own
    positional bind metadata (``positiontup``) instead of guessing parameter
    order from Python mappings.
    """
    config = get_db_profile(profile) if config is None else config
    provider = get_provider(config["type"])
    dialect = dialect or postgresql.dialect(paramstyle="qmark")
    compiled = statement.compile(
        dialect=dialect,
        compile_kwargs={"render_postcompile": True},
    )
    physical_schema = provider.physical_schema(config)
    if provider.name == "postgres" and physical_schema:
        physical_schema = physical_schema.strip().lower()
    sql = str(compiled)
    target = EffectiveWriteTarget(
        provider=provider.name,
        database=config.get("database"),
        schema=physical_schema or None,
    )
    sql = rewrite_logical_schema(sql, target)
    return sql, compiled, provider


def _compile_for_jdbc(profile: str, statement, dialect=None, *, config=None):
    """Compile Core for a raw DB-API connection and return its provider.

    The provider is returned so raw cursor callers can apply provider-specific
    bind normalization without loading the same profile a second time.
    """
    sql, compiled, provider = _compile_statement(
        profile, statement, dialect, config=config
    )
    if compiled.positiontup:
        params = tuple(compiled.params[name] for name in compiled.positiontup)
    else:
        params = compiled.params
    return sql, params, provider


def _compile(profile: str, statement, dialect=None):
    """Compile Core for a raw DB-API connection."""
    sql, params, _provider = _compile_for_jdbc(profile, statement, dialect)
    return sql, params


def _is_core_statement(statement) -> bool:
    return isinstance(statement, (ClauseElement, TextClause))


def _normalize_core_statement(statement):
    if _is_core_statement(statement):
        return statement
    raise TypeError("statement must be a SQLAlchemy Core clause or text()")


def _preflight_core_statement(profile: str, statement, config: dict, dialect=None):
    """Compile and validate a Core write before acquiring or using a connection."""
    provider = get_provider(config["type"]).name
    if isinstance(statement, TextClause):
        if sql_has_write_keyword(statement.text, provider):
            raise WriteTargetError(
                "TextClause DML/DDL is not an authorized write path; use Core tables "
                "or the controlled SQL facade"
            )
        return False, None, None

    sql, compiled, provider = _compile_statement(
        profile, statement, dialect=dialect, config=config
    )
    if not sql_has_write_keyword(sql, provider.name):
        return False, None, (sql, compiled, provider)
    target = resolve_write_target(config)
    validate_write_sql(sql, target)
    return True, target, (sql, compiled, provider)


def fetch_all_core(profile: str, statement):
    """Execute a SQLAlchemy Select and return the facade's columns/rows shape."""
    statement = _normalize_core_statement(statement)
    config = get_db_profile(profile)
    shared = active_transaction_connection(profile, config=config)
    engine = get_engine(profile, config=config)
    if engine is not None and shared is None:
        with engine.connect().execution_options(
            schema_translate_map=_schema_translate_map(config)
        ) as connection:
            result = connection.execute(statement)
            return list(result.keys()), [tuple(row) for row in result.fetchall()]

    connection = shared or connect_with_profile(profile, config=config)
    owns_connection = shared is None
    cursor = connection.cursor()
    try:
        sql, params, provider = _compile_for_jdbc(
            profile,
            statement,
            engine.dialect if engine is not None else None,
            config=config,
        )
        cursor.execute(sql, _normalize_jdbc_bind_params(provider, params))
        columns = [item[0] for item in cursor.description] if cursor.description else []
        return columns, cursor.fetchall()
    finally:
        cursor.close()
        if owns_connection:
            connection.close()


def _execute_on_shared_or_owned(
    profile: str,
    runner,
    *,
    config: dict,
    target: EffectiveWriteTarget | None,
    has_writes: bool,
):
    """Run write work on the active transaction connection or a dedicated one."""
    shared = active_transaction_connection(profile, config=config)
    engine = get_engine(profile, config=config)
    if engine is not None and shared is None:
        with engine.begin() as connection:
            if has_writes:
                validate_connection_target(connection, config, target)
            return runner(connection, engine=engine, shared=False, config=config)

    connection = shared or connect_with_profile(profile, config=config)
    try:
        if has_writes:
            validate_connection_target(connection, config, target)
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
    config = get_db_profile(profile)
    engine = get_engine(profile, config=config)
    has_writes, target, _compiled_info = _preflight_core_statement(
        profile, statement, config, engine.dialect if engine is not None else None
    )

    def _run(connection, *, engine, shared, config):
        if engine is not None and not shared:
            result = connection.execution_options(
                schema_translate_map=_schema_translate_map(config)
            ).execute(statement)
            return int(result.rowcount or 0)
        cursor = connection.cursor()
        try:
            sql, params, provider = _compile_for_jdbc(
                profile,
                statement,
                engine.dialect if engine is not None else None,
                config=config,
            )
            cursor.execute(sql, _normalize_jdbc_bind_params(provider, params))
            return int(cursor.rowcount or 0)
        finally:
            cursor.close()

    return _execute_on_shared_or_owned(
        profile, _run, config=config, target=target, has_writes=has_writes
    )


def execute_core_on_cursor(profile: str, cursor, statement) -> int:
    """Execute one Core statement on a caller-owned DB-API cursor.

    This is used by infrastructure code that already owns a transaction or
    cursor (for example the required audit writer).  Compilation remains in
    this module so callers never handle physical schemas or placeholders.
    """
    statement = _normalize_core_statement(statement)
    config = get_db_profile(profile)
    engine = get_engine(profile, config=config)
    has_writes, target, _compiled_info = _preflight_core_statement(
        profile, statement, config, engine.dialect if engine is not None else None
    )
    if has_writes:
        validate_cursor_target(cursor, config, target)
    sql, params, provider = _compile_for_jdbc(
        profile,
        statement,
        engine.dialect if engine is not None else None,
        config=config,
    )
    cursor.execute(sql, _normalize_jdbc_bind_params(provider, params))
    return int(getattr(cursor, "rowcount", 0) or 0)


def execute_core_on_connection(profile: str, connection, statement) -> int:
    """Execute one Core statement on a caller-owned DB-API connection."""
    statement = _normalize_core_statement(statement)
    config = get_db_profile(profile)
    engine = get_engine(profile, config=config)
    has_writes, target, _compiled_info = _preflight_core_statement(
        profile, statement, config, engine.dialect if engine is not None else None
    )
    if has_writes:
        validate_connection_target(connection, config, target)
    cursor = connection.cursor()
    try:
        sql, params, provider = _compile_for_jdbc(
            profile,
            statement,
            engine.dialect if engine is not None else None,
            config=config,
        )
        cursor.execute(sql, _normalize_jdbc_bind_params(provider, params))
        return int(getattr(cursor, "rowcount", 0) or 0)
    finally:
        cursor.close()


def _execute_many_jdbc_batch(
    profile, cursor, statement, payloads, compile_dialect, config, precompiled=None
):
    """Execute one homogeneous payload through the JDBC driver's batch API.

    The statement is compiled once from the first row; every later row only
    produces a bind-parameter tuple in the compiled statement's positional
    order, and JayDeBeApi turns the whole sequence into one
    ``prepareStatement`` + ``addBatch`` + ``executeBatch`` cycle.

    ``None`` is returned when the payload cannot use this fast path so the
    caller can fall back to per-row execution *before* anything has been sent
    to the database: non-insert statements, heterogeneous mappings, and
    statements whose compiled bind parameters do not match the row keys (for
    example an extra WHERE bind or a Python-side default).
    """
    if not hasattr(statement, "values"):
        return None
    if not callable(getattr(cursor, "executemany", None)):
        return None
    first = payloads[0]
    sql, compiled, provider = precompiled or _compile_statement(
        profile, statement.values(**first), compile_dialect, config=config
    )
    positiontup = tuple(compiled.positiontup or ())
    if not positiontup or set(positiontup) != set(first):
        return None
    parameter_rows = []
    for payload in payloads:
        if payload.keys() != first.keys():
            return None
        parameter_rows.append(tuple(payload[name] for name in positiontup))
    cursor.executemany(
        sql,
        [_normalize_jdbc_bind_params(provider, row) for row in parameter_rows],
    )
    return _jdbc_batch_rowcount(cursor, len(parameter_rows))


def _jdbc_batch_rowcount(cursor, attempted: int) -> int:
    """Interpret ``cursor.rowcount`` after a JDBC ``executeBatch()``.

    JayDeBeApi stores ``sum(executeBatch())`` in ``cursor.rowcount``.  JDBC
    drivers may report ``SUCCESS_NO_INFO`` for batched statements, which makes
    that sum unusable, so a successful batch with a negative total is reported
    as the number of attempted rows instead of a bogus value.  A failed batch
    raises before this helper is reached and must never be retried here.
    """
    rowcount = getattr(cursor, "rowcount", None)
    if rowcount is None:
        return attempted
    try:
        rowcount = int(rowcount)
    except (TypeError, ValueError):
        return attempted
    return rowcount if rowcount >= 0 else attempted


def execute_many_core(profile: str, statement, rows) -> int:
    """Execute one Core statement for each parameter mapping on a single connection."""
    statement = _normalize_core_statement(statement)
    payloads = [dict(row) for row in (rows or [])]
    if not payloads:
        return 0
    config = get_db_profile(profile)
    engine = get_engine(profile, config=config)
    preflight_statement = (
        statement.values(**payloads[0]) if hasattr(statement, "values") else statement
    )
    has_writes, target, precompiled = _preflight_core_statement(
        profile, preflight_statement, config, engine.dialect if engine is not None else None
    )

    def _run(connection, *, engine, shared, config):
        if engine is not None and not shared:
            result = connection.execution_options(
                schema_translate_map=_schema_translate_map(config)
            ).execute(statement, payloads)
            return int(result.rowcount or 0)
        cursor = connection.cursor()
        try:
            compile_dialect = engine.dialect if engine is not None else None
            if get_provider(config["type"]).name == "gaussdb":
                affected = _execute_many_jdbc_batch(
                    profile,
                    cursor,
                    statement,
                    payloads,
                    compile_dialect,
                    config,
                    precompiled=precompiled,
                )
                if affected is not None:
                    return affected
            affected = 0
            for row in payloads:
                bound = statement.values(**row) if hasattr(statement, "values") else statement
                sql, params, provider = _compile_for_jdbc(
                    profile, bound, compile_dialect, config=config
                )
                cursor.execute(sql, _normalize_jdbc_bind_params(provider, params))
                affected += int(cursor.rowcount or 0)
            return affected
        finally:
            cursor.close()

    return _execute_on_shared_or_owned(
        profile, _run, config=config, target=target, has_writes=has_writes
    )


def execute_statements_core(profile: str, statements) -> int:
    """Execute Core statements in order on one connection / transaction."""
    items = [_normalize_core_statement(statement) for statement in statements]
    if not items:
        return 0
    config = get_db_profile(profile)
    engine = get_engine(profile, config=config)
    target = None
    has_writes = False
    compile_dialect = engine.dialect if engine is not None else None
    for statement in items:
        statement_writes, statement_target, _compiled_info = _preflight_core_statement(
            profile, statement, config, compile_dialect
        )
        if statement_writes:
            has_writes = True
            target = statement_target

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
                sql, params, provider = _compile_for_jdbc(
                    profile, statement, compile_dialect, config=config
                )
                cursor.execute(sql, _normalize_jdbc_bind_params(provider, params))
                affected += int(cursor.rowcount or 0)
            return affected
        finally:
            cursor.close()

    return _execute_on_shared_or_owned(
        profile, _run, config=config, target=target, has_writes=has_writes
    )


def next_pk(profile: str, table, column) -> int:
    """Allocate the next integer primary key with the historical MAX(id)+1 rule."""
    statement = select(func.coalesce(func.max(column), 0) + 1)
    if table is not None:
        statement = statement.select_from(table)
    _columns, rows = fetch_all_core(profile, statement)
    return int(rows[0][0])
