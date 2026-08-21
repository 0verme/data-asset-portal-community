"""Optional PyMySQL connection adapter."""

from __future__ import annotations

import re


def _positive_int(value, key: str) -> int:
    try:
        result = int(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"MySQL {key} must be a positive integer") from error
    if result < 1:
        raise ValueError(f"MySQL {key} must be a positive integer")
    return result


def connect(config: dict):
    charset = str(config.get("charset", "utf8mb4"))
    collation = str(config.get("collation", "utf8mb4_unicode_ci"))
    for key, value in (("charset", charset), ("collation", collation)):
        if not re.fullmatch(r"[A-Za-z0-9_]+", value):
            raise ValueError(f"MySQL {key} must be a safe identifier")
    port = _positive_int(config.get("port", 3306), "port")
    connect_timeout = _positive_int(config.get("connect_timeout", 10), "connect_timeout")
    read_timeout = _positive_int(config.get("read_timeout", 30), "read_timeout")
    write_timeout = _positive_int(config.get("write_timeout", 30), "write_timeout")

    try:
        import pymysql
    except ImportError as error:
        raise RuntimeError(
            "MySQL provider requires the optional PyMySQL dependency; install backend/requirements-mysql.txt"
        ) from error

    return pymysql.connect(
        host=config.get("host", "127.0.0.1"),
        port=port,
        user=config["user"],
        password=config["password"],
        database=config["database"],
        charset=charset,
        connect_timeout=connect_timeout,
        read_timeout=read_timeout,
        write_timeout=write_timeout,
        init_command=(
            f"SET NAMES {charset} "
            f"COLLATE {collation}"
        ),
        autocommit=False,
    )
