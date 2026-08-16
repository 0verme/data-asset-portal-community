-- data-asset-portal application DDL
-- module: operation-logs
-- scope: user operation audit logs
-- schema: dwp
-- target: postgres

CREATE SCHEMA IF NOT EXISTS dwp;

CREATE SEQUENCE IF NOT EXISTS dwp.p_operation_log_id_seq;

CREATE TABLE IF NOT EXISTS dwp.p_operation_log (
    id                  BIGINT         NOT NULL DEFAULT nextval('dwp.p_operation_log_id_seq') PRIMARY KEY,
    user_id             VARCHAR(64),
    user_name           VARCHAR(128),
    dept_name           VARCHAR(128),
    module_name         VARCHAR(64)    NOT NULL,
    operation_type      VARCHAR(32)    NOT NULL,
    operation_object    VARCHAR(512),
    operation_desc      VARCHAR(1024),
    request_method      VARCHAR(16),
    request_url         VARCHAR(512),
    request_params      TEXT,
    result_status       VARCHAR(16)    NOT NULL DEFAULT 'success',
    error_message       TEXT,
    ip_address          VARCHAR(64),
    user_agent          VARCHAR(512),
    cost_time_ms        INTEGER        NOT NULL DEFAULT 0,
    remark              VARCHAR(512),
    created_at          TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_p_operation_log_ix_01
    ON dwp.p_operation_log (created_at);

CREATE INDEX IF NOT EXISTS idx_p_operation_log_ix_02
    ON dwp.p_operation_log (module_name, operation_type);

CREATE INDEX IF NOT EXISTS idx_p_operation_log_ix_03
    ON dwp.p_operation_log (result_status);
