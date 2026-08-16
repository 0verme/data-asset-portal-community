"""SQLite adapter used by Community and isolated tests."""

from __future__ import annotations

import sqlite3
from pathlib import Path


def connect(config: dict):
    database = str(config["database"])
    if database == ":memory:":
        database = "file:asset_portal_community?mode=memory&cache=shared"
        connection = sqlite3.connect(database, uri=True)
        connection.execute("ATTACH DATABASE ':memory:' AS dwp")
    else:
        path = Path(database).expanduser().resolve()
        path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(":memory:")
        connection.execute("ATTACH DATABASE ? AS dwp", (str(path),))
    connection.execute("PRAGMA foreign_keys = ON")
    return connection
