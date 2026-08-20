"""Optional PyMySQL connection adapter."""

from __future__ import annotations


def connect(config: dict):
    try:
        import pymysql
    except ImportError as error:
        raise RuntimeError(
            "MySQL provider requires the optional PyMySQL dependency; install backend/requirements-mysql.txt"
        ) from error

    return pymysql.connect(
        host=config.get("host", "127.0.0.1"),
        port=int(config.get("port", 3306)),
        user=config["user"],
        password=config["password"],
        database=config["database"],
        charset=config.get("charset", "utf8mb4"),
        connect_timeout=int(config.get("connect_timeout", 10)),
        read_timeout=int(config.get("read_timeout", 30)),
        write_timeout=int(config.get("write_timeout", 30)),
        init_command=(
            f"SET NAMES {config.get('charset', 'utf8mb4')} "
            f"COLLATE {config.get('collation', 'utf8mb4_unicode_ci')}"
        ),
        autocommit=False,
    )
