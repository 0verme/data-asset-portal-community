#!/usr/bin/env python3
"""Shared Community demo seed loader.

Every Community demo seed (SQLite / PostgreSQL / DWS) draws from the same
fictional retail datasets in ``demo/datasets/`` and plans rows only for
Community-owned tables using the canonical migration schema.

``backend/migrations`` is the schema source of truth: the columns planned here
match the manifest SQL exactly (e.g. ``p_asset_domain`` keys on
``domain_code``, not ``domain_id``). Private module tables (push / report /
upstream / codeTable) are intentionally excluded from the Community plan.
"""

from __future__ import annotations

from pathlib import Path

DATASETS_DIR = Path(__file__).resolve().parent / "datasets"

# Canonical asset domain codes (migration 0005: p_asset_domain.domain_code PK).
DOMAIN_CODE_BY_NAME = {
    "商品": "PRODUCT",
    "会员": "MEMBER",
    "交易": "TRADE",
    "门店": "STORE",
    "库存": "INVENTORY",
    "营销": "MARKETING",
    "履约": "FULFILLMENT",
    "售后": "SERVICE",
}

# Community demo admin account. Seed scripts hash the password themselves.
ADMIN_USER = {
    "id": 1,
    "username": "community_demo",
    "password": "demo-change-me",
    "display_name": "演示管理员",
    "role": "admin",
    "status": "ACTIVE",
}

# Community module menus (menu_id values match the full-edition docs DDL so a
# later full upgrade stays consistent). portal has no menu row: it is the
# fixed landing page.
COMMUNITY_MENUS = [
    (2, "dwm", "数据仓库", "db", "/data-warehouse", 20, "primary", "N", "Y", "DWM 表资产、字段与 DDL"),
    (3, "mapping", "字段映射", "link", "/field-mapping", 30, "primary", "N", "Y", "字段与表的映射关系查询"),
    (10, "lineage", "血缘分析", "layers", "/lineage", 35, "primary", "N", "Y", "任务与数据表的上下游血缘排查"),
    (4, "root", "词根管理", "book", "/root-management", 40, "more", "N", "Y", "词根、分类与批量导入"),
    (5, "indicator", "指标维护", "hash", "/indicator-maintenance", 50, "primary", "N", "Y", "指标列表、详情与启停"),
    (9, "apiAsset", "API 资产", "api", "/api-assets", 58, "more", "N", "Y", "API 元数据台账、参数、响应字段与关联资产维护"),
    (8, "system", "系统管理", "shield", "/system-management", 70, "more", "Y", "Y", "用户、菜单、参数字典与操作日志（仅管理员可见）"),
]


def load_dataset(name: str) -> list[dict]:
    path = DATASETS_DIR / name
    return __import__("json").loads(path.read_text(encoding="utf-8"))


def community_seed_plan() -> dict[str, dict]:
    """Return canonical Community seed rows keyed by table name.

    Each value is ``{"columns": [...], "rows": [[...], ...]}``; rows are
    ordered exactly like columns so dialect seeders can emit parameterized or
    literal SQL without their own business mapping.
    """

    def spec(columns, rows):
        return {"columns": list(columns), "rows": [list(row) for row in rows]}

    systems = [
        (
            item["id"], item["code"], item["name"], item["shortName"],
            item["description"], item["type"], item["department"], item["status"],
        )
        for item in load_dataset("systems.json")
    ]
    sources = [
        (
            item["id"], item["code"], item["name"], item["type"],
            item["description"], item["status"],
        )
        for item in load_dataset("data_sources.json")
    ]
    api_assets = [
        (
            item["id"], item["code"], item["name"], item["method"], item["path"],
            item["version"], item["systemId"], item["type"], item["status"],
            item["ownerDepartment"], item["owner"], item["description"],
        )
        for item in load_dataset("api_assets.json")
    ]

    mapping_tables = []
    mapping_fields = []
    for mapping in load_dataset("mappings.json"):
        mapping_tables.append(
            (
                mapping["id"], mapping["dataSourceId"], mapping["sourceTable"],
                mapping["sourceTableName"], mapping["targetLayer"],
                mapping["targetTable"], mapping["loadMode"],
                len(mapping["fields"]), len(mapping["fields"]),
            )
        )
        for field in mapping["fields"]:
            mapping_fields.append(
                (
                    field["id"], mapping["id"], field["source"], field["type"],
                    field["comment"], field["target"], field["rule"], field["order"],
                )
            )

    assets = load_dataset("assets.json")
    # Canonical p_asset_domain: domain_code is the primary key (no domain_id).
    domains = []
    seen_domains = set()
    for item in assets:
        name = item["domain"]
        if name in seen_domains:
            continue
        seen_domains.add(name)
        domains.append(
            (DOMAIN_CODE_BY_NAME[name], name, len(domains) + 1, "Y", "N")
        )
    # Canonical p_asset_layer: layer_code is the primary key (no layer_id).
    layers = []
    seen_layers = set()
    for item in assets:
        code = item["layer"]
        if code in seen_layers:
            continue
        seen_layers.add(code)
        layers.append((code, code, len(layers) + 1, "Y", "N"))

    asset_tables = [
        (
            index, item["table"], item["name"], f"DWS_{item['layer']}",
            item["layer"], DOMAIN_CODE_BY_NAME[item["domain"]],
            "演示数据维护组", "按虚构业务标识", "每日", 0,
        )
        for index, item in enumerate(assets, start=1)
    ]

    root_items = [
        (index, item["code"], item["code"].lower(), item["name"], "零售标准词根")
        for index, item in enumerate(load_dataset("roots.json"), start=1)
    ]
    indicator_items = [
        (
            index, item["code"], item["name"], "完全虚构的零售演示指标",
            item["table"], item["field"], item["code"][:3].lower(),
            "enabled", "演示数据维护组", "2026-07-01",
        )
        for index, item in enumerate(load_dataset("indicators.json"), start=1)
    ]

    return {
        "p_menu": spec(
            (
                "menu_id", "menu_code", "menu_name", "menu_icon", "menu_path",
                "display_order", "nav_placement", "admin_only", "is_active",
                "menu_desc", "remark",
            ),
            [
                (*menu, "系统初始化")
                for menu in COMMUNITY_MENUS
            ],
        ),
        "p_system": spec(
            (
                "system_id", "system_code", "system_name", "system_abbr",
                "description_text", "system_type", "department_name", "status_code",
            ),
            systems,
        ),
        "p_data_source": spec(
            (
                "source_id", "source_code", "source_name", "source_type",
                "description_text", "status_code",
            ),
            sources,
        ),
        "p_api_asset": spec(
            (
                "api_pk", "api_code", "api_name", "method_code", "path_text",
                "version_text", "system_id", "api_type", "status_code",
                "owner_dept_name", "owner_name", "description_text",
            ),
            api_assets,
        ),
        "p_field_mapping_table": spec(
            (
                "table_pk", "data_source_id", "source_table_name",
                "source_table_cn", "target_layer_code", "target_table_name",
                "load_mode", "field_total_count", "mapped_field_count",
            ),
            mapping_tables,
        ),
        "p_field_mapping_field": spec(
            (
                "field_pk", "table_pk", "source_field_name", "source_field_type",
                "source_field_comment", "target_field_name", "mapping_rule",
                "field_order",
            ),
            mapping_fields,
        ),
        "p_asset_domain": spec(
            ("domain_code", "domain_name", "display_order", "is_active", "is_deleted"),
            domains,
        ),
        "p_asset_layer": spec(
            ("layer_code", "layer_name", "display_order", "is_active", "is_deleted"),
            layers,
        ),
        "p_asset_table": spec(
            (
                "asset_id", "table_name", "table_cn_name", "schema_name",
                "layer_code", "domain_code", "owner_name", "grain_desc",
                "cycle_desc", "field_count",
            ),
            asset_tables,
        ),
        "p_root_category": spec(
            ("category_id", "category_name", "display_order"),
            [(1, "零售标准词根", 1)],
        ),
        "p_root_item": spec(
            ("root_id", "root_abbr", "root_en_name", "root_cn_name", "category_name"),
            root_items,
        ),
        "p_indicator_item": spec(
            (
                "indicator_pk", "indicator_id", "indicator_name", "meaning_desc",
                "result_table_name", "result_field_name", "dimension_code",
                "status_code", "registrar_name", "registered_date",
            ),
            indicator_items,
        ),
    }
