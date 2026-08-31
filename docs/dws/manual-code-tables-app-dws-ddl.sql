-- data-asset-portal application DDL
-- module: manual-code-tables
-- scope: warehouse manual code-table metadata registry
-- schema: dwp
-- target: dws-compatible

CREATE TABLE IF NOT EXISTS dwp.p_manual_code_table (
    table_id     BIGINT       NOT NULL,
    table_code   VARCHAR(64)  NOT NULL,
    table_name   VARCHAR(128) NOT NULL,
    table_style  VARCHAR(16)  NOT NULL,
    owner_name   VARCHAR(64),
    status_code  VARCHAR(16)  NOT NULL DEFAULT 'enabled',
    remark       VARCHAR(1000),
    created_by   VARCHAR(64)  NOT NULL DEFAULT 'system',
    created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by   VARCHAR(64)  NOT NULL DEFAULT 'system',
    updated_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (status_code IN ('enabled', 'disabled')),
    PRIMARY KEY (table_id)
)
DISTRIBUTE BY REPLICATION;

CREATE UNIQUE INDEX idx_p_manual_code_table_code
    ON dwp.p_manual_code_table (table_code);
CREATE INDEX idx_p_manual_code_table_filter
    ON dwp.p_manual_code_table (table_style, status_code, updated_at);
