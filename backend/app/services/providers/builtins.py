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

"""Built-in portal search entities and stat cards.

Each module contributes independent configs via the registry. Adding a module
means registering here (or from another import side-effect) — not editing the
search/portal engines.
"""

from __future__ import annotations

from typing import Any

from .registry import register_portal_stat, register_search_entity


def _join_meta(*parts: Any) -> str:
    return " / ".join(str(part) for part in parts if part)


def _build_asset(row: dict[str, Any], matched_fields: list[dict[str, str]]) -> dict[str, Any]:
    return {
        "id": row.get("table_name"),
        "title": row.get("table_name") or "",
        "subtitle": row.get("table_cn_name") or "",
        "meta": _join_meta(row.get("domain_name"), row.get("layer_code"), row.get("owner_name")),
        "ref": row.get("table_name"),
        "matchedFields": matched_fields,
    }


def _build_system(row: dict[str, Any], matched_fields: list[dict[str, str]]) -> dict[str, Any]:
    return {
        "id": row.get("system_id"),
        "title": row.get("system_abbr") or row.get("system_name") or "",
        "subtitle": row.get("system_name") or "",
        "meta": row.get("owner_name") or "",
        "ref": row.get("system_id"),
        "matchedFields": matched_fields,
    }


def _build_field(row: dict[str, Any], matched_fields: list[dict[str, str]]) -> dict[str, Any]:
    return {
        "id": f"{row.get('table_name')}.{row.get('field_name')}",
        "title": row.get("field_name") or "",
        "subtitle": row.get("field_cn_name") or "",
        "meta": row.get("table_name") or "",
        "ref": row.get("table_name"),
        "matchedFields": matched_fields,
    }


def _build_root(row: dict[str, Any], matched_fields: list[dict[str, str]]) -> dict[str, Any]:
    return {
        "id": row.get("root_abbr"),
        "title": row.get("root_abbr") or "",
        "subtitle": row.get("root_cn_name") or row.get("root_en_name") or "",
        "meta": row.get("category_name") or "",
        "ref": row.get("root_abbr"),
        "matchedFields": matched_fields,
    }


def _build_indicator(row: dict[str, Any], matched_fields: list[dict[str, str]]) -> dict[str, Any]:
    return {
        "id": row.get("indicator_id"),
        "title": row.get("indicator_id") or "",
        "subtitle": row.get("indicator_name") or "",
        "meta": row.get("meaning_desc") or "",
        "ref": row.get("indicator_id"),
        "matchedFields": matched_fields,
    }


def _build_downstream(row: dict[str, Any], matched_fields: list[dict[str, str]]) -> dict[str, Any]:
    source_file_name = row.get("source_file_name") or ""
    target_file_name = row.get("target_file_name") or ""
    job_code = row.get("job_code") or ""
    system_code = row.get("system_code") or ""
    return {
        "id": f"{system_code}.{job_code or 'system'}",
        "title": row.get("job_name") or job_code or row.get("system_name") or system_code or "",
        "subtitle": row.get("system_name") or row.get("system_code") or "",
        "meta": _join_meta(source_file_name, target_file_name) or (row.get("job_desc") or ""),
        "ref": {
            "systemId": system_code,
            "jobId": job_code or None,
        },
        "matchedFields": matched_fields,
    }


def _build_report(row: dict[str, Any], matched_fields: list[dict[str, str]]) -> dict[str, Any]:
    return {
        "id": row.get("report_code"),
        "title": row.get("report_code") or "",
        "subtitle": row.get("report_name") or row.get("report_alias") or "",
        "meta": _join_meta(row.get("report_type"), row.get("owner_dept_name"), row.get("owner_name")),
        "ref": row.get("report_code"),
        "matchedFields": matched_fields,
    }


def _build_api(row: dict[str, Any], matched_fields: list[dict[str, str]]) -> dict[str, Any]:
    return {
        "id": row.get("api_code"),
        "title": row.get("api_code") or "",
        "subtitle": row.get("api_name") or "",
        "meta": _join_meta(row.get("method_code"), row.get("path_text"), row.get("owner_name")),
        "ref": row.get("api_code"),
        "matchedFields": matched_fields,
    }


def _build_code_table(row: dict[str, Any], matched_fields: list[dict[str, str]]) -> dict[str, Any]:
    return {
        "id": row.get("table_code"),
        "title": row.get("table_code") or "",
        "subtitle": row.get("table_name") or "",
        "meta": _join_meta(row.get("table_style"), row.get("owner_name")),
        "ref": row.get("table_code"),
        "matchedFields": matched_fields,
    }


# --- Search entities (order = default result group order) -------------------

register_search_entity({
    "type": "asset",
    "label": "资产",
    "module": "dwm",
    "from": (
        "dwp.p_asset_table t "
        "LEFT JOIN dwp.p_asset_domain d ON t.domain_code = d.domain_code"
    ),
    "base_where": "t.is_deleted = 'N'",
    "matchers": [
        {"expr": "t.table_name", "label": "资产表"},
        {"expr": "t.table_cn_name", "label": "资产中文名"},
        {"expr": "d.domain_name", "label": "主题域"},
        {"expr": "t.domain_code", "label": "主题域编码"},
        {"expr": "t.schema_name", "label": "Schema"},
        {"expr": "t.layer_code", "label": "分层"},
        {"expr": "t.owner_name", "label": "负责人"},
        {"expr": "t.grain_desc", "label": "粒度"},
        {"expr": "t.cycle_desc", "label": "周期"},
        {"expr": "t.table_desc", "label": "描述"},
    ],
    "select": (
        "t.table_name, "
        "t.table_cn_name, "
        "t.layer_code, "
        "COALESCE(d.domain_name, t.domain_code, '') AS domain_name, "
        "t.owner_name"
    ),
    "order": "t.layer_code, t.table_name",
    "build_item": _build_asset,
})

register_search_entity({
    "type": "system",
    "label": "系统",
    "module": "upstream",
    "from": "dwp.p_upstream_system",
    "base_where": "is_deleted = 'N'",
    "matchers": [
        {"expr": "system_abbr", "label": "系统简称"},
        {"expr": "system_name", "label": "系统名称"},
        {"expr": "system_id", "label": "系统编码"},
        {"expr": "owner_name", "label": "负责人"},
    ],
    "select": "system_id, system_abbr, system_name, owner_name",
    "order": "system_abbr",
    "build_item": _build_system,
})

register_search_entity({
    "type": "field",
    "label": "字段",
    "module": "mapping",
    "from": (
        "dwp.p_field_mapping_field f "
        "JOIN dwp.p_field_mapping_table t ON f.table_pk = t.table_pk "
        "JOIN dwp.p_data_source s ON t.data_source_id = s.source_id"
    ),
    "base_where": "f.is_deleted = 'N' AND t.is_deleted = 'N' AND s.is_deleted = 'N'",
    "matchers": [
        {"expr": "f.source_field_name", "label": "源字段"},
        {"expr": "f.target_field_name", "label": "目标字段"},
        {"expr": "f.source_field_comment", "label": "字段注释"},
        {"expr": "t.source_table_name", "label": "源表"},
        {"expr": "t.target_table_name", "label": "目标表"},
        {"expr": "s.source_name", "label": "源系统"},
        {"expr": "s.source_code", "label": "源系统编码"},
    ],
    "select": (
        "f.source_field_name AS field_name, "
        "f.source_field_comment AS field_cn_name, "
        "t.source_table_name AS table_name"
    ),
    "order": "t.source_table_name, f.source_field_name",
    "build_item": _build_field,
})

register_search_entity({
    "type": "root",
    "label": "词根",
    "module": "root",
    "from": "dwp.p_root_item",
    "base_where": "is_deleted = 'N'",
    "matchers": [
        {"expr": "root_abbr", "label": "词根缩写"},
        {"expr": "root_en_name", "label": "英文名"},
        {"expr": "root_cn_name", "label": "中文名"},
        {"expr": "category_name", "label": "分类"},
        {"expr": "root_desc", "label": "说明"},
    ],
    "select": "root_abbr, root_en_name, root_cn_name, category_name",
    "order": "root_abbr",
    "build_item": _build_root,
})

register_search_entity({
    "type": "indicator",
    "label": "指标",
    "module": "indicator",
    "from": "dwp.p_indicator_item",
    "base_where": "is_deleted = 'N'",
    "matchers": [
        {"expr": "indicator_id", "label": "指标ID"},
        {"expr": "indicator_name", "label": "指标名称"},
        {"expr": "meaning_desc", "label": "业务含义"},
        {"expr": "result_table_name", "label": "结果表"},
        {"expr": "result_field_name", "label": "结果字段"},
        {"expr": "caliber_desc", "label": "口径"},
        {"expr": "path_desc", "label": "路径"},
        {"expr": "registrar_name", "label": "维护人"},
    ],
    "select": (
        "indicator_id, "
        "indicator_name, "
        "meaning_desc, "
        "result_table_name, "
        "result_field_name, "
        "registrar_name"
    ),
    "order": "indicator_id",
    "build_item": _build_indicator,
})

register_search_entity({
    "type": "downstream",
    "label": "下游推送",
    "module": "push",
    "from": (
        "dwp.p_push_system s "
        "LEFT JOIN dwp.p_push_job j ON j.system_id = s.system_id AND j.is_deleted = 'N'"
    ),
    "base_where": "s.is_deleted = 'N'",
    "matchers": [
        {"expr": "s.system_code", "label": "系统编码"},
        {"expr": "s.system_name", "label": "系统名称"},
        {"expr": "s.system_abbr", "label": "系统简称"},
        {"expr": "s.dept_name", "label": "归属部门"},
        {"expr": "s.system_desc", "label": "系统描述"},
        {"expr": "j.job_code", "label": "作业编码"},
        {"expr": "j.job_name", "label": "作业名称"},
        {"expr": "j.source_file_name", "label": "源文件名"},
        {"expr": "j.target_file_name", "label": "目标文件名"},
        {"expr": "j.job_desc", "label": "作业描述"},
    ],
    "select": (
        "s.system_code, "
        "s.system_name, "
        "s.system_abbr, "
        "j.job_code, "
        "j.job_name, "
        "j.source_file_name, "
        "j.target_file_name, "
        "j.job_desc"
    ),
    "order": "s.system_code, COALESCE(j.job_code, '')",
    "build_item": _build_downstream,
})

register_search_entity({
    "type": "report",
    "label": "报表",
    "module": "report",
    "from": "dwp.p_report_asset",
    "base_where": "is_deleted = 'N'",
    "matchers": [
        {"expr": "report_code", "label": "报表编码"},
        {"expr": "report_name", "label": "报表名称"},
        {"expr": "report_alias", "label": "报表别名"},
        {"expr": "report_type", "label": "报表类型"},
        {"expr": "domain_name", "label": "主题域"},
        {"expr": "purpose_desc", "label": "用途"},
        {"expr": "owner_dept_name", "label": "归属部门"},
        {"expr": "owner_name", "label": "负责人"},
        {"expr": "maintainer_name", "label": "维护人"},
    ],
    "select": (
        "report_code, "
        "report_name, "
        "report_alias, "
        "report_type, "
        "domain_name, "
        "owner_dept_name, "
        "owner_name"
    ),
    "order": "report_code",
    "build_item": _build_report,
})

register_search_entity({
    "type": "api",
    "label": "API",
    "module": "apiAsset",
    "from": "dwp.p_api_asset",
    "base_where": "is_deleted = 'N'",
    "matchers": [
        {"expr": "api_code", "label": "API编码"},
        {"expr": "api_name", "label": "API名称"},
        {"expr": "path_text", "label": "路径"},
        {"expr": "method_code", "label": "方法"},
        {"expr": "description_text", "label": "描述"},
        {"expr": "owner_dept_name", "label": "归属部门"},
        {"expr": "owner_name", "label": "负责人"},
        {"expr": "maintainer_name", "label": "维护人"},
    ],
    "select": (
        "api_code, "
        "api_name, "
        "method_code, "
        "path_text, "
        "owner_name"
    ),
    "order": "api_code",
    "build_item": _build_api,
})

register_search_entity({
    "type": "codeTable",
    "label": "码值表",
    "module": "codeTable",
    "from": "dwp.p_manual_code_table",
    "base_where": None,
    "matchers": [
        {"expr": "table_code", "label": "表编码"},
        {"expr": "table_name", "label": "表名称"},
        {"expr": "table_style", "label": "样式"},
        {"expr": "owner_name", "label": "负责人"},
        {"expr": "remark", "label": "说明"},
    ],
    "select": "table_code, table_name, table_style, owner_name, remark",
    "order": "table_code",
    "build_item": _build_code_table,
})

# --- Portal stats -----------------------------------------------------------

register_portal_stat({
    "key": "system",
    "label": "源系统",
    "from": "dwp.p_upstream_system",
    "where": "is_deleted = 'N'",
    "module": "upstream",
})
register_portal_stat({
    "key": "table",
    "label": "源表",
    "from": "dwp.p_field_mapping_table",
    "where": "is_deleted = 'N'",
    "module": "mapping",
})
register_portal_stat({
    "key": "field",
    "label": "源字段",
    "from": "dwp.p_field_mapping_field",
    "where": "is_deleted = 'N'",
    "module": "mapping",
})
register_portal_stat({
    "key": "indicator",
    "label": "指标",
    "from": "dwp.p_indicator_item",
    "where": "is_deleted = 'N'",
    "module": "indicator",
})
register_portal_stat({
    "key": "downstream_system",
    "label": "下游系统",
    "from": "dwp.p_push_system",
    "where": "is_deleted = 'N'",
    "module": "push",
})
register_portal_stat({
    "key": "downstream_push",
    "label": "下游推送文件",
    "from": "dwp.p_push_job",
    "where": "is_deleted = 'N'",
    "module": "push",
})
register_portal_stat({
    "key": "domain",
    "label": "主题域",
    "from": "dwp.p_asset_table",
    "count_expr": "COUNT(DISTINCT domain_code)",
    "where": None,
    "module": "dwm",
})
register_portal_stat({
    "key": "asset_table",
    "label": "主题表",
    "from": "dwp.p_asset_table",
    "where": "is_deleted = 'N'",
    "module": "dwm",
})
register_portal_stat({
    "key": "report",
    "label": "报表",
    "from": "dwp.p_report_asset",
    "where": "is_deleted = 'N'",
    "module": "report",
})
register_portal_stat({
    "key": "api_asset",
    "label": "API",
    "from": "dwp.p_api_asset",
    "where": "is_deleted = 'N'",
    "module": "apiAsset",
})
register_portal_stat({
    "key": "root",
    "label": "词根",
    "from": "dwp.p_root_item",
    "where": "is_deleted = 'N'",
    "module": "root",
})
register_portal_stat({
    "key": "code_table",
    "label": "码值表",
    "from": "dwp.p_manual_code_table",
    "where": None,
    "module": "codeTable",
})
