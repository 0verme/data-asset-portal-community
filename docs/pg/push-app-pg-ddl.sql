-- data-asset-portal application DDL
-- module: push
-- scope: downstream systems, push jobs, job fields, and change logs
-- schema: dwp
-- target: postgres

CREATE SCHEMA IF NOT EXISTS dwp;

CREATE TABLE IF NOT EXISTS dwp.p_push_system (
    system_id            BIGINT                 NOT NULL,
    master_system_id     BIGINT,
    system_code          VARCHAR(64)            NOT NULL,
    system_name          VARCHAR(256)           NOT NULL,
    system_abbr          VARCHAR(32)            NOT NULL,
    protocol_type        VARCHAR(32)            NOT NULL,
    host_name            VARCHAR(256)           NOT NULL,
    port_no              INTEGER                NOT NULL,
    account_name         VARCHAR(128),
    auth_type            VARCHAR(64),
    contact_name         VARCHAR(128),
    data_developer_contact_name VARCHAR(128),
    dept_name            VARCHAR(128),
    system_desc          VARCHAR(2000),
    status_code          VARCHAR(32)            NOT NULL DEFAULT 'enabled',
    importance_level_code VARCHAR(16)            NOT NULL DEFAULT 'normal',
    latest_output_time   VARCHAR(5),
    job_count            INTEGER                NOT NULL DEFAULT 0,
    is_deleted           CHAR(1)                NOT NULL DEFAULT 'N',
    created_by           VARCHAR(64)            NOT NULL DEFAULT 'system',
    created_at           TIMESTAMP              NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by           VARCHAR(64)            NOT NULL DEFAULT 'system',
    updated_at           TIMESTAMP              NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_p_push_system_master FOREIGN KEY (master_system_id)
        REFERENCES dwp.p_system(system_id) ON DELETE RESTRICT
);

COMMENT ON TABLE dwp.p_push_system IS '下游系统清单主表';
COMMENT ON COLUMN dwp.p_push_system.system_id IS '下游系统ID';
COMMENT ON COLUMN dwp.p_push_system.system_code IS '下游系统编码，对应前端 id';
COMMENT ON COLUMN dwp.p_push_system.system_name IS '下游系统名称';
COMMENT ON COLUMN dwp.p_push_system.system_abbr IS '系统缩写，用于页面徽标与简称展示';
COMMENT ON COLUMN dwp.p_push_system.protocol_type IS '推送协议类型，如 SFTP/FTP/FTPS/HTTP/OSS';
COMMENT ON COLUMN dwp.p_push_system.host_name IS '目标主机名或服务地址';
COMMENT ON COLUMN dwp.p_push_system.port_no IS '目标端口';
COMMENT ON COLUMN dwp.p_push_system.account_name IS '登录账号';
COMMENT ON COLUMN dwp.p_push_system.auth_type IS '认证方式，如 密钥认证/账号密码';
COMMENT ON COLUMN dwp.p_push_system.contact_name IS '下游对接人';
COMMENT ON COLUMN dwp.p_push_system.data_developer_contact_name IS '数据开发对接人';
COMMENT ON COLUMN dwp.p_push_system.dept_name IS '归属部门';
COMMENT ON COLUMN dwp.p_push_system.system_desc IS '系统说明';
COMMENT ON COLUMN dwp.p_push_system.status_code IS '状态，如 enabled/disabled';
COMMENT ON COLUMN dwp.p_push_system.importance_level_code IS '重要程度，normal/important';
COMMENT ON COLUMN dwp.p_push_system.latest_output_time IS '最晚出数时间，HH:mm 24 小时制';
COMMENT ON COLUMN dwp.p_push_system.job_count IS '作业数量，冗余统计字段';
COMMENT ON COLUMN dwp.p_push_system.is_deleted IS '逻辑删除标记，Y/N';
COMMENT ON COLUMN dwp.p_push_system.created_by IS '创建人';
COMMENT ON COLUMN dwp.p_push_system.created_at IS '创建时间';
COMMENT ON COLUMN dwp.p_push_system.updated_by IS '更新人';
COMMENT ON COLUMN dwp.p_push_system.updated_at IS '更新时间';

CREATE UNIQUE INDEX IF NOT EXISTS idx_p_push_system_uk_01
    ON dwp.p_push_system (system_code);

CREATE INDEX IF NOT EXISTS idx_p_push_system_master
    ON dwp.p_push_system (master_system_id);

CREATE INDEX IF NOT EXISTS idx_p_push_system_ix_01
    ON dwp.p_push_system (status_code, protocol_type, dept_name);


CREATE TABLE IF NOT EXISTS dwp.p_push_job (
    job_id               BIGINT                 NOT NULL,
    system_id            BIGINT                 NOT NULL,
    job_code             VARCHAR(128)           NOT NULL,
    job_name             VARCHAR(256)           NOT NULL,
    source_path          VARCHAR(1000),
    source_file_name     VARCHAR(512),
    target_path          VARCHAR(1000),
    target_file_name     VARCHAR(512)           NOT NULL,
    freq_desc            VARCHAR(200),
    freq_type            VARCHAR(64),
    delimiter_code       VARCHAR(32),
    encoding_type        VARCHAR(64),
    row_count_desc       VARCHAR(200),
    enabled_flag         CHAR(1)                NOT NULL DEFAULT 'Y',
    job_desc             VARCHAR(2000),
    field_count          INTEGER                NOT NULL DEFAULT 0,
    is_deleted           CHAR(1)                NOT NULL DEFAULT 'N',
    created_by           VARCHAR(64)            NOT NULL DEFAULT 'system',
    created_at           TIMESTAMP              NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by           VARCHAR(64)            NOT NULL DEFAULT 'system',
    updated_at           TIMESTAMP              NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE dwp.p_push_job IS '下游系统推送作业清单';
COMMENT ON COLUMN dwp.p_push_job.job_id IS '推送作业ID';
COMMENT ON COLUMN dwp.p_push_job.system_id IS '所属下游系统ID';
COMMENT ON COLUMN dwp.p_push_job.job_code IS '推送作业编码，对应前端 id';
COMMENT ON COLUMN dwp.p_push_job.job_name IS '推送作业名称，对应前端 cn';
COMMENT ON COLUMN dwp.p_push_job.source_path IS '湖仓来源路径';
COMMENT ON COLUMN dwp.p_push_job.source_file_name IS '湖仓来源文件名';
COMMENT ON COLUMN dwp.p_push_job.target_path IS '下游目标路径';
COMMENT ON COLUMN dwp.p_push_job.target_file_name IS '目标推送文件名';
COMMENT ON COLUMN dwp.p_push_job.freq_desc IS '推送频率参数：准实时=间隔分钟(5/30/60)，每周=星期(1-7)，每月=日期(1-28)或LAST(月末)；T+0/T+1 为空';
COMMENT ON COLUMN dwp.p_push_job.freq_type IS '推送频率类型，取值 T+1/T+0/准实时/每周/每月；具体参数见 freq_desc';
COMMENT ON COLUMN dwp.p_push_job.delimiter_code IS '字段分隔符，如 | , \\t \\u0001';
COMMENT ON COLUMN dwp.p_push_job.encoding_type IS '文件编码，如 UTF-8/GBK';
COMMENT ON COLUMN dwp.p_push_job.row_count_desc IS '预计行数描述';
COMMENT ON COLUMN dwp.p_push_job.enabled_flag IS '是否启用，Y/N';
COMMENT ON COLUMN dwp.p_push_job.job_desc IS '作业说明';
COMMENT ON COLUMN dwp.p_push_job.field_count IS '字段数量，冗余统计字段';
COMMENT ON COLUMN dwp.p_push_job.is_deleted IS '逻辑删除标记，Y/N';
COMMENT ON COLUMN dwp.p_push_job.created_by IS '创建人';
COMMENT ON COLUMN dwp.p_push_job.created_at IS '创建时间';
COMMENT ON COLUMN dwp.p_push_job.updated_by IS '更新人';
COMMENT ON COLUMN dwp.p_push_job.updated_at IS '更新时间';

CREATE UNIQUE INDEX IF NOT EXISTS idx_p_push_job_uk_01
    ON dwp.p_push_job (system_id, job_code);

CREATE INDEX IF NOT EXISTS idx_p_push_job_ix_01
    ON dwp.p_push_job (system_id, enabled_flag, freq_type);

CREATE INDEX IF NOT EXISTS idx_p_push_job_ix_02
    ON dwp.p_push_job (system_id, is_deleted, job_code);


CREATE TABLE IF NOT EXISTS dwp.p_push_job_field (
    field_id             BIGINT                 NOT NULL,
    job_id               BIGINT                 NOT NULL,
    field_name           VARCHAR(128)           NOT NULL,
    field_cn_name        VARCHAR(256)           NOT NULL,
    field_order          INTEGER                NOT NULL DEFAULT 0,
    source_code          VARCHAR(64),
    data_type            VARCHAR(128)           NOT NULL,
    field_meaning        VARCHAR(2000),
    is_deleted           CHAR(1)                NOT NULL DEFAULT 'N',
    created_by           VARCHAR(64)            NOT NULL DEFAULT 'system',
    created_at           TIMESTAMP              NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by           VARCHAR(64)            NOT NULL DEFAULT 'system',
    updated_at           TIMESTAMP              NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE dwp.p_push_job_field IS '推送作业文件字段清单';
COMMENT ON COLUMN dwp.p_push_job_field.field_id IS '字段ID';
COMMENT ON COLUMN dwp.p_push_job_field.job_id IS '所属推送作业ID';
COMMENT ON COLUMN dwp.p_push_job_field.field_name IS '字段英文名';
COMMENT ON COLUMN dwp.p_push_job_field.field_cn_name IS '字段中文名';
COMMENT ON COLUMN dwp.p_push_job_field.field_order IS '字段顺序，从1开始';
COMMENT ON COLUMN dwp.p_push_job_field.source_code IS '字段来源分层或来源系统，如 DWM';
COMMENT ON COLUMN dwp.p_push_job_field.data_type IS '字段数据类型';
COMMENT ON COLUMN dwp.p_push_job_field.field_meaning IS '字段含义说明';
COMMENT ON COLUMN dwp.p_push_job_field.is_deleted IS '逻辑删除标记，Y/N';
COMMENT ON COLUMN dwp.p_push_job_field.created_by IS '创建人';
COMMENT ON COLUMN dwp.p_push_job_field.created_at IS '创建时间';
COMMENT ON COLUMN dwp.p_push_job_field.updated_by IS '更新人';
COMMENT ON COLUMN dwp.p_push_job_field.updated_at IS '更新时间';

CREATE UNIQUE INDEX IF NOT EXISTS idx_p_push_job_field_uk_01
    ON dwp.p_push_job_field (job_id, field_name);

CREATE INDEX IF NOT EXISTS idx_p_push_job_field_ix_01
    ON dwp.p_push_job_field (job_id, field_order);


CREATE TABLE IF NOT EXISTS dwp.p_push_change_log (
    change_id            BIGINT                 NOT NULL,
    system_id            BIGINT,
    job_id               BIGINT,
    object_type          VARCHAR(32)            NOT NULL,
    object_code          VARCHAR(128)           NOT NULL,
    change_type          VARCHAR(64)            NOT NULL,
    change_summary       VARCHAR(1000),
    before_json          TEXT,
    after_json           TEXT,
    operator_name        VARCHAR(64)            NOT NULL DEFAULT 'system',
    change_time          TIMESTAMP              NOT NULL DEFAULT CURRENT_TIMESTAMP,
    trace_id             VARCHAR(128)
);

COMMENT ON TABLE dwp.p_push_change_log IS '推送应用变更日志';
COMMENT ON COLUMN dwp.p_push_change_log.change_id IS '变更ID';
COMMENT ON COLUMN dwp.p_push_change_log.system_id IS '下游系统ID，可为空';
COMMENT ON COLUMN dwp.p_push_change_log.job_id IS '推送作业ID，可为空';
COMMENT ON COLUMN dwp.p_push_change_log.object_type IS '变更对象类型，如 SYSTEM/JOB';
COMMENT ON COLUMN dwp.p_push_change_log.object_code IS '对象编码，如 system_code 或 job_code';
COMMENT ON COLUMN dwp.p_push_change_log.change_type IS '变更类型，如 CREATE_SYSTEM/UPDATE_SYSTEM/DELETE_SYSTEM/CREATE_JOB/UPDATE_JOB/DELETE_JOB';
COMMENT ON COLUMN dwp.p_push_change_log.change_summary IS '变更摘要';
COMMENT ON COLUMN dwp.p_push_change_log.before_json IS '变更前快照JSON';
COMMENT ON COLUMN dwp.p_push_change_log.after_json IS '变更后快照JSON';
COMMENT ON COLUMN dwp.p_push_change_log.operator_name IS '操作人';
COMMENT ON COLUMN dwp.p_push_change_log.change_time IS '变更时间';
COMMENT ON COLUMN dwp.p_push_change_log.trace_id IS '链路追踪ID';

CREATE INDEX IF NOT EXISTS idx_p_push_change_log_ix_01
    ON dwp.p_push_change_log (system_id, change_time);

CREATE INDEX IF NOT EXISTS idx_p_push_change_log_ix_02
    ON dwp.p_push_change_log (job_id, change_time);

CREATE INDEX IF NOT EXISTS idx_p_push_change_log_ix_03
    ON dwp.p_push_change_log (object_type, object_code, change_time);
