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
  asset_id BIGINT PRIMARY KEY, table_name VARCHAR(256) NOT NULL,
  table_cn_name VARCHAR(256), schema_name VARCHAR(128) NOT NULL DEFAULT 'dwp',
  catalog_name VARCHAR(128), database_name VARCHAR(128),
  source_key VARCHAR(64), asset_type VARCHAR(64), external_id VARCHAR(256),
  qualified_name VARCHAR(512), layer_code VARCHAR(32), domain_code VARCHAR(64),
  owner_name VARCHAR(128), grain_desc VARCHAR(1000), cycle_desc VARCHAR(1000),
  table_desc VARCHAR(2000), field_count INTEGER NOT NULL DEFAULT 0,
  is_deleted CHAR(1) NOT NULL DEFAULT 'N',
  created_by VARCHAR(64) NOT NULL DEFAULT 'system',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by VARCHAR(64) NOT NULL DEFAULT 'system',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (source_key, asset_type, external_id)
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

-- Open repository modules: upstream, push, report, manual code tables, lineage.
CREATE TABLE IF NOT EXISTS dwp.p_upstream_system (
    system_pk BIGINT PRIMARY KEY,
    data_source_id BIGINT,
    system_id VARCHAR(64) NOT NULL UNIQUE,
    system_abbr VARCHAR(32) NOT NULL,
    system_name VARCHAR(256) NOT NULL,
    db_type VARCHAR(64) NOT NULL,
    host_name VARCHAR(256) NOT NULL,
    db_name VARCHAR(256),
    schema_name VARCHAR(256),
    status_code VARCHAR(32) NOT NULL DEFAULT 'enabled',
    owner_name VARCHAR(128),
    dept_name VARCHAR(128),
    system_desc VARCHAR(2000),
    unload_count INTEGER NOT NULL DEFAULT 0,
    is_deleted CHAR(1) NOT NULL DEFAULT 'N',
    created_by VARCHAR(64) NOT NULL DEFAULT 'system',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by VARCHAR(64) NOT NULL DEFAULT 'system',
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (data_source_id) REFERENCES dwp.p_data_source(source_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_p_upstream_system_data_source
    ON dwp.p_upstream_system (data_source_id);
CREATE INDEX IF NOT EXISTS idx_p_upstream_system_ix_01
    ON dwp.p_upstream_system (status_code, db_type);

CREATE TABLE IF NOT EXISTS dwp.p_upstream_unload_time (
    time_pk BIGINT PRIMARY KEY,
    system_pk BIGINT NOT NULL,
    unload_time VARCHAR(8) NOT NULL,
    display_order INTEGER NOT NULL DEFAULT 0,
    is_deleted CHAR(1) NOT NULL DEFAULT 'N',
    created_by VARCHAR(64) NOT NULL DEFAULT 'system',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by VARCHAR(64) NOT NULL DEFAULT 'system',
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (system_pk, unload_time),
    FOREIGN KEY (system_pk) REFERENCES dwp.p_upstream_system(system_pk) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_p_upstream_unload_time_ix_01
    ON dwp.p_upstream_unload_time (system_pk, display_order);

CREATE TABLE IF NOT EXISTS dwp.p_upstream_change_log (
    change_id BIGINT PRIMARY KEY,
    system_pk BIGINT,
    system_id VARCHAR(64) NOT NULL,
    change_type VARCHAR(64) NOT NULL,
    change_summary VARCHAR(512),
    before_json TEXT,
    after_json TEXT,
    operator_name VARCHAR(64) NOT NULL DEFAULT 'system',
    change_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_p_upstream_change_log_ix_01
    ON dwp.p_upstream_change_log (system_id, change_time);

CREATE TABLE IF NOT EXISTS dwp.p_push_system (
    system_id BIGINT PRIMARY KEY,
    master_system_id BIGINT,
    system_code VARCHAR(64) NOT NULL UNIQUE,
    system_name VARCHAR(256) NOT NULL,
    system_abbr VARCHAR(32) NOT NULL,
    protocol_type VARCHAR(32) NOT NULL,
    host_name VARCHAR(256) NOT NULL,
    port_no INTEGER NOT NULL,
    account_name VARCHAR(128),
    auth_type VARCHAR(64),
    contact_name VARCHAR(128),
    data_developer_contact_name VARCHAR(128),
    dept_name VARCHAR(128),
    system_desc VARCHAR(2000),
    status_code VARCHAR(32) NOT NULL DEFAULT 'enabled',
    importance_level_code VARCHAR(16) NOT NULL DEFAULT 'normal',
    latest_output_time VARCHAR(5),
    job_count INTEGER NOT NULL DEFAULT 0,
    is_deleted CHAR(1) NOT NULL DEFAULT 'N',
    created_by VARCHAR(64) NOT NULL DEFAULT 'system',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by VARCHAR(64) NOT NULL DEFAULT 'system',
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (master_system_id) REFERENCES dwp.p_system(system_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_p_push_system_master
    ON dwp.p_push_system (master_system_id);
CREATE INDEX IF NOT EXISTS idx_p_push_system_ix_01
    ON dwp.p_push_system (status_code, protocol_type, dept_name);

CREATE TABLE IF NOT EXISTS dwp.p_push_job (
    job_id BIGINT PRIMARY KEY,
    system_id BIGINT NOT NULL,
    job_code VARCHAR(128) NOT NULL,
    job_name VARCHAR(256) NOT NULL,
    source_path VARCHAR(1000),
    source_file_name VARCHAR(512),
    target_path VARCHAR(1000),
    target_file_name VARCHAR(512) NOT NULL,
    freq_desc VARCHAR(200),
    freq_type VARCHAR(64),
    delimiter_code VARCHAR(32),
    encoding_type VARCHAR(64),
    row_count_desc VARCHAR(200),
    enabled_flag CHAR(1) NOT NULL DEFAULT 'Y',
    job_desc VARCHAR(2000),
    field_count INTEGER NOT NULL DEFAULT 0,
    is_deleted CHAR(1) NOT NULL DEFAULT 'N',
    created_by VARCHAR(64) NOT NULL DEFAULT 'system',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by VARCHAR(64) NOT NULL DEFAULT 'system',
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (system_id, job_code),
    FOREIGN KEY (system_id) REFERENCES dwp.p_push_system(system_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_p_push_job_ix_01
    ON dwp.p_push_job (system_id, enabled_flag, freq_type);
CREATE INDEX IF NOT EXISTS idx_p_push_job_ix_02
    ON dwp.p_push_job (system_id, is_deleted, job_code);

CREATE TABLE IF NOT EXISTS dwp.p_push_job_field (
    field_id BIGINT PRIMARY KEY,
    job_id BIGINT NOT NULL,
    field_name VARCHAR(128) NOT NULL,
    field_cn_name VARCHAR(256) NOT NULL,
    field_order INTEGER NOT NULL DEFAULT 0,
    source_code VARCHAR(64),
    data_type VARCHAR(128) NOT NULL,
    field_meaning VARCHAR(2000),
    is_deleted CHAR(1) NOT NULL DEFAULT 'N',
    created_by VARCHAR(64) NOT NULL DEFAULT 'system',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by VARCHAR(64) NOT NULL DEFAULT 'system',
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (job_id, field_name),
    FOREIGN KEY (job_id) REFERENCES dwp.p_push_job(job_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_p_push_job_field_ix_01
    ON dwp.p_push_job_field (job_id, field_order);

CREATE TABLE IF NOT EXISTS dwp.p_push_change_log (
    change_id BIGINT PRIMARY KEY,
    system_id BIGINT,
    job_id BIGINT,
    object_type VARCHAR(32) NOT NULL,
    object_code VARCHAR(128) NOT NULL,
    change_type VARCHAR(64) NOT NULL,
    change_summary VARCHAR(1000),
    before_json TEXT,
    after_json TEXT,
    operator_name VARCHAR(64) NOT NULL DEFAULT 'system',
    change_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    trace_id VARCHAR(128)
);
CREATE INDEX IF NOT EXISTS idx_p_push_change_log_ix_01
    ON dwp.p_push_change_log (system_id, change_time);
CREATE INDEX IF NOT EXISTS idx_p_push_change_log_ix_02
    ON dwp.p_push_change_log (job_id, change_time);
CREATE INDEX IF NOT EXISTS idx_p_push_change_log_ix_03
    ON dwp.p_push_change_log (object_type, object_code, change_time);

CREATE TABLE IF NOT EXISTS dwp.p_report_asset (
    report_pk BIGINT PRIMARY KEY,
    report_code VARCHAR(64) NOT NULL UNIQUE,
    report_name VARCHAR(256) NOT NULL,
    report_alias VARCHAR(256),
    report_type VARCHAR(64) NOT NULL,
    domain_name VARCHAR(128),
    freq_code VARCHAR(32),
    stat_period_code VARCHAR(32),
    date_caliber_code VARCHAR(32),
    date_caliber_other_desc VARCHAR(500),
    data_timeliness_code VARCHAR(32),
    data_timeliness_custom_desc VARCHAR(500),
    status_code VARCHAR(32) NOT NULL DEFAULT 'enabled',
    effective_date VARCHAR(10),
    expire_date VARCHAR(10),
    purpose_desc VARCHAR(2000),
    stat_object_desc VARCHAR(1000),
    stat_scope_desc VARCHAR(1000),
    time_caliber_desc VARCHAR(1000),
    filter_condition_desc VARCHAR(2000),
    special_rule_desc VARCHAR(2000),
    owner_dept_name VARCHAR(128) NOT NULL,
    owner_name VARCHAR(64) NOT NULL,
    maintainer_name VARCHAR(64),
    related_tables_json TEXT NOT NULL DEFAULT '[]',
    related_indicators_json TEXT NOT NULL DEFAULT '[]',
    remark_desc VARCHAR(2000),
    is_deleted CHAR(1) NOT NULL DEFAULT 'N',
    created_by VARCHAR(64) NOT NULL DEFAULT 'system',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by VARCHAR(64) NOT NULL DEFAULT 'system',
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_p_report_asset_ix_01
    ON dwp.p_report_asset (status_code, report_type, domain_name);

CREATE TABLE IF NOT EXISTS dwp.p_manual_code_table (
    table_id BIGINT PRIMARY KEY,
    table_code VARCHAR(64) NOT NULL UNIQUE,
    table_name VARCHAR(128) NOT NULL,
    table_style VARCHAR(16) NOT NULL,
    owner_name VARCHAR(64),
    status_code VARCHAR(16) NOT NULL DEFAULT 'active',
    remark VARCHAR(1000),
    created_by VARCHAR(64) NOT NULL DEFAULT 'system',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by VARCHAR(64) NOT NULL DEFAULT 'system',
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (table_style IN ('enum', 'dim', 'status', 'map', 'custom')),
    CHECK (status_code IN ('active', 'draft', 'disabled'))
);
CREATE INDEX IF NOT EXISTS idx_p_manual_code_table_filter
    ON dwp.p_manual_code_table (table_style, status_code, updated_at);

CREATE TABLE IF NOT EXISTS dwp.p_lineage_snapshot (
    snapshot_id VARCHAR(128) PRIMARY KEY,
    generated_at TIMESTAMP NOT NULL,
    generator_name VARCHAR(128) NOT NULL,
    generator_version VARCHAR(64) NOT NULL,
    import_batch_id VARCHAR(128) NOT NULL UNIQUE,
    source_key VARCHAR(64),
    content_hash VARCHAR(64),
    ingestion_id VARCHAR(64),
    status_code VARCHAR(16) NOT NULL,
    CHECK (status_code IN ('ACTIVE', 'INACTIVE'))
);
CREATE TABLE IF NOT EXISTS dwp.p_lineage_node (
    snapshot_id VARCHAR(128) NOT NULL,
    node_id VARCHAR(256) NOT NULL,
    kind_code VARCHAR(32) NOT NULL,
    node_name VARCHAR(256) NOT NULL,
    display_name VARCHAR(512) NOT NULL,
    namespace_name VARCHAR(128) NOT NULL,
    attributes_json TEXT NOT NULL,
    PRIMARY KEY (snapshot_id, node_id),
    FOREIGN KEY (snapshot_id) REFERENCES dwp.p_lineage_snapshot(snapshot_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_p_lineage_node_lookup
    ON dwp.p_lineage_node (snapshot_id, kind_code, node_name);
CREATE TABLE IF NOT EXISTS dwp.p_lineage_edge (
    snapshot_id VARCHAR(128) NOT NULL,
    edge_id VARCHAR(256) NOT NULL,
    source_node_id VARCHAR(256) NOT NULL,
    target_node_id VARCHAR(256) NOT NULL,
    kind_code VARCHAR(64) NOT NULL,
    evidence_type VARCHAR(64) NOT NULL,
    source_record_id VARCHAR(256) NOT NULL,
    evidence_description VARCHAR(1000) NOT NULL,
    confidence_code VARCHAR(16) NOT NULL,
    generated_at TIMESTAMP NOT NULL,
    diagnostics_json TEXT NOT NULL,
    PRIMARY KEY (snapshot_id, edge_id),
    FOREIGN KEY (snapshot_id) REFERENCES dwp.p_lineage_snapshot(snapshot_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_p_lineage_edge_source
    ON dwp.p_lineage_edge (snapshot_id, source_node_id);
CREATE INDEX IF NOT EXISTS idx_p_lineage_edge_target
    ON dwp.p_lineage_edge (snapshot_id, target_node_id);
