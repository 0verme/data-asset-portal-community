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
