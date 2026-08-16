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

from app.db.gaussdb import fetch_all, get_db_profile, resolve_db_profile_name
from app.settings import load_runtime_env


TABLES = [
    "dwp.p_code_category",
    "dwp.p_code_item",
    "dwp.p_asset_domain",
    "dwp.p_asset_layer",
    "dwp.p_asset_table",
    "dwp.p_asset_field",
    "dwp.p_asset_change_log",
    "dwp.p_upstream_system",
    "dwp.p_upstream_unload_time",
    "dwp.p_upstream_change_log",
    "dwp.p_field_mapping_table",
    "dwp.p_field_mapping_field",
    "dwp.p_field_mapping_change_log",
    "dwp.p_indicator_item",
    "dwp.p_indicator_change_log",
    "dwp.p_root_category",
    "dwp.p_root_item",
    "dwp.p_root_change_log",
    "dwp.p_push_system",
    "dwp.p_push_job",
    "dwp.p_push_job_field",
    "dwp.p_push_change_log",
    "dwp.p_admin_user",
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


def fetch_rows(profile: str, sql: str) -> list[dict]:
    columns, rows = fetch_all(profile, sql)
    return [dict(zip(columns, row)) for row in rows]


def split_table_name(qualified_name: str) -> tuple[str, str]:
    schema_name, table_name = qualified_name.split(".", 1)
    return schema_name, table_name


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
        f"""
SELECT column_name
FROM information_schema.columns
WHERE table_schema = '{schema_name}'
  AND table_name = '{table_name}'
ORDER BY ordinal_position
""".strip(),
    )
    return [row["column_name"] for row in rows]


def load_table_rows(profile: str, qualified_name: str, columns: list[str]) -> list[dict]:
    if not columns:
        return []
    order_by = ", ".join(columns[:3])
    sql = f"SELECT {', '.join(columns)} FROM {qualified_name}"
    if order_by:
        sql += f" ORDER BY {order_by}"
    return fetch_rows(profile, sql)


def resolve_output_paths(profile: str, dialect: str, allow_repository_output: bool) -> list[Path]:
    normalized = (dialect or "auto").strip().lower()
    mapping = REPO_DIALECT_TO_OUTPUT if allow_repository_output else DIALECT_TO_OUTPUT
    if normalized == "auto":
        config = get_db_profile(profile)
        normalized = "pg" if config["type"] == "postgres" else "dws"
    if normalized == "both":
        return [mapping["pg"], mapping["dws"]]
    if normalized not in mapping:
        raise ValueError(f"Unsupported dialect: {dialect}")
    return [mapping[normalized]]


def build_delete_block() -> list[str]:
    lines = ["-- Clear current data before replaying inserts"]
    for qualified_name in reversed(TABLES):
        lines.append(f"DELETE FROM {qualified_name};")
    return lines


def build_insert_block(profile: str) -> list[str]:
    lines = ["-- Replay current database snapshot"]
    for qualified_name in TABLES:
        schema_name, table_name = split_table_name(qualified_name)
        columns = load_table_columns(profile, schema_name, table_name)
        rows = load_table_rows(profile, qualified_name, columns)
        if not rows:
            lines.append(f"-- {qualified_name}: 0 rows")
            continue

        col_sql = ", ".join(columns)
        lines.append(f"-- {qualified_name}: {len(rows)} rows")
        for row in rows:
            values_sql = ", ".join(sql_literal(row[column]) for column in columns)
            lines.append(f"INSERT INTO {qualified_name} ({col_sql}) VALUES ({values_sql});")
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
    parser.add_argument("--profile", help="Database profile name")
    parser.add_argument("--dialect", choices=["auto", "pg", "dws", "both"], default="both", help="Output SQL dialect target")
    parser.add_argument("--output", help="Target SQL file path")
    parser.add_argument(
        "--allow-repository-output",
        action="store_true",
        help="写入仓库 docs/ 路径。默认只写 git-ignored 的 tmp/db-init-sql/。"
        "仓库模式写盘前会对生成文件运行敏感数据扫描。",
    )
    args = parser.parse_args()

    profile = (args.profile or "").strip() or resolve_db_profile_name()
    output_paths = (
        [Path(args.output).resolve()]
        if args.output
        else resolve_output_paths(profile, args.dialect, args.allow_repository_output)
    )

    if args.allow_repository_output:
        print("⚠️  --allow-repository-output：将写入仓库 docs/ 路径。")
        print("⚠️  写盘前将运行 Repository Public Data Guard，BLOCKER 级别发现会中止输出。")
    else:
        print(f"默认输出到 git-ignored 目录：{EXPORT_ROOT.relative_to(ROOT_DIR)}")
        print("如需写入仓库 docs/，请显式加 --allow-repository-output。")

    lines = [
        "-- Generated by backend/scripts/db_to_init_sql.py",
        f"-- Profile: {profile}",
        "BEGIN;",
        *build_delete_block(),
        "",
        *build_insert_block(profile),
        "COMMIT;",
        "",
    ]
    for output_path in output_paths:
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
