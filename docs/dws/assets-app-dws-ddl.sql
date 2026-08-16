-- data-asset-portal application DDL
-- module: assets
-- scope: application metadata tables only; excludes production business DWM fact tables
-- schema: dwp
-- target: dws-compatible

CREATE TABLE IF NOT EXISTS dwp.p_asset_domain (
    domain_code          VARCHAR(64)            NOT NULL PRIMARY KEY,
    domain_name          VARCHAR(256)           NOT NULL,
    display_order        INTEGER                NOT NULL DEFAULT 0,
    is_active            CHAR(1)                NOT NULL DEFAULT 'Y',
    is_deleted           CHAR(1)                NOT NULL DEFAULT 'N'
)
DISTRIBUTE BY REPLICATION;

COMMENT ON TABLE dwp.p_asset_domain IS '资产主题域字典';
COMMENT ON COLUMN dwp.p_asset_domain.domain_code IS '主题域编码，英文唯一标识（主键）';
COMMENT ON COLUMN dwp.p_asset_domain.domain_name IS '主题域名称';
COMMENT ON COLUMN dwp.p_asset_domain.display_order IS '展示顺序，数值越小越靠前';
COMMENT ON COLUMN dwp.p_asset_domain.is_active IS '是否启用，Y/N';
COMMENT ON COLUMN dwp.p_asset_domain.is_deleted IS '逻辑删除标记，Y/N';


CREATE TABLE IF NOT EXISTS dwp.p_asset_layer (
    layer_code           VARCHAR(32)            NOT NULL PRIMARY KEY,
    layer_name           VARCHAR(128)           NOT NULL,
    display_order        INTEGER                NOT NULL DEFAULT 0,
    is_active            CHAR(1)                NOT NULL DEFAULT 'Y',
    is_deleted           CHAR(1)                NOT NULL DEFAULT 'N'
)
DISTRIBUTE BY REPLICATION;

COMMENT ON TABLE dwp.p_asset_layer IS '资产分层字典';
COMMENT ON COLUMN dwp.p_asset_layer.layer_code IS '分层编码，如 ODS/DWD/DWA/DWM/DWS/DM/ADS（主键）';
COMMENT ON COLUMN dwp.p_asset_layer.layer_name IS '分层名称';
COMMENT ON COLUMN dwp.p_asset_layer.display_order IS '展示顺序';
COMMENT ON COLUMN dwp.p_asset_layer.is_active IS '是否启用，Y/N';
COMMENT ON COLUMN dwp.p_asset_layer.is_deleted IS '逻辑删除标记，Y/N';


CREATE TABLE IF NOT EXISTS dwp.p_asset_table (
    asset_id             BIGINT                 NOT NULL,
    table_name           VARCHAR(128)           NOT NULL,
    table_cn_name        VARCHAR(256)           NOT NULL,
    schema_name          VARCHAR(64)            NOT NULL,
    layer_code           VARCHAR(32)            NOT NULL,
    domain_code          VARCHAR(64),
    owner_name           VARCHAR(128),
    grain_desc           VARCHAR(500),
    cycle_desc           VARCHAR(200),
    table_desc           VARCHAR(2000),
    source_type          VARCHAR(32)            NOT NULL DEFAULT 'MANUAL',
    storage_type         VARCHAR(32)            NOT NULL DEFAULT 'DWS',
    status_code          VARCHAR(32)            NOT NULL DEFAULT 'ACTIVE',
    field_count          INTEGER                NOT NULL DEFAULT 0,
    is_deleted           CHAR(1)                NOT NULL DEFAULT 'N',
    created_by           VARCHAR(64)            NOT NULL DEFAULT 'system',
    created_at           TIMESTAMP              NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by           VARCHAR(64)            NOT NULL DEFAULT 'system',
    updated_at           TIMESTAMP              NOT NULL DEFAULT CURRENT_TIMESTAMP
)
DISTRIBUTE BY REPLICATION;

COMMENT ON TABLE dwp.p_asset_table IS '资产表清单主表';
COMMENT ON COLUMN dwp.p_asset_table.asset_id IS '资产表ID';
COMMENT ON COLUMN dwp.p_asset_table.table_name IS '表英文名，不含schema';
COMMENT ON COLUMN dwp.p_asset_table.table_cn_name IS '表中文名';
COMMENT ON COLUMN dwp.p_asset_table.schema_name IS '所在schema，如 DWS_DWM';
COMMENT ON COLUMN dwp.p_asset_table.layer_code IS '分层编码';
COMMENT ON COLUMN dwp.p_asset_table.domain_code IS '主题域编码，可为空';
COMMENT ON COLUMN dwp.p_asset_table.owner_name IS '负责人';
COMMENT ON COLUMN dwp.p_asset_table.grain_desc IS '数据粒度说明';
COMMENT ON COLUMN dwp.p_asset_table.cycle_desc IS '更新周期说明';
COMMENT ON COLUMN dwp.p_asset_table.table_desc IS '表描述';
COMMENT ON COLUMN dwp.p_asset_table.source_type IS '来源类型，如 MANUAL/SYNC_DWS';
COMMENT ON COLUMN dwp.p_asset_table.storage_type IS '存储类型，默认 DWS';
COMMENT ON COLUMN dwp.p_asset_table.status_code IS '状态，如 ACTIVE/INACTIVE';
COMMENT ON COLUMN dwp.p_asset_table.field_count IS '字段数，冗余统计字段';
COMMENT ON COLUMN dwp.p_asset_table.is_deleted IS '逻辑删除标记，Y/N';
COMMENT ON COLUMN dwp.p_asset_table.created_by IS '创建人';
COMMENT ON COLUMN dwp.p_asset_table.created_at IS '创建时间';
COMMENT ON COLUMN dwp.p_asset_table.updated_by IS '更新人';
COMMENT ON COLUMN dwp.p_asset_table.updated_at IS '更新时间';

CREATE UNIQUE INDEX idx_p_asset_table_uk_01
    ON dwp.p_asset_table (schema_name, table_name);

CREATE INDEX idx_p_asset_table_ix_01
    ON dwp.p_asset_table (layer_code, domain_code, status_code);

CREATE INDEX idx_p_asset_table_ix_02
    ON dwp.p_asset_table (owner_name);

CREATE INDEX idx_p_asset_table_ix_03
    ON dwp.p_asset_table (table_name);


CREATE TABLE IF NOT EXISTS dwp.p_asset_field (
    field_id             BIGINT                 NOT NULL,
    asset_id             BIGINT                 NOT NULL,
    field_name           VARCHAR(128)           NOT NULL,
    field_cn_name        VARCHAR(256)           NOT NULL,
    data_type            VARCHAR(128)           NOT NULL,
    field_order          INTEGER                NOT NULL DEFAULT 0,
    nullable_flag        CHAR(1)                NOT NULL DEFAULT 'Y',
    pk_flag              CHAR(1)                NOT NULL DEFAULT 'N',
    partition_flag       CHAR(1)                NOT NULL DEFAULT 'N',
    enum_desc            VARCHAR(2000),
    field_desc           VARCHAR(2000),
    is_deleted           CHAR(1)                NOT NULL DEFAULT 'N',
    created_by           VARCHAR(64)            NOT NULL DEFAULT 'system',
    created_at           TIMESTAMP              NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by           VARCHAR(64)            NOT NULL DEFAULT 'system',
    updated_at           TIMESTAMP              NOT NULL DEFAULT CURRENT_TIMESTAMP
)
DISTRIBUTE BY HASH (asset_id);

COMMENT ON TABLE dwp.p_asset_field IS '资产字段清单';
COMMENT ON COLUMN dwp.p_asset_field.field_id IS '字段ID';
COMMENT ON COLUMN dwp.p_asset_field.asset_id IS '所属资产表ID';
COMMENT ON COLUMN dwp.p_asset_field.field_name IS '字段英文名';
COMMENT ON COLUMN dwp.p_asset_field.field_cn_name IS '字段中文名';
COMMENT ON COLUMN dwp.p_asset_field.data_type IS '字段类型';
COMMENT ON COLUMN dwp.p_asset_field.field_order IS '字段顺序，从1开始';
COMMENT ON COLUMN dwp.p_asset_field.nullable_flag IS '是否可空，Y/N';
COMMENT ON COLUMN dwp.p_asset_field.pk_flag IS '是否主键，Y/N';
COMMENT ON COLUMN dwp.p_asset_field.partition_flag IS '是否分区字段，Y/N';
COMMENT ON COLUMN dwp.p_asset_field.enum_desc IS '枚举值或取值说明';
COMMENT ON COLUMN dwp.p_asset_field.field_desc IS '字段说明';
COMMENT ON COLUMN dwp.p_asset_field.is_deleted IS '逻辑删除标记，Y/N';
COMMENT ON COLUMN dwp.p_asset_field.created_by IS '创建人';
COMMENT ON COLUMN dwp.p_asset_field.created_at IS '创建时间';
COMMENT ON COLUMN dwp.p_asset_field.updated_by IS '更新人';
COMMENT ON COLUMN dwp.p_asset_field.updated_at IS '更新时间';

CREATE UNIQUE INDEX idx_p_asset_field_uk_01
    ON dwp.p_asset_field (asset_id, field_name);

CREATE INDEX idx_p_asset_field_ix_01
    ON dwp.p_asset_field (asset_id, field_order);


CREATE TABLE IF NOT EXISTS dwp.p_asset_change_log (
    change_id            BIGINT                 NOT NULL,
    asset_id             BIGINT,
    table_name           VARCHAR(128)           NOT NULL,
    change_type          VARCHAR(32)            NOT NULL,
    change_summary       VARCHAR(1000),
    before_json          TEXT,
    after_json           TEXT,
    operator_name        VARCHAR(64)            NOT NULL DEFAULT 'system',
    change_time          TIMESTAMP              NOT NULL DEFAULT CURRENT_TIMESTAMP,
    trace_id             VARCHAR(128)
)
DISTRIBUTE BY HASH (change_id);

COMMENT ON TABLE dwp.p_asset_change_log IS '资产变更日志';
COMMENT ON COLUMN dwp.p_asset_change_log.change_id IS '变更ID';
COMMENT ON COLUMN dwp.p_asset_change_log.asset_id IS '资产表ID，可为空';
COMMENT ON COLUMN dwp.p_asset_change_log.table_name IS '表英文名';
COMMENT ON COLUMN dwp.p_asset_change_log.change_type IS '变更类型，如 CREATE_TABLE/UPDATE_TABLE/UPDATE_FIELDS/DELETE_TABLE';
COMMENT ON COLUMN dwp.p_asset_change_log.change_summary IS '变更摘要';
COMMENT ON COLUMN dwp.p_asset_change_log.before_json IS '变更前快照JSON';
COMMENT ON COLUMN dwp.p_asset_change_log.after_json IS '变更后快照JSON';
COMMENT ON COLUMN dwp.p_asset_change_log.operator_name IS '操作人';
COMMENT ON COLUMN dwp.p_asset_change_log.change_time IS '变更时间';
COMMENT ON COLUMN dwp.p_asset_change_log.trace_id IS '链路追踪ID';

CREATE INDEX idx_p_asset_change_log_ix_01
    ON dwp.p_asset_change_log (table_name, change_time);

CREATE INDEX idx_p_asset_change_log_ix_02
    ON dwp.p_asset_change_log (asset_id, change_time);


INSERT INTO dwp.p_asset_layer (layer_code, layer_name, display_order, is_active, is_deleted)
SELECT 'ODS', '贴源层', 10, 'N', 'N'
WHERE NOT EXISTS (SELECT 1 FROM dwp.p_asset_layer WHERE layer_code = 'ODS');

INSERT INTO dwp.p_asset_layer (layer_code, layer_name, display_order, is_active, is_deleted)
SELECT 'DWD', '明细层', 20, 'N', 'N'
WHERE NOT EXISTS (SELECT 1 FROM dwp.p_asset_layer WHERE layer_code = 'DWD');

INSERT INTO dwp.p_asset_layer (layer_code, layer_name, display_order, is_active, is_deleted)
SELECT 'DWA', '应用明细层', 30, 'Y', 'N'
WHERE NOT EXISTS (SELECT 1 FROM dwp.p_asset_layer WHERE layer_code = 'DWA');

INSERT INTO dwp.p_asset_layer (layer_code, layer_name, display_order, is_active, is_deleted)
SELECT 'DWM', '中间层', 40, 'Y', 'N'
WHERE NOT EXISTS (SELECT 1 FROM dwp.p_asset_layer WHERE layer_code = 'DWM');

INSERT INTO dwp.p_asset_layer (layer_code, layer_name, display_order, is_active, is_deleted)
SELECT 'DWS', '汇总层', 50, 'N', 'N'
WHERE NOT EXISTS (SELECT 1 FROM dwp.p_asset_layer WHERE layer_code = 'DWS');

INSERT INTO dwp.p_asset_layer (layer_code, layer_name, display_order, is_active, is_deleted)
SELECT 'DM', '数据集市层', 60, 'Y', 'N'
WHERE NOT EXISTS (SELECT 1 FROM dwp.p_asset_layer WHERE layer_code = 'DM');

INSERT INTO dwp.p_asset_layer (layer_code, layer_name, display_order, is_active, is_deleted)
SELECT 'ADS', '应用层', 70, 'N', 'N'
WHERE NOT EXISTS (SELECT 1 FROM dwp.p_asset_layer WHERE layer_code = 'ADS');


INSERT INTO dwp.p_asset_domain (domain_code, domain_name, display_order, is_active, is_deleted)
SELECT 'PAY', '支付', 10, 'Y', 'N'
WHERE NOT EXISTS (SELECT 1 FROM dwp.p_asset_domain WHERE domain_code = 'PAY');

INSERT INTO dwp.p_asset_domain (domain_code, domain_name, display_order, is_active, is_deleted)
SELECT 'TRADE', '交易', 20, 'Y', 'N'
WHERE NOT EXISTS (SELECT 1 FROM dwp.p_asset_domain WHERE domain_code = 'TRADE');

INSERT INTO dwp.p_asset_domain (domain_code, domain_name, display_order, is_active, is_deleted)
SELECT 'ACCT', '账户', 30, 'Y', 'N'
WHERE NOT EXISTS (SELECT 1 FROM dwp.p_asset_domain WHERE domain_code = 'ACCT');

INSERT INTO dwp.p_asset_domain (domain_code, domain_name, display_order, is_active, is_deleted)
SELECT 'USER', '用户', 40, 'Y', 'N'
WHERE NOT EXISTS (SELECT 1 FROM dwp.p_asset_domain WHERE domain_code = 'USER');

INSERT INTO dwp.p_asset_domain (domain_code, domain_name, display_order, is_active, is_deleted)
SELECT 'RISK', '风控', 50, 'Y', 'N'
WHERE NOT EXISTS (SELECT 1 FROM dwp.p_asset_domain WHERE domain_code = 'RISK');

INSERT INTO dwp.p_asset_domain (domain_code, domain_name, display_order, is_active, is_deleted)
SELECT 'MKT', '营销', 60, 'Y', 'N'
WHERE NOT EXISTS (SELECT 1 FROM dwp.p_asset_domain WHERE domain_code = 'MKT');

INSERT INTO dwp.p_asset_domain (domain_code, domain_name, display_order, is_active, is_deleted)
SELECT 'SETTLE', '清结算', 70, 'Y', 'N'
WHERE NOT EXISTS (SELECT 1 FROM dwp.p_asset_domain WHERE domain_code = 'SETTLE');

