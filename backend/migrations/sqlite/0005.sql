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
