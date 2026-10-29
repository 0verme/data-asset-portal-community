#!/usr/bin/env python3
"""Render an idempotent PostgreSQL/DWS-compatible repository seed.

The CLI requires an explicit schema from the final effective Profile. This
script only renders SQL; it does not connect to or validate the execution DB.
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

from backend.app.db.write_target import WriteTargetError, resolve_write_target  # noqa: E402

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


def conflict_guard_sql(schema, table, spec, primary_key, natural_keys=()):
    """Render an insert-only guard that aborts on conflicting seeded rows.

    Each SELECT returns the existing primary key plus valid canonical row
    values. It has no result for matching Demo data; a mismatch deliberately
    violates the primary key before any seed writes.
    """
    qualified_table = f"{schema}.{table}"
    columns = spec["columns"]
    branches = []
    for row in spec["rows"]:
        identity_conditions = []
        for key in (primary_key, *natural_keys):
            value = row[columns.index(key)]
            if value is not None:
                identity_conditions.append(f"existing.{key} = {literal(value)}")
        if not identity_conditions:
            continue

        mismatch_conditions = []
        for column, value in zip(columns, row):
            if value is None:
                mismatch_conditions.append(f"existing.{column} IS NOT NULL")
            else:
                mismatch_conditions.append(
                    f"(existing.{column} IS NULL OR existing.{column} <> {literal(value)})"
                )
        selected_values = ", ".join(
            f"existing.{column}"
            if column == primary_key
            else literal(value)
            for column, value in zip(columns, row)
        )
        branches.append(
            f"SELECT {selected_values}\n"
            f"FROM {qualified_table} AS existing\n"
            "WHERE ("
            + " OR ".join(identity_conditions)
            + ") AND ("
            + " OR ".join(mismatch_conditions)
            + ")"
        )

    if not branches:
        return ""
    return (
        "-- Fail fast before seed writes if an existing row matches a canonical "
        "ID/natural key but differs from the Demo contract.\n"
        "-- Canonical values satisfy row constraints; the deliberate duplicate "
        "primary key aborts the transaction.\n"
        f"INSERT INTO {qualified_table} ({', '.join(columns)})\n"
        + "\nUNION ALL\n".join(branches)
        + ";\n"
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dialect", choices=("postgres", "dws"), default="postgres")
    parser.add_argument(
        "--schema",
        required=True,
        help="final effective Profile schema after existing overrides (never inferred)",
    )
    args = parser.parse_args()
    provider = "postgres" if args.dialect == "postgres" else "gaussdb"
    try:
        schema = resolve_write_target(
            {"type": provider, "schema": args.schema}
        ).rendered_schema()
    except WriteTargetError as error:
        parser.error(f"invalid --schema: {error}")
    seed_plan = {**rbac_seed_plan(), **community_seed_plan()}
    print(f"-- full-channel retail demo seed: {args.dialect}")
    print(f"-- explicit application schema target: {schema}")
    print("-- Preflight rejects conflicting existing indicator path/indicator rows; matching rows remain insert-only.")
    print("BEGIN;")
    for table, primary_key, natural_keys in (
        ("p_indicator_path_config", "id", ("path_code", "full_path")),
        ("p_indicator_item", "indicator_pk", ("indicator_id",)),
    ):
        print(
            conflict_guard_sql(
                schema,
                table,
                seed_plan[table],
                primary_key,
                natural_keys,
            ),
            end="",
        )
    print(
        "-- p_admin_user is not seeded here: create the first admin with"
    )
    print(
        "-- backend/scripts/reset_all_user_passwords.py after first startup."
    )
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
            f"INSERT INTO {schema}.{table} ({columns}) VALUES\n"
            + values(spec["rows"])
            + f"\nON CONFLICT ({key_column}) DO NOTHING;"
        )
    system_codes = ", ".join(literal(code) for code in demo_push_system_codes())
    # pi-lens-ignore: python-sql-injection
    print(
        f"UPDATE {schema}.p_push_system "
        f"SET auth_type = {literal(DEMO_PUSH_AUTH_TYPE)} "
        f"WHERE system_code IN ({system_codes}) "
        f"AND auth_type = {literal(LEGACY_DEMO_PUSH_AUTH_TYPE)} "
        f"AND created_by = {literal('demo')};"
    )
    print("COMMIT;")


if __name__ == "__main__":
    main()
