-- Current Community schema baseline. Fresh installations only.
CREATE TABLE IF NOT EXISTS dwp.p_system (
    system_id INTEGER PRIMARY KEY,
    system_code TEXT NOT NULL UNIQUE,
    system_name TEXT NOT NULL,
    system_abbr TEXT NOT NULL DEFAULT '',
    description_text TEXT,
    system_type TEXT NOT NULL DEFAULT 'business',
    department_name TEXT,
    status_code TEXT NOT NULL DEFAULT 'enabled',
    is_deleted TEXT NOT NULL DEFAULT 'N',
    created_by TEXT NOT NULL DEFAULT 'system',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by TEXT NOT NULL DEFAULT 'system',
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS dwp.p_data_source (
    source_id INTEGER PRIMARY KEY,
    source_code TEXT NOT NULL UNIQUE,
    source_name TEXT NOT NULL,
    source_type TEXT NOT NULL,
    description_text TEXT,
    status_code TEXT NOT NULL DEFAULT 'enabled',
    is_deleted TEXT NOT NULL DEFAULT 'N',
    created_by TEXT NOT NULL DEFAULT 'system',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by TEXT NOT NULL DEFAULT 'system',
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS dwp.p_api_asset (
    api_pk INTEGER PRIMARY KEY,
    api_code TEXT NOT NULL UNIQUE,
    api_name TEXT NOT NULL,
    method_code TEXT NOT NULL,
    path_text TEXT NOT NULL,
    version_text TEXT,
    system_id INTEGER,
    downstream_system_id INTEGER,
    api_type TEXT,
    status_code TEXT NOT NULL DEFAULT 'enabled',
    owner_dept_name TEXT NOT NULL,
    owner_name TEXT NOT NULL,
    maintainer_name TEXT,
    description_text TEXT,
    remark_desc TEXT,
    is_deleted TEXT NOT NULL DEFAULT 'N',
    created_by TEXT NOT NULL DEFAULT 'system',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by TEXT NOT NULL DEFAULT 'system',
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (system_id) REFERENCES p_system(system_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS dwp.idx_p_api_asset_filter
    ON p_api_asset (status_code, method_code, system_id);

CREATE TABLE IF NOT EXISTS dwp.p_api_param (
    param_pk INTEGER PRIMARY KEY, api_code TEXT NOT NULL, param_name TEXT NOT NULL,
    param_in TEXT NOT NULL, data_type TEXT NOT NULL, required_flag TEXT NOT NULL DEFAULT 'N',
    description_text TEXT, example_value TEXT, sort_no INTEGER NOT NULL DEFAULT 0,
    UNIQUE(api_code,param_name,param_in)
);
CREATE TABLE IF NOT EXISTS dwp.p_api_response_field (
    field_pk INTEGER PRIMARY KEY, api_code TEXT NOT NULL, field_name TEXT NOT NULL,
    data_type TEXT NOT NULL, description_text TEXT, example_value TEXT,
    sort_no INTEGER NOT NULL DEFAULT 0, UNIQUE(api_code,field_name)
);
CREATE TABLE IF NOT EXISTS dwp.p_api_relation (
    relation_pk INTEGER PRIMARY KEY, api_code TEXT NOT NULL, relation_type TEXT NOT NULL,
    target_code TEXT NOT NULL, target_name TEXT, sort_no INTEGER NOT NULL DEFAULT 0,
    UNIQUE(api_code,relation_type,target_code)
);

CREATE TABLE IF NOT EXISTS dwp.p_field_mapping_table (
    table_pk INTEGER PRIMARY KEY,
    data_source_id INTEGER NOT NULL,
    upstream_system_id INTEGER,
    source_table_name TEXT NOT NULL,
    source_table_cn TEXT,
    target_layer_code TEXT NOT NULL DEFAULT 'DWF',
    target_table_name TEXT,
    load_mode TEXT,
    field_total_count INTEGER NOT NULL DEFAULT 0,
    mapped_field_count INTEGER NOT NULL DEFAULT 0,
    latest_mapping_time TIMESTAMP,
    table_desc TEXT,
    is_deleted TEXT NOT NULL DEFAULT 'N',
    created_by TEXT NOT NULL DEFAULT 'system',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by TEXT NOT NULL DEFAULT 'system',
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (data_source_id) REFERENCES p_data_source(source_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS dwp.idx_p_field_mapping_table_source
    ON p_field_mapping_table (data_source_id, source_table_name);

CREATE TABLE IF NOT EXISTS dwp.p_field_mapping_field (
    field_pk INTEGER PRIMARY KEY,
    table_pk INTEGER NOT NULL,
    source_field_name TEXT NOT NULL,
    source_field_type TEXT,
    source_field_comment TEXT,
    target_field_name TEXT,
    mapping_rule TEXT NOT NULL DEFAULT '待补充',
    field_order INTEGER NOT NULL DEFAULT 0,
    is_deleted TEXT NOT NULL DEFAULT 'N',
    created_by TEXT NOT NULL DEFAULT 'system',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by TEXT NOT NULL DEFAULT 'system',
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (table_pk) REFERENCES p_field_mapping_table(table_pk) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS dwp.p_admin_user (
  id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
  display_name TEXT, role TEXT NOT NULL DEFAULT 'admin', status TEXT NOT NULL DEFAULT 'ACTIVE',
  last_login_at TIMESTAMP, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS dwp.p_asset_domain (
  domain_code TEXT PRIMARY KEY, domain_name TEXT NOT NULL, display_order INTEGER NOT NULL DEFAULT 0,
  is_active TEXT NOT NULL DEFAULT 'Y', is_deleted TEXT NOT NULL DEFAULT 'N'
);
CREATE TABLE IF NOT EXISTS dwp.p_asset_layer (
  layer_code TEXT PRIMARY KEY, layer_name TEXT NOT NULL, display_order INTEGER NOT NULL DEFAULT 0,
  is_active TEXT NOT NULL DEFAULT 'Y', is_deleted TEXT NOT NULL DEFAULT 'N'
);
CREATE TABLE IF NOT EXISTS dwp.p_asset_table (
  asset_id INTEGER PRIMARY KEY, table_name TEXT NOT NULL UNIQUE, table_cn_name TEXT,
  schema_name TEXT NOT NULL DEFAULT 'dwp', layer_code TEXT, domain_code TEXT,
  owner_name TEXT, grain_desc TEXT, cycle_desc TEXT, table_desc TEXT,
  field_count INTEGER NOT NULL DEFAULT 0, is_deleted TEXT NOT NULL DEFAULT 'N',
  created_by TEXT NOT NULL DEFAULT 'system',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by TEXT NOT NULL DEFAULT 'system',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS dwp.p_asset_field (
  field_id INTEGER PRIMARY KEY, asset_id INTEGER NOT NULL, field_name TEXT NOT NULL,
  field_cn_name TEXT, data_type TEXT, field_order INTEGER NOT NULL DEFAULT 0,
  nullable_flag TEXT NOT NULL DEFAULT 'Y', pk_flag TEXT NOT NULL DEFAULT 'N',
  partition_flag TEXT NOT NULL DEFAULT 'N', enum_desc TEXT, field_desc TEXT,
  is_deleted TEXT NOT NULL DEFAULT 'N', created_by TEXT NOT NULL DEFAULT 'system',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by TEXT NOT NULL DEFAULT 'system',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS dwp.p_asset_change_log (
  change_id INTEGER PRIMARY KEY, asset_id INTEGER, table_name TEXT NOT NULL,
  change_type TEXT NOT NULL, change_summary TEXT, before_json TEXT, after_json TEXT,
  operator_name TEXT NOT NULL DEFAULT 'system',
  change_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS dwp.p_root_category (
  category_id INTEGER PRIMARY KEY, category_name TEXT NOT NULL UNIQUE,
  display_order INTEGER NOT NULL DEFAULT 0, is_deleted TEXT NOT NULL DEFAULT 'N',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS dwp.p_root_item (
  root_id INTEGER PRIMARY KEY, root_abbr TEXT NOT NULL UNIQUE, root_en_name TEXT,
  root_cn_name TEXT NOT NULL, category_name TEXT NOT NULL, root_desc TEXT,
  is_deleted TEXT NOT NULL DEFAULT 'N', created_by TEXT NOT NULL DEFAULT 'system',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by TEXT NOT NULL DEFAULT 'system',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS dwp.p_indicator_item (
  indicator_pk INTEGER PRIMARY KEY, indicator_id TEXT NOT NULL UNIQUE,
  indicator_name TEXT NOT NULL, meaning_desc TEXT, result_table_name TEXT,
  result_field_name TEXT, dimension_code TEXT NOT NULL, caliber_desc TEXT,
  path_desc TEXT, status_code TEXT NOT NULL, registrar_name TEXT NOT NULL,
  registered_date TEXT NOT NULL, is_deleted TEXT NOT NULL DEFAULT 'N',
  created_by TEXT NOT NULL DEFAULT 'system', created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by TEXT NOT NULL DEFAULT 'system', updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS dwp.p_indicator_path_config (
  id INTEGER PRIMARY KEY, parent_id INTEGER, path_code TEXT NOT NULL UNIQUE,
  path_name TEXT NOT NULL, dimension_code TEXT NOT NULL, path_level INTEGER NOT NULL,
  full_path TEXT NOT NULL UNIQUE, sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'enabled', remark TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS dwp.p_operation_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, user_name TEXT, dept_name TEXT,
  module_name TEXT NOT NULL, operation_type TEXT NOT NULL,
  operation_object TEXT, operation_desc TEXT, request_method TEXT,
  request_url TEXT, request_params TEXT, result_status TEXT NOT NULL DEFAULT 'success',
  error_message TEXT, ip_address TEXT, user_agent TEXT,
  cost_time_ms INTEGER NOT NULL DEFAULT 0, remark TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS dwp.p_menu (
  menu_id INTEGER PRIMARY KEY, menu_code TEXT NOT NULL UNIQUE, menu_name TEXT NOT NULL,
  menu_icon TEXT NOT NULL DEFAULT 'grid', menu_path TEXT,
  display_order INTEGER NOT NULL DEFAULT 0, nav_placement TEXT NOT NULL DEFAULT 'more',
  admin_only TEXT NOT NULL DEFAULT 'N', is_active TEXT NOT NULL DEFAULT 'Y',
  menu_desc TEXT, remark TEXT, created_by TEXT NOT NULL DEFAULT 'system',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by TEXT NOT NULL DEFAULT 'system',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS dwp.p_code_category (
  category_id INTEGER PRIMARY KEY, category_code TEXT NOT NULL UNIQUE,
  category_name TEXT NOT NULL, category_desc TEXT,
  display_order INTEGER NOT NULL DEFAULT 0, is_active TEXT NOT NULL DEFAULT 'Y',
  remark TEXT, created_by TEXT NOT NULL DEFAULT 'system',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by TEXT NOT NULL DEFAULT 'system',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS dwp.p_code_item (
  item_id INTEGER PRIMARY KEY, category_code TEXT NOT NULL,
  item_code TEXT NOT NULL, item_name TEXT NOT NULL, item_value TEXT,
  item_desc TEXT, display_order INTEGER NOT NULL DEFAULT 0, ext_json TEXT,
  is_active TEXT NOT NULL DEFAULT 'Y', remark TEXT,
  created_by TEXT NOT NULL DEFAULT 'system',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by TEXT NOT NULL DEFAULT 'system',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(category_code, item_code)
);
CREATE TABLE IF NOT EXISTS dwp.p_root_change_log (
  change_id INTEGER PRIMARY KEY, root_id INTEGER, root_abbr TEXT NOT NULL,
  change_type TEXT NOT NULL, change_summary TEXT, before_json TEXT, after_json TEXT,
  operator_name TEXT NOT NULL DEFAULT 'system',
  change_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS dwp.p_indicator_change_log (
  change_id INTEGER PRIMARY KEY, indicator_pk INTEGER, indicator_id TEXT NOT NULL,
  change_type TEXT NOT NULL, change_summary TEXT, before_json TEXT, after_json TEXT,
  operator_name TEXT NOT NULL DEFAULT 'system',
  change_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
