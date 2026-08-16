-- data-asset-portal application DDL
-- module: upstream
-- scope: upstream systems, unload schedules, and upstream change logs
-- schema: dwp
-- target: postgres

CREATE SCHEMA IF NOT EXISTS dwp;

CREATE TABLE IF NOT EXISTS dwp.p_upstream_system (
    system_pk           BIGINT        NOT NULL,
    system_id           VARCHAR(64)   NOT NULL,
    system_abbr         VARCHAR(32)   NOT NULL,
    system_name         VARCHAR(256)  NOT NULL,
    db_type             VARCHAR(64)   NOT NULL,
    host_name           VARCHAR(256)  NOT NULL,
    db_name             VARCHAR(256),
    schema_name         VARCHAR(256),
    status_code         VARCHAR(32)   NOT NULL DEFAULT 'enabled',
    owner_name          VARCHAR(128),
    dept_name           VARCHAR(128),
    system_desc         VARCHAR(2000),
    unload_count        INTEGER       NOT NULL DEFAULT 0,
    is_deleted          CHAR(1)       NOT NULL DEFAULT 'N',
    created_by          VARCHAR(64)   NOT NULL DEFAULT 'system',
    created_at          TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by          VARCHAR(64)   NOT NULL DEFAULT 'system',
    updated_at          TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_p_upstream_system_uk_01
    ON dwp.p_upstream_system (system_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_p_upstream_system_uk_02
    ON dwp.p_upstream_system (system_pk);

CREATE INDEX IF NOT EXISTS idx_p_upstream_system_ix_01
    ON dwp.p_upstream_system (status_code, db_type);

CREATE TABLE IF NOT EXISTS dwp.p_upstream_unload_time (
    time_pk             BIGINT        NOT NULL,
    system_pk           BIGINT        NOT NULL,
    unload_time         VARCHAR(8)    NOT NULL,
    display_order       INTEGER       NOT NULL DEFAULT 0,
    is_deleted          CHAR(1)       NOT NULL DEFAULT 'N',
    created_by          VARCHAR(64)   NOT NULL DEFAULT 'system',
    created_at          TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by          VARCHAR(64)   NOT NULL DEFAULT 'system',
    updated_at          TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_p_upstream_unload_time_uk_01
    ON dwp.p_upstream_unload_time (system_pk, unload_time);

CREATE INDEX IF NOT EXISTS idx_p_upstream_unload_time_ix_01
    ON dwp.p_upstream_unload_time (system_pk, display_order);

CREATE TABLE IF NOT EXISTS dwp.p_upstream_change_log (
    change_id           BIGINT        NOT NULL,
    system_pk           BIGINT,
    system_id           VARCHAR(64)   NOT NULL,
    change_type         VARCHAR(64)   NOT NULL,
    change_summary      VARCHAR(512),
    before_json         TEXT,
    after_json          TEXT,
    operator_name       VARCHAR(64)   NOT NULL DEFAULT 'system',
    change_time         TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_p_upstream_change_log_ix_01
    ON dwp.p_upstream_change_log (system_id, change_time);

