#!/usr/bin/env python3
"""Idempotently seed the safe Community datasets into an explicit SQLite file.

Community-owned tables only; the canonical column set comes from
``demo/seed_loader.py`` (aligned with ``backend/schema``).
"""

# pyright: reportMissingImports=false

from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path

from werkzeug.security import generate_password_hash

ROOT = Path(__file__).resolve().parent
if str(ROOT.parent) not in sys.path:
    sys.path.insert(0, str(ROOT.parent))

try:
    from backend.app.authorization.persistence import seed_rbac  # noqa: E402
    from seed_loader import ADMIN_USER, community_seed_plan  # noqa: E402
except ImportError:  # imported as demo.seed_sqlite from tests
    from backend.app.authorization.persistence import seed_rbac  # noqa: E402
    from demo.seed_loader import ADMIN_USER, community_seed_plan  # noqa: E402


def seed(database: Path):
    if not database.is_absolute():
        raise ValueError("--database must be an absolute path")
    connection = sqlite3.connect(database)
    connection.execute("PRAGMA foreign_keys = ON")
    try:
        seed_rbac(
            connection,
            {"type": "sqlite", "database": str(database)},
            schema="",
        )
        connection.execute(
            "INSERT OR IGNORE INTO p_admin_user "
            "(id,username,password_hash,display_name,role,status) VALUES (?,?,?,?,?,?)",
            (
                ADMIN_USER["id"],
                ADMIN_USER["username"],
                generate_password_hash(ADMIN_USER["password"]),
                ADMIN_USER["display_name"],
                ADMIN_USER["role"],
                ADMIN_USER["status"],
            ),
        )
        for table, spec in community_seed_plan().items():
            columns = ", ".join(spec["columns"])
            placeholders = ", ".join("?" for _ in spec["columns"])
            statement = (
                f"INSERT OR IGNORE INTO {table} ({columns}) VALUES ({placeholders})"
            )
            for row in spec["rows"]:
                connection.execute(statement, row)
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", type=Path, required=True)
    args = parser.parse_args()
    seed(args.database.resolve())
    print("community demo seed=ok")


if __name__ == "__main__":
    main()
