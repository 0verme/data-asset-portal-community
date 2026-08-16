-- data-asset-portal application DDL
-- module: manual-code-tables
-- scope: warehouse manual code-table metadata registry
-- schema: dwp
-- target: postgres

CREATE SCHEMA IF NOT EXISTS dwp;

CREATE TABLE IF NOT EXISTS dwp.p_manual_code_table (
    table_id     BIGINT PRIMARY KEY,
    table_code   VARCHAR(64)  NOT NULL UNIQUE,
    table_name   VARCHAR(128) NOT NULL,
    table_style  VARCHAR(16)  NOT NULL CHECK (table_style IN ('enum', 'dim', 'status', 'map', 'custom')),
    owner_name   VARCHAR(64),
    status_code  VARCHAR(16)  NOT NULL DEFAULT 'active' CHECK (status_code IN ('active', 'draft', 'disabled')),
    remark       VARCHAR(1000),
    created_by   VARCHAR(64)  NOT NULL DEFAULT 'system',
    created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by   VARCHAR(64)  NOT NULL DEFAULT 'system',
    updated_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_p_manual_code_table_filter
    ON dwp.p_manual_code_table (table_style, status_code, updated_at);
