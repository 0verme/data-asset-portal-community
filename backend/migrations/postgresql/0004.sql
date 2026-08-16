CREATE TABLE IF NOT EXISTS dwp.p_field_mapping_table (
  table_pk BIGINT PRIMARY KEY, data_source_id BIGINT,
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
ALTER TABLE IF EXISTS dwp.p_field_mapping_table ADD COLUMN IF NOT EXISTS data_source_id BIGINT;
DO $$
BEGIN
  IF to_regclass('dwp.p_field_mapping_table') IS NOT NULL THEN
    UPDATE dwp.p_field_mapping_table t
       SET data_source_id = s.source_id
      FROM dwp.p_data_source s
     WHERE t.data_source_id IS NULL
       AND t.upstream_system_id = s.source_id;
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'fk_p_field_mapping_data_source'
    ) THEN
      ALTER TABLE dwp.p_field_mapping_table ADD CONSTRAINT fk_p_field_mapping_data_source
        FOREIGN KEY (data_source_id) REFERENCES dwp.p_data_source(source_id) ON DELETE RESTRICT;
    END IF;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_p_field_mapping_data_source
  ON dwp.p_field_mapping_table(data_source_id);
