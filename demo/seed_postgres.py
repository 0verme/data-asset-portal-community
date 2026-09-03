#!/usr/bin/env python3
"""Render an idempotent PostgreSQL/DWS-compatible repository seed.

The canonical column set comes from ``demo/seed_loader.py`` and
``backend/schema``; all rows are fictional demo metadata.
"""

# pyright: reportAttributeAccessIssue=false

from __future__ import annotations

import argparse
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

# The generated SQL contains CJK demo text; force UTF-8 stdout so piping the
# seed into a database works identically on Windows and POSIX terminals.
if sys.stdout.encoding and sys.stdout.encoding.lower() not in {"utf-8", "utf8"}:
    sys.stdout.reconfigure(encoding="utf-8")

try:
    from seed_loader import (  # noqa: E402
        DEMO_PUSH_AUTH_TYPE,
        LEGACY_DEMO_PUSH_AUTH_TYPE,
        community_seed_plan,
        demo_push_system_codes,
        rbac_seed_plan,
    )
except ImportError:  # imported as demo.seed_postgres from tests
    from demo.seed_loader import (  # noqa: E402
        DEMO_PUSH_AUTH_TYPE,
        LEGACY_DEMO_PUSH_AUTH_TYPE,
        community_seed_plan,
        demo_push_system_codes,
        rbac_seed_plan,
    )


def literal(value):
    if value is None:
        return "NULL"
    if isinstance(value, (int, float)):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def values(items):
    return ",\n".join("(" + ",".join(literal(value) for value in row) + ")" for row in items)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dialect", choices=("postgres", "dws"), default="postgres")
    args = parser.parse_args()
    print(f"-- full-channel retail demo seed: {args.dialect}")
    print("BEGIN;")
    print(
        "-- p_admin_user is not seeded here: create the first admin with"
    )
    print(
        "-- backend/scripts/reset_all_user_passwords.py after first startup."
    )
    seed_plan = {**rbac_seed_plan(), **community_seed_plan()}
    for table, spec in seed_plan.items():
        if not spec["rows"]:
            continue
        columns = ", ".join(spec["columns"])
        # Canonical unique key used for idempotent upsert:
        # p_system/p_data_source and code tables use natural keys; others use PK.
        key_column = {
            "p_system": "system_code",
            "p_data_source": "source_code",
            "p_code_category": "category_code",
            "p_code_item": "category_code,item_code",
            "p_lineage_node": "snapshot_id,node_id",
            "p_lineage_edge": "snapshot_id,edge_id",
            "p_role_permission": "role_code,permission_code",
        }.get(table, spec["columns"][0])
        print(
            f"INSERT INTO dwp.{table} ({columns}) VALUES\n"
            + values(spec["rows"])
            + f"\nON CONFLICT ({key_column}) DO NOTHING;"
        )
    system_codes = ", ".join(literal(code) for code in demo_push_system_codes())
    # pi-lens-ignore: python-sql-injection
    print(
        "UPDATE dwp.p_push_system "
        f"SET auth_type = {literal(DEMO_PUSH_AUTH_TYPE)} "
        f"WHERE system_code IN ({system_codes}) "
        f"AND auth_type = {literal(LEGACY_DEMO_PUSH_AUTH_TYPE)} "
        f"AND created_by = {literal('demo')};"
    )
    print("COMMIT;")


if __name__ == "__main__":
    main()
