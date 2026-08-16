ALTER TABLE dwp.p_field_mapping_table ADD COLUMN IF NOT EXISTS data_source_id BIGINT;
UPDATE dwp.p_field_mapping_table SET data_source_id = upstream_system_id WHERE data_source_id IS NULL;
