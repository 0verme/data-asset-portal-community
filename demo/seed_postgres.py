#!/usr/bin/env python3
"""Render an idempotent PostgreSQL/DWS-compatible Community seed without
opening a database.

Community-owned tables only; the canonical column set comes from
``demo/seed_loader.py`` (aligned with ``backend/migrations``).
"""

from __future__ import annotations

import argparse

try:
    from seed_loader import community_seed_plan  # noqa: E402
except ImportError:  # imported as demo.seed_postgres from tests
    from demo.seed_loader import community_seed_plan  # noqa: E402


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
    for table, spec in community_seed_plan().items():
        if not spec["rows"]:
            continue
        columns = ", ".join(spec["columns"])
        # Canonical unique key used for idempotent upsert:
        # p_system/p_data_source key on their code columns, others on PK.
        key_column = {
            "p_system": "system_code",
            "p_data_source": "source_code",
        }.get(table, spec["columns"][0])
        print(
            f"INSERT INTO dwp.{table} ({columns}) VALUES\n"
            + values(spec["rows"])
            + f"\nON CONFLICT ({key_column}) DO NOTHING;"
        )
    print("COMMIT;")


if __name__ == "__main__":
    main()
