"""Private GaussDB JDBC adapter with explicit optional dependencies."""

from __future__ import annotations

try:
    import jaydebeapi
except ImportError as exc:  # deterministic configuration error when selected
    raise RuntimeError(
        "GaussDB profile requires optional dependencies from requirements-gaussdb.txt"
    ) from exc


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
