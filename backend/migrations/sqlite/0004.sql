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
