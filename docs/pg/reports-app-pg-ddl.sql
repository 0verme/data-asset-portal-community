-- data-asset-portal application DDL
-- module: reports
-- scope: report metadata ledger
-- schema: dwp
-- target: postgres

CREATE SCHEMA IF NOT EXISTS dwp;

CREATE TABLE IF NOT EXISTS dwp.p_report_asset (
    report_pk                BIGINT        NOT NULL,
    report_code              VARCHAR(64)   NOT NULL,
    report_name              VARCHAR(256)  NOT NULL,
    report_alias             VARCHAR(256),
    report_type              VARCHAR(64)   NOT NULL,
    domain_name              VARCHAR(128),
    freq_code                VARCHAR(32),
    stat_period_code         VARCHAR(32),
    -- Deprecated compatibility storage: application semantics are statCaliber/dataDelay.
    date_caliber_code        VARCHAR(32),
    date_caliber_other_desc  VARCHAR(500),
    data_timeliness_code     VARCHAR(32),
    data_timeliness_custom_desc VARCHAR(500),
    status_code              VARCHAR(32)   NOT NULL DEFAULT 'enabled',
    effective_date           VARCHAR(10),
    expire_date              VARCHAR(10),
    purpose_desc             VARCHAR(2000),
    stat_object_desc         VARCHAR(1000),
    stat_scope_desc          VARCHAR(1000),
    time_caliber_desc        VARCHAR(1000),
    filter_condition_desc    VARCHAR(2000),
    special_rule_desc        VARCHAR(2000),
    owner_dept_name          VARCHAR(128)  NOT NULL,
    owner_name               VARCHAR(64)   NOT NULL,
    maintainer_name          VARCHAR(64),
    related_tables_json      JSONB         NOT NULL DEFAULT '[]'::jsonb,
    related_indicators_json  JSONB         NOT NULL DEFAULT '[]'::jsonb,
    remark_desc              VARCHAR(2000),
    is_deleted               CHAR(1)       NOT NULL DEFAULT 'N',
    created_by               VARCHAR(64)   NOT NULL DEFAULT 'system',
    created_at               TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by               VARCHAR(64)   NOT NULL DEFAULT 'system',
    updated_at               TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_p_report_asset PRIMARY KEY (report_pk),
    CONSTRAINT uk_p_report_asset_01 UNIQUE (report_code),
    CONSTRAINT ck_p_report_asset_tables_json CHECK (jsonb_typeof(related_tables_json) = 'array'),
    CONSTRAINT ck_p_report_asset_indicators_json CHECK (jsonb_typeof(related_indicators_json) = 'array')
);

CREATE INDEX IF NOT EXISTS idx_p_report_asset_ix_01
    ON dwp.p_report_asset (status_code, report_type, domain_name);
