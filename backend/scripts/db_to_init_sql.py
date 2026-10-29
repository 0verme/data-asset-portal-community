# Copyright 2025 Jearhe
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

from __future__ import annotations

import argparse
import json
import sys
from datetime import date, datetime, time
from decimal import Decimal
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[2]
BACKEND_DIR = ROOT_DIR / "backend"
DOCS_DIR = ROOT_DIR / "docs"
EXPORT_ROOT = ROOT_DIR / "tmp" / "db-init-sql"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.db.facade import fetch_all, get_db_profile, resolve_db_profile_name
from app.db.write_target import EffectiveWriteTarget, WriteTargetError, resolve_write_target
from app.settings import load_runtime_env


TABLES = [
    "p_code_category",
    "p_code_item",
    "p_asset_domain",
    "p_asset_layer",
    "p_asset_table",
    "p_asset_field",
    "p_asset_change_log",
    "p_upstream_system",
    "p_upstream_unload_time",
    "p_upstream_change_log",
    "p_field_mapping_table",
    "p_field_mapping_field",
    "p_field_mapping_change_log",
    "p_indicator_item",
    "p_indicator_change_log",
    "p_root_category",
    "p_root_item",
    "p_root_change_log",
    "p_push_system",
    "p_push_job",
    "p_push_job_field",
    "p_push_change_log",
    "p_admin_user",
]

DIALECT_TO_OUTPUT = {
    "pg": EXPORT_ROOT / "pg" / "app-pg-init-data.sql",
    "dws": EXPORT_ROOT / "dws" / "app-dws-init-data.sql",
}
# 历史仓库路径：只有显式 --allow-repository-output 时才写入（docs/pg|dws/）。
REPO_DIALECT_TO_OUTPUT = {
    "pg": DOCS_DIR / "pg" / "app-pg-init-data.sql",
    "dws": DOCS_DIR / "dws" / "app-dws-init-data.sql",
}


def fetch_rows(profile: str, sql: str, params=None) -> list[dict]:
    columns, rows = fetch_all(profile, sql, params=params)
    return [dict(zip(columns, row)) for row in rows]


def profile_target(profile: str) -> EffectiveWriteTarget:
    """Resolve the source Profile explicitly; never fall back to legacy physical schema."""
    config = get_db_profile(profile)
    target = resolve_write_target(config)
    if target.provider not in {"postgres", "gaussdb", "mysql"}:
        raise WriteTargetError(
            "SQL snapshot export requires a PostgreSQL, GaussDB/DWS, or MySQL source Profile"
        )
    return target


def profile_schema(profile: str) -> str:
    target = profile_target(profile)
    return str(target.schema or target.database or "")


def _quote_identifier(identifier: str, provider: str) -> str:
    if provider == "mysql":
        return "`" + identifier.replace("`", "``") + "`"
    return '"' + identifier.replace('"', '""') + '"'


def _qualified_table(target: EffectiveWriteTarget, table_name: str) -> str:
    if target.provider == "mysql":
        schema = _quote_identifier(target.database or "", target.provider)
    else:
        schema = target.rendered_schema()
    if not schema:
        raise WriteTargetError("SQL snapshot source Profile has no explicit schema/database")
    return f"{schema}.{_quote_identifier(table_name, target.provider)}"


def resolve_output_target(dialect: str, schema: str) -> EffectiveWriteTarget:
    provider = {"pg": "postgres", "dws": "gaussdb"}.get(dialect)
    if provider is None:
        raise ValueError(f"Unsupported output dialect: {dialect}")
    return resolve_write_target({"type": provider, "schema": schema})


def sql_literal(value) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, (int, float, Decimal)):
        return str(value)
    if isinstance(value, datetime):
        return "'" + value.isoformat(sep=" ") + "'"
    if isinstance(value, (date, time)):
        return "'" + value.isoformat() + "'"
    if isinstance(value, (dict, list)):
        return "'" + json.dumps(value, ensure_ascii=False).replace("'", "''") + "'"
    if isinstance(value, bytes):
        return "'\\x" + value.hex() + "'"
    return "'" + str(value).replace("'", "''") + "'"


def load_table_columns(profile: str, schema_name: str, table_name: str) -> list[str]:
    rows = fetch_rows(
        profile,
        """
SELECT column_name
FROM information_schema.columns
WHERE table_schema = ?
  AND table_name = ?
ORDER BY ordinal_position
""".strip(),
        params=[schema_name, table_name],
    )
    return [row["column_name"] for row in rows]


def load_table_rows(
    profile: str,
    table_name: str,
    columns: list[str],
    source_target: EffectiveWriteTarget,
) -> list[dict]:
    if not columns:
        return []
    quoted_columns = [_quote_identifier(column, source_target.provider) for column in columns]
    order_by = ", ".join(quoted_columns[:3])
    sql = (
        f"SELECT {', '.join(quoted_columns)} "
        f"FROM {_qualified_table(source_target, table_name)}"
    )
    if order_by:
        sql += f" ORDER BY {order_by}"
    return fetch_rows(profile, sql)


def resolve_output_dialects(profile: str, dialect: str) -> list[str]:
    normalized = (dialect or "auto").strip().lower()
    if normalized == "auto":
        provider = str(get_db_profile(profile).get("type") or "").strip().lower()
        if provider == "postgres":
            normalized = "pg"
        elif provider in {"gaussdb", "dws"}:
            normalized = "dws"
        else:
            raise ValueError(
                "--dialect auto requires a PostgreSQL or GaussDB/DWS source Profile; "
                "select --dialect pg or --dialect dws explicitly"
            )
    if normalized == "both":
        return ["pg", "dws"]
    if normalized not in {"pg", "dws"}:
        raise ValueError(f"Unsupported dialect: {dialect}")
    return [normalized]


def resolve_output_paths(
    profile: str, dialect: str, allow_repository_output: bool
) -> list[Path]:
    mapping = REPO_DIALECT_TO_OUTPUT if allow_repository_output else DIALECT_TO_OUTPUT
    return [mapping[item] for item in resolve_output_dialects(profile, dialect)]


def load_profile_snapshot(
    profile: str,
) -> tuple[EffectiveWriteTarget, list[tuple[str, list[str], list[dict]]]]:
    source_target = profile_target(profile)
    schema_name = source_target.schema or source_target.database or ""
    if not schema_name:
        raise WriteTargetError("SQL snapshot source Profile has no explicit schema/database")

    tables = []
    for table_name in TABLES:
        columns = load_table_columns(profile, schema_name, table_name)
        rows = load_table_rows(profile, table_name, columns, source_target)
        tables.append((table_name, columns, rows))
    return source_target, tables


def build_delete_block(target: EffectiveWriteTarget) -> list[str]:
    lines = ["-- Clear current data before replaying inserts"]
    for table_name in reversed(TABLES):
        lines.append(f"DELETE FROM {_qualified_table(target, table_name)};")
    return lines


def build_insert_block(
    snapshot: list[tuple[str, list[str], list[dict]]],
    target: EffectiveWriteTarget,
) -> list[str]:
    lines = ["-- Replay current database snapshot"]
    for table_name, columns, rows in snapshot:
        qualified_table = _qualified_table(target, table_name)
        if not rows:
            lines.append(f"-- {table_name}: 0 rows")
            continue

        col_sql = ", ".join(
            _quote_identifier(column, target.provider) for column in columns
        )
        lines.append(f"-- {table_name}: {len(rows)} rows")
        for row in rows:
            values_sql = ", ".join(sql_literal(row[column]) for column in columns)
            lines.append(f"INSERT INTO {qualified_table} ({col_sql}) VALUES ({values_sql});")
    return lines


def _run_safety_scan(generated_files: list[Path]) -> list[str]:
    """Run Repository Public Data Guard over generated files; return BLOCKER messages."""
    try:
        sys.path.insert(0, str(ROOT_DIR / "demo"))
        from safety_scan import scan_file
    except ImportError:
        return ["warning: safety_scan 不可用，跳过敏感扫描（建议先跑 demo/validate_demo_data.py）"]

    blockers = []
    for path in generated_files:
        for finding in scan_file(path, ROOT_DIR):
            if finding["severity"] == "BLOCKER":
                blockers.append(f"{finding['label']}: {finding['detail']}")
    return blockers


def main():
    load_runtime_env()

    parser = argparse.ArgumentParser(description="Export current database data to replayable SQL.")
    parser.add_argument("--profile", help="Source database profile name")
    parser.add_argument(
        "--dialect",
        choices=["auto", "pg", "dws", "both"],
        default="both",
        help="Output SQL dialect target",
    )
    parser.add_argument(
        "--target-schema",
        required=True,
        help=(
            "Required final effective Profile schema of the replay destination; "
            "independently verify its database/session"
        ),
    )
    parser.add_argument("--output", help="Target SQL file path; requires a single output dialect")
    parser.add_argument(
        "--allow-repository-output",
        action="store_true",
        help="写入仓库 docs/ 路径。默认只写 git-ignored 的 tmp/db-init-sql/。"
        "仓库模式写盘前会对生成文件运行敏感数据扫描。",
    )
    args = parser.parse_args()

    profile = (args.profile or "").strip() or resolve_db_profile_name()
    output_dialects = resolve_output_dialects(profile, args.dialect)
    if args.output and len(output_dialects) != 1:
        parser.error("--output requires --dialect pg, --dialect dws, or a single-dialect auto result")
    output_paths = (
        [Path(args.output).resolve()]
        if args.output
        else resolve_output_paths(profile, args.dialect, args.allow_repository_output)
    )
    output_targets = [
        resolve_output_target(item, args.target_schema) for item in output_dialects
    ]
    source_target, snapshot = load_profile_snapshot(profile)

    if args.allow_repository_output:
        print("⚠️  --allow-repository-output：将写入仓库 docs/ 路径。")
        print("⚠️  写盘前将运行 Repository Public Data Guard，BLOCKER 级别发现会中止输出。")
    else:
        print(f"默认输出到 git-ignored 目录：{EXPORT_ROOT.relative_to(ROOT_DIR)}")
        print("如需写入仓库 docs/，请显式加 --allow-repository-output。")

    if len(output_targets) != len(output_paths):
        parser.error("Output dialect/path resolution mismatch")
    for output_path, output_dialect, output_target in zip(
        output_paths, output_dialects, output_targets
    ):
        lines = [
            "-- Generated by backend/scripts/db_to_init_sql.py",
            f"-- Source Profile: {profile} ({source_target.provider})",
            f"-- Output dialect: {output_dialect}",
            f"-- Replay target schema: {output_target.schema}",
            "-- Destination database/session is not verified by this exporter; review and verify it before replay.",
            "BEGIN;",
            *build_delete_block(output_target),
            "",
            *build_insert_block(snapshot, output_target),
            "COMMIT;",
            "",
        ]
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text("\n".join(lines), encoding="utf-8")

    if args.allow_repository_output:
        blockers = _run_safety_scan(output_paths)
        if blockers:
            print("\n❌ Repository Public Data Guard 发现 BLOCKER 级别内容，已中止提交：")
            for item in blockers:
                print(f"   {item}")
            return 3
        print("\n✅ Repository Public Data Guard：仓库输出无 BLOCKER 级别发现。")

    print(json.dumps({"profile": profile, "outputs": [str(path) for path in output_paths], "tables": TABLES}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
