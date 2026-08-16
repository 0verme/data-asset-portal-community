-- data-asset-portal application DDL
-- module: roots
-- scope: root categories, root items, and root change logs
-- schema: dwp
-- target: postgres

CREATE SCHEMA IF NOT EXISTS dwp;

CREATE TABLE IF NOT EXISTS dwp.p_root_category (
    category_id         BIGINT       NOT NULL,
    category_name       VARCHAR(64)  NOT NULL,
    display_order       INTEGER      NOT NULL DEFAULT 0,
    is_deleted          CHAR(1)      NOT NULL DEFAULT 'N',
    created_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_p_root_category_uk_01
    ON dwp.p_root_category (category_name);

CREATE TABLE IF NOT EXISTS dwp.p_root_item (
    root_id             BIGINT        NOT NULL,
    root_abbr           VARCHAR(64)   NOT NULL,
    root_en_name        VARCHAR(256),
    root_cn_name        VARCHAR(256)  NOT NULL,
    category_name       VARCHAR(64)   NOT NULL,
    root_desc           VARCHAR(2000),
    is_deleted          CHAR(1)       NOT NULL DEFAULT 'N',
    created_by          VARCHAR(64)   NOT NULL DEFAULT 'system',
    created_at          TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by          VARCHAR(64)   NOT NULL DEFAULT 'system',
    updated_at          TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_p_root_item_uk_01
    ON dwp.p_root_item (root_abbr);

CREATE INDEX IF NOT EXISTS idx_p_root_item_ix_01
    ON dwp.p_root_item (category_name);

CREATE TABLE IF NOT EXISTS dwp.p_root_change_log (
    change_id           BIGINT        NOT NULL,
    root_id             BIGINT,
    root_abbr           VARCHAR(64)   NOT NULL,
    change_type         VARCHAR(64)   NOT NULL,
    change_summary      VARCHAR(512),
    before_json         TEXT,
    after_json          TEXT,
    operator_name       VARCHAR(64)   NOT NULL DEFAULT 'system',
    change_time         TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_p_root_change_log_ix_01
    ON dwp.p_root_change_log (root_abbr, change_time);

