"""GaussDB JDBC adapter with explicit optional dependencies."""

# pyright: reportMissingImports=false

from __future__ import annotations

import datetime

try:
    import jaydebeapi
except ImportError as exc:  # deterministic configuration error when selected
    raise RuntimeError(
        "GaussDB profile requires optional dependencies from requirements-gaussdb.txt"
    ) from exc


def _jdbc_class(java_name: str):
    """Resolve one JDBC class inside the running JVM.

    JPype is imported lazily and the JVM must already be started (JayDeBeApi
    starts it during ``connect``).  Importing this module therefore never
    requires a JVM; temporal conversion only happens at real JDBC runtime.
    """
    import jpype

    return jpype.JClass(java_name)


def _utc_wall_clock(value):
    """Normalize an aware temporal value to a UTC wall-clock value.

    GaussDB/DWS physical schemas use ``TIMESTAMP WITHOUT TIME ZONE``.  Aware
    values are explicitly written as UTC wall-clock values instead of relying
    on the JVM or operating-system timezone.  Naive values keep their
    wall-clock unchanged.
    """
    offset = value.utcoffset()
    if offset is None:
        return value
    if isinstance(value, datetime.datetime):
        return value.astimezone(datetime.timezone.utc).replace(tzinfo=None)
    # datetime.time has no astimezone(), so shift the wall clock by the offset.
    seconds = (
        value.hour * 3600 + value.minute * 60 + value.second
    ) - int(offset.total_seconds())
    seconds %= 24 * 3600
    return datetime.time(seconds // 3600, (seconds % 3600) // 60, seconds % 60)


def normalize_bind_value(value):
    """Convert Python temporal bind values to JDBC-compatible Java objects.

    The GaussDB vendor JDBC driver has no ``setObject(int, datetime)``
    overload, so JayDeBeApi cannot bind Python temporal objects directly.
    ``java.sql.Timestamp`` / ``Date`` / ``Time`` are real JDBC objects and
    keep the value inside the driver contract.  Non-temporal values are
    returned unchanged.
    """
    if isinstance(value, datetime.datetime):
        wall_clock = _utc_wall_clock(value)
        return _jdbc_class("java.sql.Timestamp").valueOf(
            wall_clock.isoformat(sep=" ", timespec="microseconds")
        )
    if isinstance(value, datetime.date):
        return _jdbc_class("java.sql.Date").valueOf(value.isoformat())
    if isinstance(value, datetime.time):
        # java.sql.Time is second-precision, so microseconds are truncated.
        wall_clock = _utc_wall_clock(value).replace(microsecond=0)
        return _jdbc_class("java.sql.Time").valueOf(
            wall_clock.isoformat(timespec="seconds")
        )
    return value


def normalize_bind_params(params):
    """Normalize every value in a JDBC bind-parameter sequence or mapping."""
    if params is None:
        return None
    if isinstance(params, dict):
        return {key: normalize_bind_value(value) for key, value in params.items()}
    return tuple(normalize_bind_value(value) for value in params)


def connect(config: dict):
    connection = jaydebeapi.connect(
        config["driver"],
        config["jdbc_url"],
        [config["user"], config["password"]],
        config["jar_path"],
    )
    try:
        java_connection = getattr(connection, "jconn", None)
        if java_connection is None:
            raise RuntimeError("GaussDB JDBC connection does not expose the Java connection")
        java_connection.setAutoCommit(False)
        if java_connection.getAutoCommit():
            raise RuntimeError("GaussDB JDBC connection remained in auto-commit mode")
        return connection
    except Exception:
        connection.close()
        raise
