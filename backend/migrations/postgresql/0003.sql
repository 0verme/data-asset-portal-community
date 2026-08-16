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
ALTER TABLE IF EXISTS dwp.p_api_asset ADD COLUMN IF NOT EXISTS system_id BIGINT;
DO $$
BEGIN
  IF to_regclass('dwp.p_api_asset') IS NOT NULL THEN
    UPDATE dwp.p_api_asset a
       SET system_id = s.system_id
      FROM dwp.p_system s
     WHERE a.system_id IS NULL
       AND a.downstream_system_id = s.system_id;
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'fk_p_api_asset_system'
    ) THEN
      ALTER TABLE dwp.p_api_asset ADD CONSTRAINT fk_p_api_asset_system
        FOREIGN KEY (system_id) REFERENCES dwp.p_system(system_id) ON DELETE RESTRICT;
    END IF;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_p_api_asset_system ON dwp.p_api_asset(system_id);
