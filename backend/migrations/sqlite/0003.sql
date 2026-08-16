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
