#!/usr/bin/env python3
"""Shared repository demo seed loader.

Every demo seed (SQLite / PostgreSQL / DWS) draws from the same fictional
retail datasets and plans rows for every repository module using the canonical
migration schema. External execution remains metadata-only and fictional.

``backend/schema`` is the schema source of truth: the columns planned here
match the baseline SQL exactly (e.g. ``p_asset_domain`` keys on
``domain_code``, not ``domain_id``).
"""

from __future__ import annotations

import json
from pathlib import Path

DATASETS_DIR = Path(__file__).resolve().parent / "datasets"

# Keep demo push rows inside the backend PUSH_AUTH_TYPE contract. The legacy
# value is retained only so seeders can repair databases created by older
# Community releases.
DEMO_PUSH_AUTH_TYPE = "密钥认证"
LEGACY_DEMO_PUSH_AUTH_TYPE = "演示占位配置"

# Canonical asset domain codes (baseline: p_asset_domain.domain_code PK).
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

# Repository module menus (menu_id values match the existing full DDL).
# portal has no menu row: it is the fixed landing page.
DEMO_MENUS = [
    (1, "upstream", "上游卸数", "download", "/upstream", 10, "primary", "N", "Y", "上游卸数系统列表与维护"),
    (2, "dwm", "数据仓库", "db", "/data-warehouse", 20, "primary", "N", "Y", "DWM 表资产、字段与 DDL"),
    (3, "mapping", "字段映射", "link", "/field-mapping", 30, "primary", "N", "Y", "字段与表的映射关系查询"),
    (10, "lineage", "血缘分析", "layers", "/lineage", 35, "primary", "N", "Y", "任务与数据表的上下游血缘排查"),
    (4, "root", "词根管理", "book", "/root-management", 40, "more", "N", "Y", "词根、分类与批量导入"),
    (5, "indicator", "指标维护", "hash", "/indicator-maintenance", 50, "primary", "N", "Y", "指标列表、详情与启停"),
    (6, "report", "报表资产", "file", "/report-assets", 55, "more", "N", "Y", "报表元数据台账、归属信息与关联引用"),
    (9, "apiAsset", "API 资产", "api", "/api-assets", 58, "more", "N", "Y", "API 元数据台账、参数、响应字段与关联资产维护"),
    (7, "push", "下游推送", "upload", "/push", 60, "more", "N", "Y", "下游推送系统、作业与字段"),
    (11, "codeTable", "码值表维护", "table", "/code-table-maintenance", 65, "more", "N", "Y", "湖仓手工码值表的表级元数据登记与维护"),
    (8, "system", "系统管理", "shield", "/system-management", 70, "more", "Y", "Y", "用户、菜单、参数字典与操作日志（仅管理员可见）"),
]


def load_dataset(name: str) -> list[dict]:
    path = DATASETS_DIR / name
    return __import__("json").loads(path.read_text(encoding="utf-8"))


def demo_push_system_codes() -> tuple[str, ...]:
    """Return the exact push-system codes owned by the Community demo."""
    return tuple(item["code"] for item in load_dataset("push_systems.json"))


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
                mapping["id"], mapping["dataSourceId"], mapping["upstreamSystemId"],
                mapping["sourceTable"], mapping["sourceTableName"], mapping["targetLayer"],
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

    # Field plan keyed by table name; field ids are stable so re-seeding is
    # deterministic and idempotent (INSERT OR IGNORE on p_asset_field.field_id).
    field_plan = load_dataset("fields.json")
    asset_id_by_table = {item["table"]: index for index, item in enumerate(assets, start=1)}
    field_counts = {spec_item["table"]: len(spec_item["fields"]) for spec_item in field_plan}
    asset_field_rows = []
    field_id_by_asset_and_name = {}
    field_id = 1
    for spec_item in field_plan:
        asset_id = asset_id_by_table[spec_item["table"]]
        for order, field in enumerate(spec_item["fields"], start=1):
            field_id_by_asset_and_name[(spec_item["table"], field["name"])] = field_id
            asset_field_rows.append(
                (
                    field_id, asset_id, field["name"], field["cn"], field["type"],
                    order,
                    "Y" if field.get("nullable") else "N",
                    "Y" if field.get("pk") else "N",
                    "Y" if field.get("part") else "N",
                    field.get("enum"),
                    field.get("desc"),
                )
            )
            field_id += 1

    def _cycle_desc(table_name, layer_code):
        if "_DI" in table_name:
            return "每日增量"
        if "_DD" in table_name:
            return "每日全量"
        return "每日汇总" if layer_code == "DWS" else "每日"

    grain_by_layer = {
        "DWD": "一行一条虚构业务明细记录",
        "DWM": "一行一个虚构业务维度组合",
        "DWS": "一行一个虚构统计维度组合",
    }

    asset_tables = [
        (
            index, item["table"], item["name"], f"DWS_{item['layer']}",
            item["layer"], DOMAIN_CODE_BY_NAME[item["domain"]],
            "演示数据维护组", grain_by_layer.get(item["layer"], "虚构演示数据"),
            _cycle_desc(item["table"], item["layer"]),
            item.get("desc"),
            field_counts.get(item["table"], 0),
        )
        for index, item in enumerate(assets, start=1)
    ]

    code_categories = load_dataset("common_codes.json")
    code_category_rows = [
        (
            index, category["categoryCode"], category["categoryName"],
            category.get("categoryDesc"), index, "Y",
        )
        for index, category in enumerate(code_categories, start=1)
    ]
    code_item_rows = []
    code_item_id = 1
    for category in code_categories:
        for order, item in enumerate(category.get("items", []), start=1):
            code_item_rows.append(
                (
                    code_item_id, category["categoryCode"], item["code"],
                    item["name"], item.get("value"), item.get("desc"),
                    order, "Y",
                )
            )
            code_item_id += 1

    indicator_paths = load_dataset("indicator_paths.json")
    indicator_path_rows = [
        (
            path["id"], path.get("parentId"), path["pathCode"], path["pathName"],
            path["dimensionCode"], path["pathLevel"], path["fullPath"],
            path.get("sortOrder", 0), path.get("status", "enabled"),
            path.get("remark"),
        )
        for path in indicator_paths
    ]

    root_items = [
        (index, item["code"], item["code"].lower(), item["name"], "零售标准词根")
        for index, item in enumerate(load_dataset("roots.json"), start=1)
    ]
    indicator_items = [
        (
            index, item["code"], item["name"], "完全虚构的零售演示指标",
            item["table"], item["field"], asset_id_by_table[item["table"]],
            field_id_by_asset_and_name.get((item["table"], item["field"])), None,
            "candidate", item["code"][:3].lower(),
            item.get("caliber", ""), item.get("pathDesc", ""),
            "enabled", "演示数据维护组", "2026-07-01",
        )
        for index, item in enumerate(load_dataset("indicators.json"), start=1)
    ]

    upstream_specs = [
        (1, "up_member", "MEM", "会员中心", "PostgreSQL", "会员运营部"),
        (2, "up_product", "PIM", "商品中心", "MySQL", "商品运营部"),
        (3, "up_order", "OMS", "订单中心", "PostgreSQL", "交易运营部"),
        (4, "up_pos", "POS", "门店 POS", "SQL Server", "门店运营部"),
        (5, "up_inventory", "IMS", "库存中心", "Oracle", "供应链部"),
        (6, "up_marketing", "MKT", "营销平台", "MongoDB", "市场营销部"),
        (7, "up_fulfillment", "FUL", "履约平台", "Kafka", "履约运营部"),
        (8, "up_service", "SVC", "售后中心", "Object Storage", "客户服务部"),
    ]
    upstream_system_rows = []
    upstream_unload_rows = []
    upstream_change_rows = []
    for source_id, system_id, abbr, name, db_type, dept in upstream_specs:
        status = sources[source_id - 1][-1]
        upstream_system_rows.append(
            (
                source_id, source_id, system_id, abbr, name, db_type,
                f"{abbr.lower()}.demo.invalid", f"DEMO_{abbr}",
                f"DEMO_{abbr}_OWNER", status, "演示数据维护组", dept,
                f"{name}，仅用于完全虚构的零售演示。", 4, "N", "demo",
                "2026-07-12 01:00:00", "demo", "2026-07-12 01:00:00",
            )
        )
        times = ["00:15", "00:30", "00:45"] if source_id == 7 else ["01:00", "07:00", "13:00", "19:00"]
        for order, value in enumerate(times, start=1):
            upstream_unload_rows.append(
                (source_id * 10 + order, source_id, value, order, "N", "demo", "2026-07-12 01:00:00", "demo", "2026-07-12 01:00:00")
            )
        upstream_change_rows.append(
            (
                source_id, source_id, system_id, "SEED", "创建虚构演示上游系统", None,
                json.dumps({"id": system_id, "status": status}, ensure_ascii=False),
                "demo", "2026-07-12 01:00:00",
            )
        )

    push_system_rows = []
    push_job_rows = []
    push_field_rows = []
    push_change_rows = []
    for item in load_dataset("push_systems.json"):
        # pi-lens-ignore: unchecked-throwing-call-python
        system_id = int(item["id"])
        code = item["code"]
        abbr = code.removeprefix("DEMO_")
        table_name = f"DWM_{abbr.lower()}_stat_1d"
        job_id = system_id * 10
        job_code = f"JOB_{abbr}_{system_id:02d}"
        push_system_rows.append(
            (
                system_id, system_id, code, item["name"], abbr, item["protocol"],
                f"{abbr.lower()}.consumer.demo.invalid", 443 if item["protocol"] == "HTTP" else 9000,
                "DEMO_ONLY", DEMO_PUSH_AUTH_TYPE, "演示业务维护组", "演示数据维护组",
                item["department"], f"{item['name']}消费完全虚构的零售主题数据。",
                item["status"], "normal", None, 1, "N", "demo",
                "2026-07-12 02:00:00", "demo", "2026-07-12 02:00:00",
            )
        )
        push_job_rows.append(
            (
                job_id, system_id, job_code, f"{item['name']}每日推送",
                f"/demo/dwm/{table_name}/dt={{yyyy-MM-dd}}", f"{table_name}_{{yyyyMMdd}}.json",
                f"/demo/incoming/{abbr.lower()}/", f"{table_name}_{{yyyyMMdd}}.json",
                "", "T+1", ",", "UTF-8", "约 1 万行", "Y" if item["status"] == "enabled" else "N",
                "完全虚构的演示推送作业", 3, "N", "demo", "2026-07-12 02:00:00", "demo", "2026-07-12 02:00:00",
            )
        )
        for field_order, field_name in enumerate(("record_id", "business_date", "metric_value"), start=1):
            push_field_rows.append(
                (
                    job_id * 10 + field_order, job_id, field_name, field_name.replace("_", " "),
                    field_order, "DWM", "decimal(18,2)" if field_name == "metric_value" else "string",
                    f"演示字段 {field_name}", "N", "demo", "2026-07-12 02:00:00", "demo", "2026-07-12 02:00:00",
                )
            )
        push_change_rows.append(
            (
                system_id, system_id, job_id, "JOB", job_code, "SEED",
                "创建虚构演示推送作业", None, json.dumps({"jobCode": job_code}, ensure_ascii=False),
                "demo", "2026-07-12 02:00:00", f"demo-push-{system_id}",
            )
        )

    report_rows = []
    for item in load_dataset("reports.json"):
        related_tables = [
            {**related, "tableName": str(related.get("tableName") or "").upper()}
            for related in item.get("relatedTables", [])
        ]
        report_rows.append(
            (
                item["id"], item["code"], item["name"], item.get("alias", ""), item["type"],
                item.get("domain", ""), item.get("freq", ""), item.get("statPeriod", ""),
                item.get("dateCaliber", ""), item.get("dateCaliberOther", ""),
                item.get("dataTimeliness", ""), item.get("dataTimelinessCustom", ""), item["status"],
                item.get("effectiveDate", ""), item.get("expireDate", ""), item.get("purpose", ""),
                item.get("statObject", ""), item.get("statScope", ""), item.get("timeCaliber", ""),
                item.get("filterCondition", ""), item.get("specialRule", ""), item.get("ownerDept", ""),
                item.get("ownerName", ""), item.get("maintainerName", ""),
                json.dumps(related_tables, ensure_ascii=False),
                json.dumps(item.get("relatedIndicators", []), ensure_ascii=False), item.get("remark", ""),
                "N", "demo", item.get("updatedAt", "2026-07-12 03:00:00"), "demo", item.get("updatedAt", "2026-07-12 03:00:00"),
            )
        )

    manual_code_table_rows = [
        (1, "ORDER_STATUS", "订单状态", "status", "演示业务维护组", "enabled", "完全虚构的订单状态码值。", "demo", "2026-07-12 03:00:00", "demo", "2026-07-12 03:00:00"),
        (2, "CHANNEL_TYPE", "渠道类型", "enum", "演示业务维护组", "enabled", "完全虚构的零售渠道码值。", "demo", "2026-07-12 03:00:00", "demo", "2026-07-12 03:00:00"),
        (3, "DELIVERY_MODE", "履约方式", "map", "演示业务维护组", "disabled", "完全虚构的配送方式映射。", "demo", "2026-07-12 03:00:00", "demo", "2026-07-12 03:00:00"),
    ]

    lineage_snapshot_id = "demo-lineage-20260712-001"
    lineage_generated_at = "2026-07-12 04:00:00"
    lineage_edges_source = load_dataset("lineage.json")
    lineage_nodes = {}
    kind_by_type = {"indicator": "indicator", "report": "report", "push": "push_job"}
    for relation in lineage_edges_source:
        for value in (relation["source"], relation["target"]):
            if value in lineage_nodes:
                continue
            kind = kind_by_type.get(relation["type"], "table")
            namespace = kind
            lineage_nodes[value] = (
                lineage_snapshot_id, value, kind, value, value, namespace,
                json.dumps({"source": "fictional_demo_dataset"}, ensure_ascii=False),
            )
    lineage_node_rows = list(lineage_nodes.values())
    lineage_edge_rows = [
        (
            lineage_snapshot_id, f"demo-lineage-edge-{index}", relation["source"], relation["target"],
            relation["type"], "demo_dataset", f"demo-lineage-{index}",
            "完全虚构的演示血缘关系", "medium", lineage_generated_at, "[]",
        )
        for index, relation in enumerate(lineage_edges_source, start=1)
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
                for menu in DEMO_MENUS
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
                "cycle_desc", "table_desc", "field_count",
            ),
            asset_tables,
        ),
        "p_asset_field": spec(
            (
                "field_id", "asset_id", "field_name", "field_cn_name",
                "data_type", "field_order", "nullable_flag", "pk_flag",
                "partition_flag", "enum_desc", "field_desc",
            ),
            asset_field_rows,
        ),
        "p_code_category": spec(
            (
                "category_id", "category_code", "category_name",
                "category_desc", "display_order", "is_active",
            ),
            code_category_rows,
        ),
        "p_code_item": spec(
            (
                "item_id", "category_code", "item_code", "item_name",
                "item_value", "item_desc", "display_order", "is_active",
            ),
            code_item_rows,
        ),
        "p_indicator_path_config": spec(
            (
                "id", "parent_id", "path_code", "path_name", "dimension_code",
                "path_level", "full_path", "sort_order", "status", "remark",
            ),
            indicator_path_rows,
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
                "result_table_name", "result_field_name", "source_asset_id", "result_field_id",
                "aggregation_code", "semantic_state", "dimension_code", "caliber_desc", "path_desc",
                "status_code", "registrar_name", "registered_date",
            ),
            indicator_items,
        ),
        "p_upstream_system": spec(
            (
                "system_pk", "data_source_id", "system_id", "system_abbr", "system_name",
                "db_type", "host_name", "db_name", "schema_name", "status_code",
                "owner_name", "dept_name", "system_desc", "unload_count", "is_deleted",
                "created_by", "created_at", "updated_by", "updated_at",
            ),
            upstream_system_rows,
        ),
        "p_upstream_unload_time": spec(
            (
                "time_pk", "system_pk", "unload_time", "display_order", "is_deleted",
                "created_by", "created_at", "updated_by", "updated_at",
            ),
            upstream_unload_rows,
        ),
        "p_upstream_change_log": spec(
            (
                "change_id", "system_pk", "system_id", "change_type", "change_summary",
                "before_json", "after_json", "operator_name", "change_time",
            ),
            upstream_change_rows,
        ),
        # Mapping rows depend on the upstream-system primary key, so seed them
        # only after the upstream entity has been inserted.
        "p_field_mapping_table": spec(
            (
                "table_pk", "data_source_id", "upstream_system_id", "source_table_name",
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
        "p_push_system": spec(
            (
                "system_id", "master_system_id", "system_code", "system_name", "system_abbr", "protocol_type",
                "host_name", "port_no", "account_name", "auth_type", "contact_name",
                "data_developer_contact_name", "dept_name", "system_desc", "status_code",
                "importance_level_code", "latest_output_time", "job_count", "is_deleted",
                "created_by", "created_at", "updated_by", "updated_at",
            ),
            push_system_rows,
        ),
        "p_push_job": spec(
            (
                "job_id", "system_id", "job_code", "job_name", "source_path",
                "source_file_name", "target_path", "target_file_name", "freq_desc", "freq_type",
                "delimiter_code", "encoding_type", "row_count_desc", "enabled_flag", "job_desc",
                "field_count", "is_deleted", "created_by", "created_at", "updated_by", "updated_at",
            ),
            push_job_rows,
        ),
        "p_push_job_field": spec(
            (
                "field_id", "job_id", "field_name", "field_cn_name", "field_order", "source_code",
                "data_type", "field_meaning", "is_deleted", "created_by", "created_at", "updated_by", "updated_at",
            ),
            push_field_rows,
        ),
        "p_push_change_log": spec(
            (
                "change_id", "system_id", "job_id", "object_type", "object_code", "change_type",
                "change_summary", "before_json", "after_json", "operator_name", "change_time", "trace_id",
            ),
            push_change_rows,
        ),
        "p_report_asset": spec(
            (
                "report_pk", "report_code", "report_name", "report_alias", "report_type", "domain_name",
                "freq_code", "stat_period_code", "date_caliber_code", "date_caliber_other_desc",
                "data_timeliness_code", "data_timeliness_custom_desc", "status_code", "effective_date",
                "expire_date", "purpose_desc", "stat_object_desc", "stat_scope_desc", "time_caliber_desc",
                "filter_condition_desc", "special_rule_desc", "owner_dept_name", "owner_name", "maintainer_name",
                "related_tables_json", "related_indicators_json", "remark_desc", "is_deleted", "created_by",
                "created_at", "updated_by", "updated_at",
            ),
            report_rows,
        ),
        "p_manual_code_table": spec(
            (
                "table_id", "table_code", "table_name", "table_style", "owner_name", "status_code",
                "remark", "created_by", "created_at", "updated_by", "updated_at",
            ),
            manual_code_table_rows,
        ),
        "p_lineage_snapshot": spec(
            ("snapshot_id", "generated_at", "generator_name", "generator_version", "import_batch_id", "status_code"),
            [(lineage_snapshot_id, lineage_generated_at, "demo-seed", "1.0", lineage_snapshot_id, "ACTIVE")],
        ),
        "p_lineage_node": spec(
            ("snapshot_id", "node_id", "kind_code", "node_name", "display_name", "namespace_name", "attributes_json"),
            lineage_node_rows,
        ),
        "p_lineage_edge": spec(
            (
                "snapshot_id", "edge_id", "source_node_id", "target_node_id", "kind_code", "evidence_type",
                "source_record_id", "evidence_description", "confidence_code", "generated_at", "diagnostics_json",
            ),
            lineage_edge_rows,
        ),
    }


def rbac_seed_plan() -> dict[str, dict]:
    """Return deterministic RBAC seed rows for PostgreSQL/DWS demo SQL."""
    from backend.app.authorization import (
        BUILTIN_ROLE_PERMISSION_CODES,
        PERMISSION_CODES,
        PERMISSION_DEFINITIONS,
    )

    def spec(columns, rows):
        return {"columns": list(columns), "rows": [list(row) for row in rows]}

    roles = [
        ("admin", "系统管理员", "Community 内置系统管理员角色。", "Y", "Y"),
        ("maintainer", "业务维护员", "兼容现有业务资产维护和操作日志读取能力。", "Y", "Y"),
    ]
    permissions = [
        (item.code, item.resource, item.action, item.name, item.description)
        for item in PERMISSION_DEFINITIONS
    ]
    mappings = [
        (role_code, permission_code)
        for role_code in ("admin", "maintainer")
        for permission_code in PERMISSION_CODES
        if permission_code in BUILTIN_ROLE_PERMISSION_CODES[role_code]
    ]
    return {
        "p_role": spec(
            ("role_code", "name", "description", "builtin", "enabled"),
            roles,
        ),
        "p_permission": spec(
            ("permission_code", "resource", "action", "name", "description"),
            permissions,
        ),
        "p_role_permission": spec(
            ("role_code", "permission_code"),
            mappings,
        ),
    }
