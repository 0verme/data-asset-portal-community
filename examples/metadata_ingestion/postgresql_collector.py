#!/usr/bin/env python3
"""Small PostgreSQL -> DAP Metadata Contract reference collector.

This example intentionally has no dependency on DAP Python packages or DAP
schema names.  It reads PostgreSQL catalogs, builds public JSON, and submits
that JSON over HTTP.
"""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from typing import Any
from urllib.request import Request, urlopen


TABLE_SQL = """
SELECT n.nspname AS schema_name,
       c.relname AS table_name,
       obj_description(c.oid, 'pg_class') AS description
FROM pg_class AS c
JOIN pg_namespace AS n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 'p')
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
ORDER BY n.nspname, c.relname
"""

COLUMN_SQL = """
SELECT n.nspname AS schema_name,
       c.relname AS table_name,
       a.attname AS field_name,
       pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
       NOT a.attnotnull AS nullable,
       a.attnum AS ordinal_position,
       col_description(c.oid, a.attnum) AS description,
       EXISTS (
           SELECT 1
           FROM pg_index AS i
           WHERE i.indrelid = c.oid
             AND i.indisprimary
             AND a.attnum = ANY(i.indkey)
       ) AS primary_key
FROM pg_attribute AS a
JOIN pg_class AS c ON c.oid = a.attrelid
JOIN pg_namespace AS n ON n.oid = c.relnamespace
WHERE a.attnum > 0
  AND NOT a.attisdropped
  AND c.relkind IN ('r', 'p')
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
ORDER BY n.nspname, c.relname, a.attnum
"""


def _rows(cursor) -> list[dict]:
    names = [item[0] for item in cursor.description]
    return [dict(zip(names, row, strict=True)) for row in cursor.fetchall()]


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError, OverflowError):
        return default


def build_contract(
    table_rows: list[dict],
    column_rows: list[dict],
    *,
    source_name: str,
    source_namespace: str = "",
    database_name: str = "",
    collector_version: str = "0.1.0",
) -> dict:
    """Build the public Asset Contract from catalog rows.

    The function is separated from the CLI so a collector project can test its
    catalog mapping with fixtures without running a DAP instance.
    """
    fields_by_table: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for row in column_rows:
        key = (str(row["schema_name"]), str(row["table_name"]))
        fields_by_table[key].append(
            {
                "name": str(row["field_name"]),
                "dataType": str(row["data_type"]),
                "nullable": bool(row["nullable"]),
                "primaryKey": bool(row["primary_key"]),
                "ordinalPosition": _safe_int(row.get("ordinal_position")),
                "description": row.get("description") or str(row["field_name"]),
            }
        )

    assets = []
    for row in table_rows:
        schema_name = str(row["schema_name"])
        table_name = str(row["table_name"])
        qualified_name = f"{schema_name}.{table_name}"
        assets.append(
            {
                "externalId": qualified_name,
                "qualifiedName": qualified_name,
                "assetType": "table",
                "database": database_name,
                "schema": schema_name,
                "name": table_name,
                "description": row.get("description") or "",
                "fields": fields_by_table[(schema_name, table_name)],
            }
        )

    return {
        "contractVersion": "1.0",
        "source": {
            "type": "postgresql",
            "name": source_name,
            "namespace": source_namespace or None,
            "instance": database_name or None,
        },
        "collector": {
            "name": "postgresql-reference",
            "version": collector_version,
        },
        "assets": assets,
    }


def collect(connection, **kwargs) -> dict:
    with connection.cursor() as cursor:
        cursor.execute(TABLE_SQL)
        table_rows = _rows(cursor)
        cursor.execute(COLUMN_SQL)
        column_rows = _rows(cursor)
    return build_contract(table_rows, column_rows, **kwargs)


def publish(dap_url: str, payload: dict, *, session_cookie: str = "") -> tuple[int, str]:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if session_cookie:
        headers["Cookie"] = f"session={session_cookie}"
    request = Request(dap_url, data=body, headers=headers, method="POST")
    with urlopen(request, timeout=60) as response:
        return response.status, response.read().decode("utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Publish PostgreSQL catalog metadata to DAP")
    parser.add_argument("--postgres-dsn", required=True, help="PostgreSQL DSN; keep credentials outside source control")
    parser.add_argument("--dap-url", required=True, help="DAP metadata ingestion URL")
    parser.add_argument("--source-name", required=True)
    parser.add_argument("--source-namespace", default="")
    parser.add_argument("--collector-version", default="0.1.0")
    parser.add_argument("--session-cookie", default="", help="Optional signed session value supplied by the deployment")
    args = parser.parse_args()

    try:
        import psycopg  # type: ignore
    except ImportError as error:
        raise SystemExit("Install psycopg in the collector environment before running this example") from error

    with psycopg.connect(args.postgres_dsn) as connection:
        payload = collect(
            connection,
            source_name=args.source_name,
            source_namespace=args.source_namespace,
            database_name=connection.info.dbname or "",
            collector_version=args.collector_version,
        )
    status, response = publish(args.dap_url, payload, session_cookie=args.session_cookie)
    print(json.dumps({"status": status, "response": response}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
