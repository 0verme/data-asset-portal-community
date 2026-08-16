-- data-asset-portal application DDL
-- module: field-mappings
-- scope: source tables, field mappings, and change logs
-- schema: dwp
-- target: postgres

CREATE SCHEMA IF NOT EXISTS dwp;

CREATE TABLE IF NOT EXISTS dwp.p_field_mapping_table (
    table_pk             BIGINT                 NOT NULL,
    data_source_id       BIGINT,
    upstream_system_id   BIGINT                 NOT NULL,
    source_table_name    VARCHAR(128)           NOT NULL,
    source_table_cn      VARCHAR(256),
    target_layer_code    VARCHAR(32)            NOT NULL DEFAULT 'DWF',
    target_table_name    VARCHAR(128),
    load_mode            VARCHAR(32),
    field_total_count    INTEGER                NOT NULL DEFAULT 0,
    mapped_field_count   INTEGER                NOT NULL DEFAULT 0,
    latest_mapping_time  TIMESTAMP,
    table_desc           VARCHAR(2000),
    is_deleted           CHAR(1)                NOT NULL DEFAULT 'N',
    created_by           VARCHAR(64)            NOT NULL DEFAULT 'system',
    created_at           TIMESTAMP              NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by           VARCHAR(64)            NOT NULL DEFAULT 'system',
    updated_at           TIMESTAMP              NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_p_field_mapping_table_upstream
        FOREIGN KEY (upstream_system_id)
        REFERENCES dwp.p_upstream_system (system_pk)
        ON DELETE RESTRICT
);

COMMENT ON TABLE dwp.p_field_mapping_table IS '字段映射源表到目标表映射主表';
COMMENT ON COLUMN dwp.p_field_mapping_table.table_pk IS '源表主键';
COMMENT ON COLUMN dwp.p_field_mapping_table.data_source_id IS '公共数据源主键（Community 关联，迁移后由 upstream_system_id 回填）';
COMMENT ON COLUMN dwp.p_field_mapping_table.upstream_system_id IS '所属上游卸数系统主键';
COMMENT ON COLUMN dwp.p_field_mapping_table.source_table_name IS '源表英文名';
COMMENT ON COLUMN dwp.p_field_mapping_table.source_table_cn IS '源表中文名';
COMMENT ON COLUMN dwp.p_field_mapping_table.target_layer_code IS '目标分层，当前默认 DWF';
COMMENT ON COLUMN dwp.p_field_mapping_table.target_table_name IS '目标表名';
COMMENT ON COLUMN dwp.p_field_mapping_table.load_mode IS '入仓方式：full/incr/incr_zip/full_zip';
COMMENT ON COLUMN dwp.p_field_mapping_table.field_total_count IS '源表字段总数';
COMMENT ON COLUMN dwp.p_field_mapping_table.mapped_field_count IS '已映射字段数';
COMMENT ON COLUMN dwp.p_field_mapping_table.latest_mapping_time IS '最近一次映射维护时间';

CREATE UNIQUE INDEX IF NOT EXISTS idx_p_field_mapping_table_uk_01
    ON dwp.p_field_mapping_table (upstream_system_id, source_table_name);

CREATE INDEX IF NOT EXISTS idx_p_field_mapping_table_ix_01
    ON dwp.p_field_mapping_table (target_table_name, latest_mapping_time);

CREATE INDEX IF NOT EXISTS idx_p_field_mapping_table_ix_02
    ON dwp.p_field_mapping_table (is_deleted, upstream_system_id, table_pk);


CREATE TABLE IF NOT EXISTS dwp.p_field_mapping_field (
    field_pk             BIGINT                 NOT NULL,
    table_pk             BIGINT                 NOT NULL,
    source_field_name    VARCHAR(128)           NOT NULL,
    source_field_type    VARCHAR(128),
    source_field_comment VARCHAR(1000),
    target_field_name    VARCHAR(128),
    mapping_rule         VARCHAR(64)            NOT NULL DEFAULT '待补充',
    field_order          INTEGER                NOT NULL DEFAULT 0,
    is_deleted           CHAR(1)                NOT NULL DEFAULT 'N',
    created_by           VARCHAR(64)            NOT NULL DEFAULT 'system',
    created_at           TIMESTAMP              NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by           VARCHAR(64)            NOT NULL DEFAULT 'system',
    updated_at           TIMESTAMP              NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE dwp.p_field_mapping_field IS '字段映射明细表';
COMMENT ON COLUMN dwp.p_field_mapping_field.field_pk IS '字段映射主键';
COMMENT ON COLUMN dwp.p_field_mapping_field.table_pk IS '所属源表主键';
COMMENT ON COLUMN dwp.p_field_mapping_field.source_field_name IS '源字段英文名';
COMMENT ON COLUMN dwp.p_field_mapping_field.source_field_type IS '源字段类型';
COMMENT ON COLUMN dwp.p_field_mapping_field.source_field_comment IS '源字段注释';
COMMENT ON COLUMN dwp.p_field_mapping_field.target_field_name IS '目标字段英文名';
COMMENT ON COLUMN dwp.p_field_mapping_field.mapping_rule IS '映射规则，如直接映射/字典翻译/日期格式化/待补充';
COMMENT ON COLUMN dwp.p_field_mapping_field.field_order IS '字段顺序';

CREATE UNIQUE INDEX IF NOT EXISTS idx_p_field_mapping_field_uk_01
    ON dwp.p_field_mapping_field (table_pk, source_field_name, target_field_name);

CREATE INDEX IF NOT EXISTS idx_p_field_mapping_field_ix_01
    ON dwp.p_field_mapping_field (target_field_name, mapping_rule);

CREATE INDEX IF NOT EXISTS idx_p_field_mapping_field_ix_02
    ON dwp.p_field_mapping_field (table_pk, is_deleted, field_order, source_field_name);


CREATE TABLE IF NOT EXISTS dwp.p_field_mapping_change_log (
    change_id            BIGINT                 NOT NULL,
    table_pk             BIGINT,
    field_pk             BIGINT,
    change_type          VARCHAR(64)            NOT NULL,
    change_summary       VARCHAR(1000),
    before_json          TEXT,
    after_json           TEXT,
    operator_name        VARCHAR(64)            NOT NULL DEFAULT 'system',
    change_time          TIMESTAMP              NOT NULL DEFAULT CURRENT_TIMESTAMP,
    trace_id             VARCHAR(128)
);

COMMENT ON TABLE dwp.p_field_mapping_change_log IS '字段映射变更日志';
COMMENT ON COLUMN dwp.p_field_mapping_change_log.change_id IS '变更主键';
COMMENT ON COLUMN dwp.p_field_mapping_change_log.table_pk IS '关联源表主键';
COMMENT ON COLUMN dwp.p_field_mapping_change_log.field_pk IS '关联字段主键';
COMMENT ON COLUMN dwp.p_field_mapping_change_log.change_type IS '变更类型';
COMMENT ON COLUMN dwp.p_field_mapping_change_log.change_summary IS '变更摘要';
COMMENT ON COLUMN dwp.p_field_mapping_change_log.before_json IS '变更前快照';
COMMENT ON COLUMN dwp.p_field_mapping_change_log.after_json IS '变更后快照';
COMMENT ON COLUMN dwp.p_field_mapping_change_log.operator_name IS '操作人';

CREATE INDEX IF NOT EXISTS idx_p_field_mapping_change_log_ix_01
    ON dwp.p_field_mapping_change_log (table_pk, change_time);

CREATE INDEX IF NOT EXISTS idx_p_field_mapping_change_log_ix_02
    ON dwp.p_field_mapping_change_log (field_pk, change_time);
