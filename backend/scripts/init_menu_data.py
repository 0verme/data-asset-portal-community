#!/usr/bin/env python3
"""Idempotently initialize the portal menu rows for a named database profile."""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

MENUS = [
    (1, "upstream", "上游卸数", "download", "/upstream", 10, "N", "Y", "上游卸数系统列表与维护"),
    (2, "dwm", "数据仓库", "db", "/data-warehouse", 20, "N", "Y", "DWM 表资产、字段与 DDL"),
    (3, "mapping", "字段映射", "link", "/field-mapping", 30, "N", "Y", "字段与表的映射关系查询"),
    (10, "lineage", "血缘分析", "layers", "/lineage", 35, "N", "Y", "任务与数据表的上下游血缘排查"),
    (4, "root", "词根管理", "book", "/root-management", 40, "N", "Y", "词根、分类与批量导入"),
    (5, "indicator", "指标维护", "hash", "/indicator-maintenance", 50, "N", "Y", "指标列表、详情与启停"),
    (6, "report", "报表资产", "file", "/report-assets", 55, "N", "Y", "报表元数据台账、归属信息与关联引用"),
    (9, "apiAsset", "API 资产", "api", "/api-assets", 58, "N", "Y", "API 元数据台账、参数、响应字段与关联资产维护"),
    (7, "push", "下游推送", "upload", "/push", 60, "N", "Y", "下游推送系统、作业与字段"),
    (8, "system", "系统管理", "shield", "/system-management", 70, "Y", "Y", "用户、菜单、参数字典与操作日志（仅管理员可见）"),
]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile", default=os.getenv("ASSET_DB_PROFILE", "primary"))
    parser.add_argument("--config", help="database profile YAML path")
    args = parser.parse_args()
    if args.config:
        os.environ["ASSET_DB_CONFIG_PATH"] = args.config

    from app.db.gaussdb import connect_with_profile

    conn = connect_with_profile(args.profile)
    try:
        cur = conn.cursor()
        cur.execute("CREATE SCHEMA IF NOT EXISTS dwp")
        cur.execute(
            """CREATE TABLE IF NOT EXISTS dwp.p_menu (
                menu_id BIGINT NOT NULL, menu_code VARCHAR(64) NOT NULL,
                menu_name VARCHAR(128) NOT NULL, menu_icon VARCHAR(64) NOT NULL DEFAULT 'grid',
                menu_path VARCHAR(256), display_order INTEGER NOT NULL DEFAULT 0,
                admin_only CHAR(1) NOT NULL DEFAULT 'N', is_active CHAR(1) NOT NULL DEFAULT 'Y',
                menu_desc VARCHAR(512), remark VARCHAR(1000), created_by VARCHAR(64) NOT NULL DEFAULT 'system',
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_by VARCHAR(64) NOT NULL DEFAULT 'system', updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            )"""
        )
        cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_p_menu_uk_01 ON dwp.p_menu (menu_code)")
        for row in MENUS:
            cur.execute(
                """INSERT INTO dwp.p_menu
                (menu_id, menu_code, menu_name, menu_icon, menu_path, display_order, admin_only, is_active, menu_desc, remark)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, '系统初始化')
                ON CONFLICT (menu_code) DO UPDATE SET
                    menu_id = EXCLUDED.menu_id, menu_name = EXCLUDED.menu_name,
                    menu_icon = EXCLUDED.menu_icon, menu_path = EXCLUDED.menu_path,
                    display_order = EXCLUDED.display_order, admin_only = EXCLUDED.admin_only,
                    is_active = EXCLUDED.is_active, menu_desc = EXCLUDED.menu_desc,
                    updated_by = 'system', updated_at = CURRENT_TIMESTAMP""",
                row,
            )
        conn.commit()
        cur.execute("SELECT menu_id, menu_code, menu_name, display_order, is_active FROM dwp.p_menu ORDER BY display_order, menu_id")
        rows = cur.fetchall()
        print(f"initialized={len(MENUS)} total={len(rows)}")
        for item in rows:
            print("\t".join(str(value) for value in item))
        return 0
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
