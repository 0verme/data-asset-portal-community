"""Portable Core table declarations for migrated business queries."""

from sqlalchemy import Column, DateTime, Integer, String, Table, Text

from .metadata import metadata

# pyright: reportMissingImports=false


def _table(name, *columns):
    return Table(name, metadata, *columns)


admin_user = _table(
    "p_admin_user",
    Column("id", Integer, primary_key=True),
    Column("username", String(128), nullable=False),
    Column("password_hash", Text, nullable=False),
    Column("display_name", String(255)),
    Column("status", String(32)),
    Column("role", String(32)),
    Column("last_login_at", DateTime),
    Column("created_at", DateTime),
    Column("updated_at", DateTime),
)

rbac_role = _table(
    "p_role",
    Column("role_code", String(64), primary_key=True),
    Column("name", String(128), nullable=False),
    Column("description", String(2000)),
    Column("builtin", String(1), nullable=False),
    Column("enabled", String(1), nullable=False),
    Column("created_at", DateTime),
    Column("updated_at", DateTime),
)

rbac_permission = _table(
    "p_permission",
    Column("permission_code", String(128), primary_key=True),
    Column("resource", String(64), nullable=False),
    Column("action", String(32), nullable=False),
    Column("name", String(128), nullable=False),
    Column("description", String(2000)),
)

rbac_role_permission = _table(
    "p_role_permission",
    Column("role_code", String(64), primary_key=True),
    Column("permission_code", String(128), primary_key=True),
)

asset_domain = _table(
    "p_asset_domain",
    Column("domain_code", String(64), primary_key=True),
    Column("domain_name", String(256), nullable=False),
    Column("display_order", Integer, nullable=False),
    Column("is_active", String(1), nullable=False),
    Column("is_deleted", String(1), nullable=False),
)

asset_layer = _table(
    "p_asset_layer",
    Column("layer_code", String(32), primary_key=True),
    Column("layer_name", String(128), nullable=False),
    Column("display_order", Integer, nullable=False),
    Column("is_active", String(1), nullable=False),
    Column("is_deleted", String(1), nullable=False),
)

asset_table = _table(
    "p_asset_table",
    Column("asset_id", Integer, primary_key=True),
    Column("table_name", String(256), nullable=False),
    Column("table_cn_name", String(256)),
    Column("schema_name", String(128), nullable=False),
    Column("catalog_name", String(128)),
    Column("database_name", String(128)),
    Column("source_key", String(64)),
    Column("asset_type", String(64)),
    Column("external_id", String(256)),
    Column("qualified_name", String(512)),
    Column("layer_code", String(32)),
    Column("domain_code", String(64)),
    Column("owner_name", String(128)),
    Column("grain_desc", String(1000)),
    Column("cycle_desc", String(1000)),
    Column("table_desc", String(2000)),
    Column("field_count", Integer, nullable=False),
    Column("is_deleted", String(1), nullable=False),
    Column("created_by", String(64), nullable=False),
    Column("created_at", DateTime),
    Column("updated_by", String(64), nullable=False),
    Column("updated_at", DateTime),
)

asset_field = _table(
    "p_asset_field",
    Column("field_id", Integer, primary_key=True),
    Column("asset_id", Integer, nullable=False),
    Column("field_name", String(256), nullable=False),
    Column("field_cn_name", String(256)),
    Column("data_type", String(128)),
    Column("field_order", Integer, nullable=False),
    Column("nullable_flag", String(1), nullable=False),
    Column("pk_flag", String(1), nullable=False),
    Column("partition_flag", String(1), nullable=False),
    Column("enum_desc", Text),
    Column("field_desc", Text),
    Column("is_deleted", String(1), nullable=False),
    Column("created_by", String(64), nullable=False),
    Column("created_at", DateTime),
    Column("updated_by", String(64), nullable=False),
    Column("updated_at", DateTime),
)

asset_change_log = _table(
    "p_asset_change_log",
    Column("change_id", Integer, primary_key=True),
    Column("asset_id", Integer),
    Column("table_name", String(256), nullable=False),
    Column("change_type", String(64), nullable=False),
    Column("change_summary", String(1000)),
    Column("before_json", Text),
    Column("after_json", Text),
    Column("operator_name", String(64), nullable=False),
    Column("change_time", DateTime),
)

upstream_system = _table(
    "p_upstream_system",
    Column("system_pk", Integer, primary_key=True),
    Column("data_source_id", Integer),
    Column("system_id", String(64), nullable=False),
    Column("system_abbr", String(32), nullable=False),
    Column("system_name", String(256), nullable=False),
    Column("db_type", String(64), nullable=False),
    Column("host_name", String(256)),
    Column("db_name", String(256)),
    Column("schema_name", String(256)),
    Column("status_code", String(32), nullable=False),
    Column("owner_name", String(128)),
    Column("dept_name", String(128)),
    Column("system_desc", String(2000)),
    Column("unload_count", Integer, nullable=False),
    Column("is_deleted", String(1), nullable=False),
    Column("created_by", String(64), nullable=False),
    Column("created_at", DateTime),
    Column("updated_by", String(64), nullable=False),
    Column("updated_at", DateTime),
)

upstream_unload_time = _table(
    "p_upstream_unload_time",
    Column("time_pk", Integer, primary_key=True),
    Column("system_pk", Integer, nullable=False),
    Column("unload_time", String(5), nullable=False),
    Column("display_order", Integer, nullable=False),
    Column("is_deleted", String(1), nullable=False),
    Column("created_by", String(64), nullable=False),
    Column("created_at", DateTime),
    Column("updated_by", String(64), nullable=False),
    Column("updated_at", DateTime),
)

upstream_change_log = _table(
    "p_upstream_change_log",
    Column("change_id", Integer, primary_key=True),
    Column("system_pk", Integer),
    Column("system_id", String(64), nullable=False),
    Column("change_type", String(64), nullable=False),
    Column("change_summary", String(512)),
    Column("before_json", Text),
    Column("after_json", Text),
    Column("operator_name", String(64), nullable=False),
    Column("change_time", DateTime),
)

data_source = _table(
    "p_data_source",
    Column("source_id", Integer, primary_key=True),
    Column("source_code", String(64), nullable=False),
    Column("source_name", String(256), nullable=False),
    Column("source_type", String(64), nullable=False),
    Column("description_text", String(2000)),
    Column("status_code", String(32), nullable=False),
    Column("is_deleted", String(1), nullable=False),
    Column("created_by", String(64), nullable=False),
    Column("created_at", DateTime),
    Column("updated_by", String(64), nullable=False),
    Column("updated_at", DateTime),
)

mapping_table = _table(
    "p_field_mapping_table",
    Column("table_pk", Integer, primary_key=True),
    Column("data_source_id", Integer),
    Column("upstream_system_id", Integer),
    Column("source_table_name", String(128), nullable=False),
    Column("source_table_cn", String(256)),
    Column("target_layer_code", String(32), nullable=False),
    Column("target_table_name", String(128)),
    Column("load_mode", String(32)),
    Column("field_total_count", Integer, nullable=False),
    Column("mapped_field_count", Integer, nullable=False),
    Column("latest_mapping_time", DateTime),
    Column("table_desc", String(2000)),
    Column("is_deleted", String(1), nullable=False),
    Column("created_by", String(64), nullable=False),
    Column("created_at", DateTime),
    Column("updated_by", String(64), nullable=False),
    Column("updated_at", DateTime),
)

mapping_field = _table(
    "p_field_mapping_field",
    Column("field_pk", Integer, primary_key=True),
    Column("table_pk", Integer, nullable=False),
    Column("source_field_name", String(128), nullable=False),
    Column("source_field_type", String(128)),
    Column("source_field_comment", String(1000)),
    Column("target_field_name", String(128)),
    Column("mapping_rule", String(64), nullable=False),
    Column("field_order", Integer, nullable=False),
    Column("is_deleted", String(1), nullable=False),
    Column("created_by", String(64), nullable=False),
    Column("created_at", DateTime),
    Column("updated_by", String(64), nullable=False),
    Column("updated_at", DateTime),
)

manual_code_table = _table(
    "p_manual_code_table",
    Column("table_id", Integer, primary_key=True),
    Column("table_code", String(64), nullable=False),
    Column("table_name", String(128), nullable=False),
    Column("table_style", String(32), nullable=False),
    Column("owner_name", String(64)),
    Column("status_code", String(32), nullable=False),
    Column("remark", String(1000)),
    Column("created_by", String(64), nullable=False),
    Column("created_at", DateTime),
    Column("updated_by", String(64), nullable=False),
    Column("updated_at", DateTime),
)


indicator_item = _table(
    "p_indicator_item",
    Column("indicator_pk", Integer, primary_key=True),
    Column("indicator_id", String(64), nullable=False),
    Column("indicator_name", String(256), nullable=False),
    Column("meaning_desc", String(4000)),
    Column("result_table_name", String(256)),
    Column("result_field_name", String(256)),
    Column("dimension_code", String(16), nullable=False),
    Column("caliber_desc", String(1000)),
    Column("path_desc", String(1000)),
    Column("status_code", String(32), nullable=False),
    Column("registrar_name", String(64), nullable=False),
    Column("registered_date", String(10), nullable=False),
    Column("is_deleted", String(1), nullable=False),
    Column("created_by", String(64), nullable=False),
    Column("created_at", DateTime),
    Column("updated_by", String(64), nullable=False),
    Column("updated_at", DateTime),
)

indicator_change_log = _table(
    "p_indicator_change_log",
    Column("change_id", Integer, primary_key=True),
    Column("indicator_pk", Integer),
    Column("indicator_id", String(64), nullable=False),
    Column("change_type", String(64), nullable=False),
    Column("change_summary", String(512)),
    Column("before_json", Text),
    Column("after_json", Text),
    Column("operator_name", String(64), nullable=False),
    Column("change_time", DateTime),
)

indicator_path_config = _table(
    "p_indicator_path_config",
    Column("id", Integer, primary_key=True),
    Column("parent_id", Integer),
    Column("path_code", String(64), nullable=False),
    Column("path_name", String(256), nullable=False),
    Column("dimension_code", String(16), nullable=False),
    Column("path_level", Integer, nullable=False),
    Column("full_path", String(1000), nullable=False),
    Column("sort_order", Integer, nullable=False),
    Column("status", String(32), nullable=False),
    Column("remark", String(1000)),
    Column("created_at", DateTime),
    Column("updated_at", DateTime),
)

code_category = _table(
    "p_code_category",
    Column("category_id", Integer, primary_key=True),
    Column("category_code", String(64), nullable=False),
    Column("category_name", String(128), nullable=False),
    Column("category_desc", Text),
    Column("display_order", Integer, nullable=False),
    Column("is_active", String(1), nullable=False),
    Column("remark", String(1000)),
    Column("created_by", String(64), nullable=False),
    Column("created_at", DateTime),
    Column("updated_by", String(64), nullable=False),
    Column("updated_at", DateTime),
)

code_item = _table(
    "p_code_item",
    Column("item_id", Integer, primary_key=True),
    Column("category_code", String(64), nullable=False),
    Column("item_code", String(64), nullable=False),
    Column("item_name", String(128), nullable=False),
    Column("item_value", String(256)),
    Column("item_desc", String(512)),
    Column("display_order", Integer, nullable=False),
    Column("ext_json", Text),
    Column("is_active", String(1), nullable=False),
    Column("remark", String(1000)),
    Column("created_by", String(64), nullable=False),
    Column("created_at", DateTime),
    Column("updated_by", String(64), nullable=False),
    Column("updated_at", DateTime),
)

menu_table = _table(
    "p_menu",
    Column("menu_id", Integer, primary_key=True),
    Column("menu_code", String(64), nullable=False),
    Column("menu_name", String(128), nullable=False),
    Column("menu_icon", String(64), nullable=False),
    Column("menu_path", String(256)),
    Column("display_order", Integer, nullable=False),
    Column("nav_placement", String(16), nullable=False),
    Column("admin_only", String(1), nullable=False),
    Column("is_active", String(1), nullable=False),
    Column("menu_desc", Text),
    Column("remark", Text),
    Column("created_by", String(64), nullable=False),
    Column("created_at", DateTime),
    Column("updated_by", String(64), nullable=False),
    Column("updated_at", DateTime),
)

lineage_snapshot = _table(
    "p_lineage_snapshot",
    Column("snapshot_id", String(128), primary_key=True),
    Column("generated_at", DateTime, nullable=False),
    Column("generator_name", String(256), nullable=False),
    Column("generator_version", String(64), nullable=False),
    Column("import_batch_id", String(128)),
    Column("source_key", String(64)),
    Column("content_hash", String(64)),
    Column("ingestion_id", String(64)),
    Column("status_code", String(32), nullable=False),
)

lineage_node = _table(
    "p_lineage_node",
    Column("snapshot_id", String(128), nullable=False),
    Column("node_id", String(256), nullable=False),
    Column("kind_code", String(64), nullable=False),
    Column("node_name", String(256), nullable=False),
    Column("display_name", String(256)),
    Column("namespace_name", String(128)),
    Column("attributes_json", Text),
)

lineage_edge = _table(
    "p_lineage_edge",
    Column("snapshot_id", String(128), nullable=False),
    Column("edge_id", String(256), nullable=False),
    Column("source_node_id", String(256), nullable=False),
    Column("target_node_id", String(256), nullable=False),
    Column("kind_code", String(64), nullable=False),
    Column("evidence_type", String(64)),
    Column("source_record_id", String(256)),
    Column("evidence_description", String(1000)),
    Column("confidence_code", String(32)),
    Column("generated_at", DateTime),
    Column("diagnostics_json", Text),
)

operation_log = _table(
    "p_operation_log",
    Column("id", Integer, primary_key=True),
    Column("user_id", String(64)),
    Column("user_name", String(128)),
    Column("dept_name", String(128)),
    Column("module_name", String(64), nullable=False),
    Column("operation_type", String(32), nullable=False),
    Column("operation_object", String(512)),
    Column("operation_desc", String(1024)),
    Column("request_method", String(16)),
    Column("request_url", String(512)),
    Column("request_params", Text),
    Column("result_status", String(16), nullable=False),
    Column("error_message", Text),
    Column("ip_address", String(64)),
    Column("user_agent", String(512)),
    Column("cost_time_ms", Integer, nullable=False),
    Column("remark", String(512)),
    Column("created_at", DateTime),
)

system_table = _table(
    "p_system",
    Column("system_id", Integer, primary_key=True),
    Column("system_code", String(64), nullable=False),
    Column("system_name", String(256), nullable=False),
    Column("system_abbr", String(32), nullable=False),
    Column("description_text", String(2000)),
    Column("system_type", String(64), nullable=False),
    Column("department_name", String(128)),
    Column("status_code", String(32), nullable=False),
    Column("is_deleted", String(1), nullable=False),
    Column("created_by", String(64), nullable=False),
    Column("created_at", DateTime),
    Column("updated_by", String(64), nullable=False),
    Column("updated_at", DateTime),
)

push_system = _table(
    "p_push_system",
    Column("system_id", Integer, primary_key=True),
    Column("master_system_id", Integer),
    Column("system_code", String(64), nullable=False),
    Column("system_name", String(256), nullable=False),
    Column("system_abbr", String(32), nullable=False),
    Column("protocol_type", String(32), nullable=False),
    Column("host_name", String(256), nullable=False),
    Column("port_no", Integer, nullable=False),
    Column("account_name", String(128)),
    Column("auth_type", String(64)),
    Column("contact_name", String(128)),
    Column("data_developer_contact_name", String(128)),
    Column("dept_name", String(128)),
    Column("system_desc", String(2000)),
    Column("status_code", String(32), nullable=False),
    Column("importance_level_code", String(16), nullable=False),
    Column("latest_output_time", String(5)),
    Column("job_count", Integer, nullable=False),
    Column("is_deleted", String(1), nullable=False),
    Column("created_by", String(64), nullable=False),
    Column("created_at", DateTime),
    Column("updated_by", String(64), nullable=False),
    Column("updated_at", DateTime),
)

push_job = _table(
    "p_push_job",
    Column("job_id", Integer, primary_key=True),
    Column("system_id", Integer, nullable=False),
    Column("job_code", String(128), nullable=False),
    Column("job_name", String(256), nullable=False),
    Column("source_path", String(1000)),
    Column("source_file_name", String(512)),
    Column("target_path", String(1000)),
    Column("target_file_name", String(512), nullable=False),
    Column("freq_desc", String(200)),
    Column("freq_type", String(64)),
    Column("delimiter_code", String(32)),
    Column("encoding_type", String(64)),
    Column("row_count_desc", String(200)),
    Column("enabled_flag", String(1), nullable=False),
    Column("job_desc", String(2000)),
    Column("field_count", Integer, nullable=False),
    Column("is_deleted", String(1), nullable=False),
    Column("created_by", String(64), nullable=False),
    Column("created_at", DateTime),
    Column("updated_by", String(64), nullable=False),
    Column("updated_at", DateTime),
)

push_job_field = _table(
    "p_push_job_field",
    Column("field_id", Integer, primary_key=True),
    Column("job_id", Integer, nullable=False),
    Column("field_name", String(128), nullable=False),
    Column("field_cn_name", String(256), nullable=False),
    Column("field_order", Integer, nullable=False),
    Column("source_code", String(64)),
    Column("data_type", String(128), nullable=False),
    Column("field_meaning", String(2000)),
    Column("is_deleted", String(1), nullable=False),
    Column("created_by", String(64), nullable=False),
    Column("created_at", DateTime),
    Column("updated_by", String(64), nullable=False),
    Column("updated_at", DateTime),
)

push_change_log = _table(
    "p_push_change_log",
    Column("change_id", Integer, primary_key=True),
    Column("system_id", Integer),
    Column("job_id", Integer),
    Column("object_type", String(32), nullable=False),
    Column("object_code", String(128), nullable=False),
    Column("change_type", String(64), nullable=False),
    Column("change_summary", String(1000)),
    Column("before_json", Text),
    Column("after_json", Text),
    Column("operator_name", String(64), nullable=False),
    Column("change_time", DateTime),
    Column("trace_id", String(128)),
)

api_asset = _table(
    "p_api_asset",
    Column("api_pk", Integer, primary_key=True),
    Column("api_code", String(64), nullable=False),
    Column("api_name", String(256), nullable=False),
    Column("method_code", String(10), nullable=False),
    Column("path_text", String(512), nullable=False),
    Column("version_text", String(64)),
    Column("system_id", Integer),
    Column("downstream_system_id", Integer),
    Column("api_type", String(64)),
    Column("status_code", String(32), nullable=False),
    Column("owner_dept_name", String(128), nullable=False),
    Column("owner_name", String(64), nullable=False),
    Column("maintainer_name", String(64)),
    Column("description_text", String(2000)),
    Column("remark_desc", String(2000)),
    Column("is_deleted", String(1), nullable=False),
    Column("created_by", String(64), nullable=False),
    Column("created_at", DateTime),
    Column("updated_by", String(64), nullable=False),
    Column("updated_at", DateTime),
)

api_param = _table(
    "p_api_param",
    Column("param_pk", Integer, primary_key=True),
    Column("api_code", String(64), nullable=False),
    Column("param_name", String(128), nullable=False),
    Column("param_in", String(16), nullable=False),
    Column("data_type", String(64), nullable=False),
    Column("required_flag", String(1), nullable=False),
    Column("description_text", String(1000)),
    Column("example_value", String(1000)),
    Column("sort_no", Integer, nullable=False),
)

api_response_field = _table(
    "p_api_response_field",
    Column("field_pk", Integer, primary_key=True),
    Column("api_code", String(64), nullable=False),
    Column("field_name", String(128), nullable=False),
    Column("data_type", String(64), nullable=False),
    Column("description_text", String(1000)),
    Column("example_value", String(1000)),
    Column("sort_no", Integer, nullable=False),
)

api_relation = _table(
    "p_api_relation",
    Column("relation_pk", Integer, primary_key=True),
    Column("api_code", String(64), nullable=False),
    Column("relation_type", String(16), nullable=False),
    Column("target_code", String(128), nullable=False),
    Column("target_name", String(256)),
    Column("sort_no", Integer, nullable=False),
)

root_category = _table(
    "p_root_category",
    Column("category_id", Integer, primary_key=True),
    Column("category_name", String(64), nullable=False),
    Column("display_order", Integer, nullable=False),
    Column("is_deleted", String(1), nullable=False),
    Column("created_at", DateTime),
    Column("updated_at", DateTime),
)

root_item = _table(
    "p_root_item",
    Column("root_id", Integer, primary_key=True),
    Column("root_abbr", String(64), nullable=False),
    Column("root_en_name", String(256)),
    Column("root_cn_name", String(256), nullable=False),
    Column("category_name", String(64), nullable=False),
    Column("root_desc", String(2000)),
    Column("is_deleted", String(1), nullable=False),
    Column("created_by", String(64), nullable=False),
    Column("created_at", DateTime),
    Column("updated_by", String(64), nullable=False),
    Column("updated_at", DateTime),
)

root_change_log = _table(
    "p_root_change_log",
    Column("change_id", Integer, primary_key=True),
    Column("root_id", Integer),
    Column("root_abbr", String(64), nullable=False),
    Column("change_type", String(64), nullable=False),
    Column("change_summary", String(512)),
    Column("before_json", Text),
    Column("after_json", Text),
    Column("operator_name", String(64), nullable=False),
    Column("change_time", DateTime),
)

report_asset = _table(
    "p_report_asset",
    Column("report_pk", Integer, primary_key=True),
    Column("report_code", String(64), nullable=False),
    Column("report_name", String(256), nullable=False),
    Column("report_alias", String(256)),
    Column("report_type", String(64), nullable=False),
    Column("domain_name", String(128)),
    Column("freq_code", String(32)),
    Column("stat_period_code", String(32)),
    Column("date_caliber_code", String(32)),
    Column("date_caliber_other_desc", String(500)),
    Column("data_timeliness_code", String(32)),
    Column("data_timeliness_custom_desc", String(500)),
    Column("status_code", String(32), nullable=False),
    Column("effective_date", String(10)),
    Column("expire_date", String(10)),
    Column("purpose_desc", String(2000)),
    Column("stat_object_desc", String(1000)),
    Column("stat_scope_desc", String(1000)),
    Column("time_caliber_desc", String(1000)),
    Column("filter_condition_desc", String(2000)),
    Column("special_rule_desc", String(2000)),
    Column("owner_dept_name", String(128), nullable=False),
    Column("owner_name", String(64), nullable=False),
    Column("maintainer_name", String(64)),
    Column("related_tables_json", Text, nullable=False),
    Column("related_indicators_json", Text, nullable=False),
    Column("remark_desc", String(2000)),
    Column("is_deleted", String(1), nullable=False),
    Column("created_by", String(64), nullable=False),
    Column("created_at", DateTime),
    Column("updated_by", String(64), nullable=False),
    Column("updated_at", DateTime),
)
