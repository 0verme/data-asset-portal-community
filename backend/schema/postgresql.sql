-- Current Community schema baseline. Fresh installations only.
CREATE SCHEMA IF NOT EXISTS dwp;
CREATE TABLE IF NOT EXISTS dwp.p_system (
    system_id BIGINT PRIMARY KEY, system_code VARCHAR(64) NOT NULL UNIQUE,
    system_name VARCHAR(256) NOT NULL, system_abbr VARCHAR(32) NOT NULL DEFAULT '',
    description_text VARCHAR(2000), system_type VARCHAR(64) NOT NULL DEFAULT 'business',
    department_name VARCHAR(128), status_code VARCHAR(32) NOT NULL DEFAULT 'enabled',
    is_deleted CHAR(1) NOT NULL DEFAULT 'N', created_by VARCHAR(64) NOT NULL DEFAULT 'system',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by VARCHAR(64) NOT NULL DEFAULT 'system',
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS dwp.p_data_source (
    source_id BIGINT PRIMARY KEY, source_code VARCHAR(64) NOT NULL UNIQUE,
    source_name VARCHAR(256) NOT NULL, source_type VARCHAR(64) NOT NULL,
    description_text VARCHAR(2000), status_code VARCHAR(32) NOT NULL DEFAULT 'enabled',
    is_deleted CHAR(1) NOT NULL DEFAULT 'N', created_by VARCHAR(64) NOT NULL DEFAULT 'system',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by VARCHAR(64) NOT NULL DEFAULT 'system',
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS dwp.p_api_asset (
  api_pk BIGINT PRIMARY KEY, api_code VARCHAR(64) NOT NULL UNIQUE,
  api_name VARCHAR(256) NOT NULL, method_code VARCHAR(10) NOT NULL,
  path_text VARCHAR(512) NOT NULL, version_text VARCHAR(64), system_id BIGINT,
  downstream_system_id BIGINT, api_type VARCHAR(64),
  status_code VARCHAR(32) NOT NULL DEFAULT 'enabled',
  owner_dept_name VARCHAR(128) NOT NULL, owner_name VARCHAR(64) NOT NULL,
  maintainer_name VARCHAR(64), description_text VARCHAR(2000), remark_desc VARCHAR(2000),
  is_deleted CHAR(1) NOT NULL DEFAULT 'N', created_by VARCHAR(64) NOT NULL DEFAULT 'system',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by VARCHAR(64) NOT NULL DEFAULT 'system',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS dwp.p_api_param (
  param_pk BIGINT PRIMARY KEY, api_code VARCHAR(64) NOT NULL, param_name VARCHAR(128) NOT NULL,
  param_in VARCHAR(16) NOT NULL, data_type VARCHAR(64) NOT NULL,
  required_flag CHAR(1) NOT NULL DEFAULT 'N', description_text VARCHAR(1000),
  example_value VARCHAR(1000), sort_no INTEGER NOT NULL DEFAULT 0,
  UNIQUE(api_code,param_name,param_in)
);
CREATE TABLE IF NOT EXISTS dwp.p_api_response_field (
  field_pk BIGINT PRIMARY KEY, api_code VARCHAR(64) NOT NULL, field_name VARCHAR(128) NOT NULL,
  data_type VARCHAR(64) NOT NULL, description_text VARCHAR(1000), example_value VARCHAR(1000),
  sort_no INTEGER NOT NULL DEFAULT 0, UNIQUE(api_code,field_name)
);
CREATE TABLE IF NOT EXISTS dwp.p_api_relation (
  relation_pk BIGINT PRIMARY KEY, api_code VARCHAR(64) NOT NULL,
  relation_type VARCHAR(16) NOT NULL, target_code VARCHAR(128) NOT NULL,
  target_name VARCHAR(256), sort_no INTEGER NOT NULL DEFAULT 0,
  UNIQUE(api_code,relation_type,target_code)
);
ALTER TABLE dwp.p_api_asset ADD CONSTRAINT fk_p_api_asset_system
  FOREIGN KEY (system_id) REFERENCES dwp.p_system(system_id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_p_api_asset_filter
  ON dwp.p_api_asset(status_code, method_code, system_id);

CREATE TABLE IF NOT EXISTS dwp.p_field_mapping_table (
  table_pk BIGINT PRIMARY KEY, data_source_id BIGINT NOT NULL,
  upstream_system_id BIGINT, source_table_name VARCHAR(128) NOT NULL,
  source_table_cn VARCHAR(256), target_layer_code VARCHAR(32) NOT NULL DEFAULT 'DWF',
  target_table_name VARCHAR(128), load_mode VARCHAR(32),
  field_total_count INTEGER NOT NULL DEFAULT 0, mapped_field_count INTEGER NOT NULL DEFAULT 0,
  latest_mapping_time TIMESTAMP, table_desc VARCHAR(2000),
  is_deleted CHAR(1) NOT NULL DEFAULT 'N', created_by VARCHAR(64) NOT NULL DEFAULT 'system',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by VARCHAR(64) NOT NULL DEFAULT 'system',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS dwp.p_field_mapping_field (
  field_pk BIGINT PRIMARY KEY, table_pk BIGINT NOT NULL,
  source_field_name VARCHAR(128) NOT NULL, source_field_type VARCHAR(128),
  source_field_comment VARCHAR(1000), target_field_name VARCHAR(128),
  mapping_rule VARCHAR(64) NOT NULL DEFAULT '待补充', field_order INTEGER NOT NULL DEFAULT 0,
  is_deleted CHAR(1) NOT NULL DEFAULT 'N', created_by VARCHAR(64) NOT NULL DEFAULT 'system',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by VARCHAR(64) NOT NULL DEFAULT 'system',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE dwp.p_field_mapping_table ADD CONSTRAINT fk_p_field_mapping_data_source
  FOREIGN KEY (data_source_id) REFERENCES dwp.p_data_source(source_id) ON DELETE RESTRICT;
ALTER TABLE dwp.p_field_mapping_field ADD CONSTRAINT fk_p_field_mapping_field_table
  FOREIGN KEY (table_pk) REFERENCES dwp.p_field_mapping_table(table_pk) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_p_field_mapping_table_source
  ON dwp.p_field_mapping_table(data_source_id, source_table_name);

CREATE SCHEMA IF NOT EXISTS dwp;
CREATE TABLE IF NOT EXISTS dwp.p_admin_user (
  id BIGINT PRIMARY KEY, username VARCHAR(64) NOT NULL UNIQUE,
  password_hash VARCHAR(512) NOT NULL, display_name VARCHAR(128),
  role VARCHAR(16) NOT NULL DEFAULT 'admin', status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  last_login_at TIMESTAMP, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS dwp.p_asset_domain (
  domain_code VARCHAR(64) PRIMARY KEY, domain_name VARCHAR(256) NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0, is_active CHAR(1) NOT NULL DEFAULT 'Y',
  is_deleted CHAR(1) NOT NULL DEFAULT 'N'
);
CREATE TABLE IF NOT EXISTS dwp.p_asset_layer (
  layer_code VARCHAR(32) PRIMARY KEY, layer_name VARCHAR(128) NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0, is_active CHAR(1) NOT NULL DEFAULT 'Y',
  is_deleted CHAR(1) NOT NULL DEFAULT 'N'
);
CREATE TABLE IF NOT EXISTS dwp.p_asset_table (
  asset_id BIGINT PRIMARY KEY, table_name VARCHAR(256) NOT NULL UNIQUE,
  table_cn_name VARCHAR(256), schema_name VARCHAR(128) NOT NULL DEFAULT 'dwp',
  layer_code VARCHAR(32), domain_code VARCHAR(64), owner_name VARCHAR(128),
  grain_desc VARCHAR(1000), cycle_desc VARCHAR(1000), table_desc VARCHAR(2000),
  field_count INTEGER NOT NULL DEFAULT 0, is_deleted CHAR(1) NOT NULL DEFAULT 'N',
  created_by VARCHAR(64) NOT NULL DEFAULT 'system',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by VARCHAR(64) NOT NULL DEFAULT 'system',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS dwp.p_asset_field (
  field_id BIGINT PRIMARY KEY, asset_id BIGINT NOT NULL, field_name VARCHAR(256) NOT NULL,
  field_cn_name VARCHAR(256), data_type VARCHAR(128), field_order INTEGER NOT NULL DEFAULT 0,
  nullable_flag CHAR(1) NOT NULL DEFAULT 'Y', pk_flag CHAR(1) NOT NULL DEFAULT 'N',
  partition_flag CHAR(1) NOT NULL DEFAULT 'N', enum_desc VARCHAR(2000),
  field_desc VARCHAR(2000), is_deleted CHAR(1) NOT NULL DEFAULT 'N',
  created_by VARCHAR(64) NOT NULL DEFAULT 'system',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by VARCHAR(64) NOT NULL DEFAULT 'system',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS dwp.p_asset_change_log (
  change_id BIGINT PRIMARY KEY, asset_id BIGINT, table_name VARCHAR(256) NOT NULL,
  change_type VARCHAR(64) NOT NULL, change_summary VARCHAR(1000),
  before_json TEXT, after_json TEXT, operator_name VARCHAR(64) NOT NULL DEFAULT 'system',
  change_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS dwp.p_root_category (
  category_id BIGINT PRIMARY KEY, category_name VARCHAR(64) NOT NULL UNIQUE,
  display_order INTEGER NOT NULL DEFAULT 0, is_deleted CHAR(1) NOT NULL DEFAULT 'N',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS dwp.p_root_item (
  root_id BIGINT PRIMARY KEY, root_abbr VARCHAR(64) NOT NULL UNIQUE,
  root_en_name VARCHAR(256), root_cn_name VARCHAR(256) NOT NULL,
  category_name VARCHAR(64) NOT NULL, root_desc VARCHAR(2000),
  is_deleted CHAR(1) NOT NULL DEFAULT 'N', created_by VARCHAR(64) NOT NULL DEFAULT 'system',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by VARCHAR(64) NOT NULL DEFAULT 'system',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS dwp.p_indicator_item (
  indicator_pk BIGINT PRIMARY KEY, indicator_id VARCHAR(64) NOT NULL UNIQUE,
  indicator_name VARCHAR(256) NOT NULL, meaning_desc VARCHAR(4000),
  result_table_name VARCHAR(256), result_field_name VARCHAR(256),
  dimension_code VARCHAR(16) NOT NULL, caliber_desc VARCHAR(1000),
  path_desc VARCHAR(1000), status_code VARCHAR(32) NOT NULL,
  registrar_name VARCHAR(64) NOT NULL, registered_date VARCHAR(10) NOT NULL,
  is_deleted CHAR(1) NOT NULL DEFAULT 'N', created_by VARCHAR(64) NOT NULL DEFAULT 'system',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by VARCHAR(64) NOT NULL DEFAULT 'system',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS dwp.p_indicator_path_config (
  id BIGINT PRIMARY KEY, parent_id BIGINT, path_code VARCHAR(64) NOT NULL UNIQUE,
  path_name VARCHAR(256) NOT NULL, dimension_code VARCHAR(16) NOT NULL,
  path_level SMALLINT NOT NULL, full_path VARCHAR(1000) NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0, status VARCHAR(32) NOT NULL DEFAULT 'enabled',
  remark VARCHAR(1000), created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS dwp.p_operation_log (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  user_id VARCHAR(64), user_name VARCHAR(128), dept_name VARCHAR(128),
  module_name VARCHAR(64) NOT NULL, operation_type VARCHAR(32) NOT NULL,
  operation_object VARCHAR(512), operation_desc VARCHAR(1024),
  request_method VARCHAR(16), request_url VARCHAR(512), request_params TEXT,
  result_status VARCHAR(16) NOT NULL DEFAULT 'success', error_message TEXT,
  ip_address VARCHAR(64), user_agent VARCHAR(512), cost_time_ms INTEGER NOT NULL DEFAULT 0,
  remark VARCHAR(512), created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE SCHEMA IF NOT EXISTS dwp;
CREATE TABLE IF NOT EXISTS dwp.p_menu (
  menu_id BIGINT PRIMARY KEY, menu_code VARCHAR(64) NOT NULL UNIQUE,
  menu_name VARCHAR(128) NOT NULL, menu_icon VARCHAR(64) NOT NULL DEFAULT 'grid',
  menu_path VARCHAR(256), display_order INTEGER NOT NULL DEFAULT 0,
  nav_placement VARCHAR(16) NOT NULL DEFAULT 'more',
  admin_only CHAR(1) NOT NULL DEFAULT 'N', is_active CHAR(1) NOT NULL DEFAULT 'Y',
  menu_desc VARCHAR(512), remark VARCHAR(1000),
  created_by VARCHAR(64) NOT NULL DEFAULT 'system',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by VARCHAR(64) NOT NULL DEFAULT 'system',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS dwp.p_code_category (
  category_id BIGINT PRIMARY KEY, category_code VARCHAR(64) NOT NULL UNIQUE,
  category_name VARCHAR(128) NOT NULL, category_desc VARCHAR(512),
  display_order INTEGER NOT NULL DEFAULT 0, is_active CHAR(1) NOT NULL DEFAULT 'Y',
  remark VARCHAR(1000), created_by VARCHAR(64) NOT NULL DEFAULT 'system',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by VARCHAR(64) NOT NULL DEFAULT 'system',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS dwp.p_code_item (
  item_id BIGINT PRIMARY KEY, category_code VARCHAR(64) NOT NULL,
  item_code VARCHAR(64) NOT NULL, item_name VARCHAR(128) NOT NULL,
  item_value VARCHAR(256), item_desc VARCHAR(512),
  display_order INTEGER NOT NULL DEFAULT 0, ext_json TEXT,
  is_active CHAR(1) NOT NULL DEFAULT 'Y', remark VARCHAR(1000),
  created_by VARCHAR(64) NOT NULL DEFAULT 'system',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by VARCHAR(64) NOT NULL DEFAULT 'system',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(category_code, item_code)
);
CREATE TABLE IF NOT EXISTS dwp.p_root_change_log (
  change_id BIGINT PRIMARY KEY, root_id BIGINT, root_abbr VARCHAR(64) NOT NULL,
  change_type VARCHAR(64) NOT NULL, change_summary VARCHAR(512),
  before_json TEXT, after_json TEXT,
  operator_name VARCHAR(64) NOT NULL DEFAULT 'system',
  change_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS dwp.p_indicator_change_log (
  change_id BIGINT PRIMARY KEY, indicator_pk BIGINT, indicator_id VARCHAR(64) NOT NULL,
  change_type VARCHAR(64) NOT NULL, change_summary VARCHAR(512),
  before_json TEXT, after_json TEXT,
  operator_name VARCHAR(64) NOT NULL DEFAULT 'system',
  change_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
