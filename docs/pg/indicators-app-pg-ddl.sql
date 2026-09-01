-- data-asset-portal application DDL
-- module: indicators
-- scope: indicator items and indicator change logs
-- schema: dwp
-- target: postgres

CREATE SCHEMA IF NOT EXISTS dwp;

CREATE TABLE IF NOT EXISTS dwp.p_indicator_item (
    indicator_pk        BIGINT        NOT NULL,
    indicator_id        VARCHAR(64)   NOT NULL,
    indicator_name      VARCHAR(256)  NOT NULL,
    meaning_desc        VARCHAR(4000),
    result_table_name   VARCHAR(256),
    result_field_name   VARCHAR(256),
    source_asset_id     BIGINT,
    result_field_id     BIGINT,
    aggregation_code    VARCHAR(32),
    semantic_state      VARCHAR(32)   NOT NULL DEFAULT 'candidate',
    dimension_code      VARCHAR(16)   NOT NULL,
    caliber_desc        VARCHAR(1000),
    path_desc           VARCHAR(1000),
    status_code         VARCHAR(32)   NOT NULL,
    registrar_name      VARCHAR(64)   NOT NULL,
    registered_date     VARCHAR(10)   NOT NULL,
    is_deleted          CHAR(1)       NOT NULL DEFAULT 'N',
    created_by          VARCHAR(64)   NOT NULL DEFAULT 'system',
    created_at          TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by          VARCHAR(64)   NOT NULL DEFAULT 'system',
    updated_at          TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_p_indicator_item_uk_01
    ON dwp.p_indicator_item (indicator_id);

CREATE INDEX IF NOT EXISTS idx_p_indicator_item_ix_01
    ON dwp.p_indicator_item (dimension_code, status_code, registered_date);

CREATE INDEX IF NOT EXISTS idx_p_indicator_item_semantic_ref
    ON dwp.p_indicator_item (source_asset_id, result_field_id);

CREATE TABLE IF NOT EXISTS dwp.p_indicator_path_config (
    id                  BIGINT        NOT NULL PRIMARY KEY,
    parent_id           BIGINT,
    path_code           VARCHAR(64)   NOT NULL,
    path_name           VARCHAR(256)  NOT NULL,
    dimension_code      VARCHAR(16)   NOT NULL,
    path_level          SMALLINT      NOT NULL,
    full_path           VARCHAR(1000) NOT NULL,
    sort_order          INTEGER       NOT NULL DEFAULT 0,
    status              VARCHAR(32)   NOT NULL DEFAULT 'enabled',
    remark              VARCHAR(1000),
    created_at          TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_p_indicator_path_config_uk_01
    ON dwp.p_indicator_path_config (path_code);

CREATE UNIQUE INDEX IF NOT EXISTS idx_p_indicator_path_config_uk_02
    ON dwp.p_indicator_path_config (full_path);

CREATE INDEX IF NOT EXISTS idx_p_indicator_path_config_ix_01
    ON dwp.p_indicator_path_config (dimension_code, status, path_level, sort_order);

CREATE TABLE IF NOT EXISTS dwp.p_indicator_change_log (
    change_id           BIGINT        NOT NULL,
    indicator_pk        BIGINT,
    indicator_id        VARCHAR(64)   NOT NULL,
    change_type         VARCHAR(64)   NOT NULL,
    change_summary      VARCHAR(512),
    before_json         TEXT,
    after_json          TEXT,
    operator_name       VARCHAR(64)   NOT NULL DEFAULT 'system',
    change_time         TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_p_indicator_change_log_ix_01
    ON dwp.p_indicator_change_log (indicator_id, change_time);
