#!/usr/bin/env python3

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

# -*- coding: utf-8 -*-
"""
sync_from_pg.py — 把「测试环境 PostgreSQL(schema=dwp)」作为唯一真相，按表导出到下游。

默认导出到 git-ignored 目录（tmp/sync-from-pg/），防止测试库内容直接进入仓库：

  1. 前端 mock JSON   -> tmp/sync-from-pg/mock/{表名}.json
  2. pg 初始化 SQL    -> tmp/sync-from-pg/pg/sample/{表名}.sql
  3. dws 初始化 SQL   -> tmp/sync-from-pg/dws/sample/{表名}.sql (DWS/GaussDB 兼容)

要写入仓库（docs/ 与 frontend/src/mock/）时必须显式开启：

  python scripts/sync_from_pg.py --allow-repository-output

仓库模式会在写盘前对全部生成文件运行 Repository Public Data Guard；
发现 BLOCKER 级别敏感内容时拒绝输出。

约束：
  - 测试库数据已脱敏，本脚本不负责脱敏，只负责导出；生成物仍需人工 review。
  - 连接信息(DSN)从环境变量读取，绝不硬编码、不进 git。
  - 依赖：psycopg(v3，仓库 backend/requirements.txt 已装 psycopg[binary]==3.2.12)。

用法：
  set SYNC_PG_DSN=postgresql://user:pass@host:5432/dbname   (PowerShell: $env:SYNC_PG_DSN=...)
  python scripts/sync_from_pg.py
  # 可选：SYNC_PG_SCHEMA 覆盖默认 schema(dwp)

注意：先 review，再自行运行。
"""

from __future__ import annotations

import datetime as _dt
import json
import os
import sys
from decimal import Decimal
from pathlib import Path

try:
    import psycopg  # psycopg v3
    from psycopg.rows import dict_row
except ImportError:  # pragma: no cover
    sys.exit(
        "缺少 psycopg(v3)。请在内网安装：pip install psycopg[binary]==3.2.12\n"
        "(仓库 backend/requirements.txt 已声明该依赖)"
    )

# ---------------------------------------------------------------------------
# 表配置 —— 占位，请自行填真实表名与策略
#
# 每张表可指定：
#   mode : "full"  全量导出
#          "limit" 取样导出（配合 limit 指定行数）
#          "skip"  跳过（如日志类）
#   mock : True/False  是否同时生成前端 mock JSON
#   limit: int         mode="limit" 时的取样行数（默认 100）
#   order_by: str|None 取样/导出排序（保证结果稳定、可对比），如 "category_id"
#   shape: callable|None  mock 形状钩子：rows(原始行 dict 列表) -> 可序列化结构。
#                         不填则输出 snake_case 裸行数组；填了则按前端 src/data 结构生成。
#
# 声明顺序 = SQL \i 引入顺序，请按外键依赖从父到子排列。
# 约定：码值/菜单类用 full；业务数据(资产/指标)用 limit 取样；日志类 skip。
#
# 说明（跨表复合页）：commonCodes(p_code_category + p_code_item 嵌套)、tables 等
# 由多表 join 成的 bespoke 结构，不走本脚本的 mock 生成（mock=False），继续手维护
# src/data/*.js；它们的 SQL 仍会按表正常导出。shape 钩子只服务「单表 1:1」的页面。
# ---------------------------------------------------------------------------
# ---- mock shape 钩子 工具 & 示例（单表 1:1 用） -----------------------------
def yn_to_bool(value) -> bool:
    """PG 里的 CHAR(1) 'Y'/'N' -> 前端布尔。"""
    return str(value).strip().upper() == "Y"


def pick(row: dict, mapping: dict) -> dict:
    """按 {目标键: 源列名} 取字段并重命名，丢弃未列出的列（如审计列）。"""
    return {dst: row.get(src) for dst, src in mapping.items()}


# 示例：某个 1:1 表的 shaper（请按真实页面结构改写后挂到 TABLES 的 shape 上）。
# 入参是「该表的全部行(dict 列表)」，返回值会被 json.dumps 写进 src/mock/{表}.json。
def shape_example_flat(rows):
    out = []
    for r in rows:
        item = pick(r, {
            "code": "item_code",
            "name": "item_name",
            "value": "item_value",
            "desc": "item_desc",
            "order": "display_order",
        })
        item["active"] = yn_to_bool(r.get("is_active"))
        out.append(item)
    return out


# 声明顺序 = \i 引入顺序，已按外键依赖从父到子排列。
# mock 暂统一 False：各页前端结构(src/data/*.js)为 bespoke，需逐页写 shaper 后再开启。
TABLES: "dict[str, dict]" = {
    # ---- 码值 ----
    "p_code_category":           {"mode": "full", "mock": False, "order_by": "category_id"},
    "p_code_item":               {"mode": "full", "mock": False, "order_by": "item_id"},
    # ---- 菜单 / 账号 ----
    "p_menu":                    {"mode": "full", "mock": False, "order_by": "menu_id"},
    "p_admin_user":              {"mode": "full", "mock": False, "order_by": "id"},
    # ---- 根因/分类 ----
    "p_root_category":           {"mode": "full", "mock": False, "order_by": "category_id"},
    "p_root_item":               {"mode": "full", "mock": False, "order_by": "root_id"},
    # ---- 资产 ----
    "p_asset_domain":            {"mode": "full", "mock": False, "order_by": "domain_id"},
    "p_asset_layer":             {"mode": "full", "mock": False, "order_by": "layer_id"},
    "p_asset_table":             {"mode": "full", "mock": False, "order_by": "asset_id"},
    "p_asset_field":             {"mode": "full", "mock": False, "order_by": "field_id"},
    # ---- 指标 ----
    "p_indicator_item":          {"mode": "full", "mock": False, "order_by": "indicator_id"},
    # ---- 字段映射 ----
    "p_field_mapping_system":    {"mode": "full", "mock": False, "order_by": "system_pk"},
    "p_field_mapping_table":     {"mode": "full", "mock": False, "order_by": "table_pk"},
    "p_field_mapping_field":     {"mode": "full", "mock": False, "order_by": "field_pk"},
    # ---- 上游卸数 ----
    "p_upstream_system":         {"mode": "full", "mock": False, "order_by": "system_id"},
    "p_upstream_unload_time":    {"mode": "full", "mock": False, "order_by": "time_pk"},
    # ---- 下游推送 ----
    "p_push_system":             {"mode": "full", "mock": False, "order_by": "system_id"},
    "p_push_job":                {"mode": "full", "mock": False, "order_by": "job_id"},
    "p_push_job_field":          {"mode": "full", "mock": False, "order_by": "field_id"},

    # ---- 日志/变更历史：跳过(按约定) ----
    "p_operation_log":           {"mode": "skip", "mock": False},
    "p_asset_change_log":        {"mode": "skip", "mock": False},
    "p_indicator_change_log":    {"mode": "skip", "mock": False},
    "p_field_mapping_change_log": {"mode": "skip", "mock": False},
    "p_upstream_change_log":     {"mode": "skip", "mock": False},
    "p_push_change_log":         {"mode": "skip", "mock": False},
    "p_root_change_log":         {"mode": "skip", "mock": False},
}

# ---------------------------------------------------------------------------
# 输出路径（相对项目根，脚本位于 scripts/ 下）
# 默认全部写入 git-ignored 的 tmp/sync-from-pg/；--allow-repository-output
# 时才写回仓库原有路径（docs/ 与 frontend/src/mock/）。
# ---------------------------------------------------------------------------
ROOT = Path(__file__).resolve().parent.parent
EXPORT_ROOT = ROOT / "tmp" / "sync-from-pg"
MOCK_DIR = EXPORT_ROOT / "mock"
PG_DIR = EXPORT_ROOT / "pg" / "sample"
DWS_DIR = EXPORT_ROOT / "dws" / "sample"

REPO_MOCK_DIR = ROOT / "frontend" / "src" / "mock"
REPO_PG_DIR = ROOT / "docs" / "pg" / "sample"
REPO_DWS_DIR = ROOT / "docs" / "dws" / "sample"

DEFAULT_SCHEMA = os.environ.get("SYNC_PG_SCHEMA", "dwp")
DEFAULT_LIMIT = 100
BATCH_ROWS = 500  # 多行批量 INSERT 的每批行数

# 两套 SQL 方言（目前 pg / dws 共用同一套生成逻辑，保留结构方便以后单独调整）
DIALECTS = {
    "pg": {"label": "PostgreSQL", "dir": PG_DIR, "entry": "init-sample.sql"},
    "dws": {"label": "DWS / GaussDB", "dir": DWS_DIR, "entry": "init-sample.sql"},
}
REPO_DIALECTS = {
    "pg": {"label": "PostgreSQL", "dir": REPO_PG_DIR, "entry": "init-sample.sql"},
    "dws": {"label": "DWS / GaussDB", "dir": REPO_DWS_DIR, "entry": "init-sample.sql"},
}


# ---------------------------------------------------------------------------
# 类型 -> SQL 字面量
# ---------------------------------------------------------------------------
def sql_literal(value, dialect: str) -> str:
    """把一个 Python 值转成 SQL 字面量。dialect 暂未产生差异，保留参数以备后用。"""
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, (int, float)):
        return repr(value)
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (_dt.datetime, _dt.date, _dt.time)):
        return "'" + value.isoformat() + "'"
    if isinstance(value, (bytes, bytearray, memoryview)):
        return "'\\x" + bytes(value).hex() + "'"  # PG bytea hex 格式
    if isinstance(value, (dict, list)):
        # jsonb / json 列：序列化后按字符串转义
        return _quote_str(json.dumps(value, ensure_ascii=False))
    return _quote_str(str(value))


def _quote_str(text: str) -> str:
    # 标准 SQL：单引号翻倍转义（依赖 standard_conforming_strings=on，PG/DWS 默认开启）
    return "'" + text.replace("'", "''") + "'"


# ---------------------------------------------------------------------------
# 类型 -> mock JSON 可序列化值
# ---------------------------------------------------------------------------
def _json_default(value):
    if isinstance(value, Decimal):
        # Decimal -> number（保留精度交给 json，整数会落整数）
        return int(value) if value == value.to_integral_value() else float(value)
    if isinstance(value, (_dt.datetime, _dt.date, _dt.time)):
        return value.isoformat()
    if isinstance(value, (bytes, bytearray, memoryview)):
        return bytes(value).hex()
    raise TypeError(f"无法序列化为 JSON 的类型: {type(value)!r}")


# ---------------------------------------------------------------------------
# 读取一张表
# ---------------------------------------------------------------------------
def fetch_table(conn, schema: str, table: str, cfg: dict):
    qualified = f'"{schema}"."{table}"'
    sql = f"SELECT * FROM {qualified}"
    order_by = cfg.get("order_by")
    if order_by:
        sql += f" ORDER BY {order_by}"
    if cfg["mode"] == "limit":
        sql += f" LIMIT {int(cfg.get('limit', DEFAULT_LIMIT))}"

    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(sql)
        rows = cur.fetchall()
        columns = [d.name for d in cur.description] if cur.description else []
    return columns, rows


# ---------------------------------------------------------------------------
# 生成单表 SQL（pg / dws 共用）
# ---------------------------------------------------------------------------
def build_table_sql(schema: str, table: str, columns, rows, dialect: str, generated_at: str) -> str:
    meta = DIALECTS[dialect]
    qualified = f"{schema}.{table}"
    col_list = ", ".join(columns)

    lines = [
        f"-- 自动生成，请勿手工编辑 (generated by scripts/sync_from_pg.py)",
        f"-- target  : {meta['label']}",
        f"-- table   : {qualified}",
        f"-- rows    : {len(rows)}",
        f"-- generated_at: {generated_at}",
        "",
        f"TRUNCATE TABLE {qualified};",
        "",
    ]

    if not rows:
        lines.append(f"-- (无数据)")
        return "\n".join(lines) + "\n"

    insert_head = f"INSERT INTO {qualified} ({col_list}) VALUES"
    for start in range(0, len(rows), BATCH_ROWS):
        batch = rows[start : start + BATCH_ROWS]
        value_tuples = []
        for row in batch:
            vals = ", ".join(sql_literal(row[c], dialect) for c in columns)
            value_tuples.append(f"    ({vals})")
        lines.append(insert_head)
        lines.append(",\n".join(value_tuples) + ";")
        lines.append("")

    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------
# 生成 mock JSON（原样行数组，键为 DB 列名）
# ---------------------------------------------------------------------------
def build_mock_json(columns, rows, shape=None) -> str:
    if shape is not None:
        payload = shape([dict(row) for row in rows])  # 前端 src/data 结构
    else:
        payload = [{c: row[c] for c in columns} for row in rows]  # snake_case 裸行数组
    return json.dumps(payload, ensure_ascii=False, indent=2, default=_json_default)


# ---------------------------------------------------------------------------
# 入口文件：按 TABLES 声明顺序 \i 引入各表 sql
# ---------------------------------------------------------------------------
def build_entry_sql(dialect: str, exported_tables, generated_at: str) -> str:
    meta = DIALECTS[dialect]
    lines = [
        f"-- 自动生成，请勿手工编辑 (generated by scripts/sync_from_pg.py)",
        f"-- target  : {meta['label']}",
        f"-- 按 TABLES 声明顺序引入（保证外键依赖：父表在前）",
        f"-- generated_at: {generated_at}",
        "",
    ]
    for table in exported_tables:
        lines.append(f"\\i {table}.sql")
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------
def _parse_args():
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--allow-repository-output",
        action="store_true",
        help="写回仓库路径 (docs/**/sample 与 frontend/src/mock)。默认只写 tmp/sync-from-pg/。"
        "仓库模式写盘前会对生成文件运行敏感数据扫描。",
    )
    return parser.parse_args()


def _run_safety_scan(generated_files) -> list[str]:
    """Run Repository Public Data Guard over generated files; return BLOCKER messages."""
    try:
        sys.path.insert(0, str(ROOT / "demo"))
        from safety_scan import scan_file
    except ImportError:
        return ["warning: safety_scan 不可用，跳过敏感扫描（建议先跑 demo/validate_demo_data.py）"]

    blockers = []
    for path in generated_files:
        for finding in scan_file(path, ROOT):
            if finding["severity"] == "BLOCKER":
                blockers.append(f"{finding['label']}: {finding['detail']}")
    return blockers


def main() -> int:
    args = _parse_args()
    try:
        sys.stdout.reconfigure(encoding="utf-8")  # 避免 Windows GBK 控制台编码报错
    except Exception:
        pass

    dsn = os.environ.get("SYNC_PG_DSN")
    if not dsn:
        sys.exit(
            "未设置环境变量 SYNC_PG_DSN。\n"
            "示例 (PowerShell): $env:SYNC_PG_DSN='postgresql://user:pass@host:5432/db'"
        )

    active = {t: c for t, c in TABLES.items() if c.get("mode") != "skip"}
    skipped = [t for t, c in TABLES.items() if c.get("mode") == "skip"]

    if not active:
        sys.exit("TABLES 里没有可导出的表（都为空或 skip）。请先在 TABLES 填入真实表名与策略。")

    # 选择目标目录：默认 git-ignored tmp/；显式开启后才写仓库。
    if args.allow_repository_output:
        dialects = REPO_DIALECTS
        mock_dir = REPO_MOCK_DIR
        print("⚠️  --allow-repository-output：将写入仓库路径 (docs/**/sample, frontend/src/mock)。")
        print("⚠️  写盘前将运行 Repository Public Data Guard，BLOCKER 级别发现会中止输出。")
    else:
        dialects = DIALECTS
        mock_dir = MOCK_DIR
        print(f"默认输出到 git-ignored 目录：{EXPORT_ROOT.relative_to(ROOT)}")
        print("如需写入仓库，请显式加 --allow-repository-output。")

    for d in dialects.values():
        d["dir"].mkdir(parents=True, exist_ok=True)
    mock_dir.mkdir(parents=True, exist_ok=True)

    generated_at = _dt.datetime.now().isoformat(timespec="seconds")
    summary = []  # (table, rows, mock?)
    exported_order = []
    generated_files = []

    print(f"连接测试 PG，schema = {DEFAULT_SCHEMA}\n")
    with psycopg.connect(dsn) as conn:
        for table, cfg in active.items():
            columns, rows = fetch_table(conn, DEFAULT_SCHEMA, table, cfg)
            exported_order.append(table)

            # 1) 两套 SQL
            for dialect, meta in dialects.items():
                sql_text = build_table_sql(
                    DEFAULT_SCHEMA, table, columns, rows, dialect, generated_at
                )
                out = meta["dir"] / f"{table}.sql"
                out.write_text(sql_text, encoding="utf-8")
                generated_files.append(out)

            # 2) mock JSON（按配置）
            wrote_mock = False
            if cfg.get("mock"):
                out = mock_dir / f"{table}.json"
                out.write_text(
                    build_mock_json(columns, rows, cfg.get("shape")), encoding="utf-8"
                )
                generated_files.append(out)
                wrote_mock = True

            summary.append((table, len(rows), wrote_mock))
            print(f"  [OK] {table:<28} rows={len(rows):<6} mock={'yes' if wrote_mock else 'no '}")

    # 3) 入口文件
    for dialect, meta in dialects.items():
        entry = build_entry_sql(dialect, exported_order, generated_at)
        out = meta["dir"] / meta["entry"]
        out.write_text(entry, encoding="utf-8")
        generated_files.append(out)

    # 仓库模式：写盘前敏感扫描（生成文件可能含测试库内容）
    if args.allow_repository_output:
        blockers = _run_safety_scan(generated_files)
        if blockers:
            print("\n❌ Repository Public Data Guard 发现 BLOCKER 级别内容，已中止提交：")
            for item in blockers:
                print(f"   {item}")
            return 3
        print("\n✅ Repository Public Data Guard：仓库输出无 BLOCKER 级别发现。")

    # 汇总
    total_rows = sum(r for _, r, _ in summary)
    print("\n汇总：")
    print(f"  导出表数 : {len(summary)}")
    print(f"  总行数   : {total_rows}")
    print(f"  生成 mock: {sum(1 for _, _, m in summary if m)} 张")
    if skipped:
        print(f"  跳过(skip): {', '.join(skipped)}")
    out_dir = dialects["pg"]["dir"]
    print(f"  输出目录 : {out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
