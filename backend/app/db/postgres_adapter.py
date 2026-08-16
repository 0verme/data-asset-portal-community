"""PostgreSQL adapter. Driver import is isolated from SQLite startup."""

from __future__ import annotations


def connect(config: dict, *, options=None):
    try:
        import psycopg
    except ImportError:
        psycopg = None
    if psycopg is not None:
        if config.get("dsn"):
            return psycopg.connect(config["dsn"], autocommit=False, options=options)
        return psycopg.connect(
            host=config["host"],
            port=int(config["port"]),
            dbname=config["database"],
            user=config["user"],
            password=config["password"],
            connect_timeout=int(config["connect_timeout"]),
            autocommit=False,
            options=options,
        )

    try:
        import psycopg2
    except ImportError as exc:
        raise RuntimeError(
            "PostgreSQL driver not installed. Install psycopg[binary] or psycopg2-binary."
        ) from exc
    if config.get("dsn"):
        connection = psycopg2.connect(config["dsn"], options=options)
    else:
        connection = psycopg2.connect(
            host=config["host"],
            port=int(config["port"]),
            dbname=config["database"],
            user=config["user"],
            password=config["password"],
            connect_timeout=int(config["connect_timeout"]),
            options=options,
        )
    connection.autocommit = False
    return connection
