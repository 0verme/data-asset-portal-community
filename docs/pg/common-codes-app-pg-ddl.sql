-- data-asset-portal application DDL
-- module: common-codes
-- scope: common code categories and code items
-- schema: dwp
-- target: postgres

CREATE SCHEMA IF NOT EXISTS dwp;

CREATE TABLE IF NOT EXISTS dwp.p_code_category (
    category_id           BIGINT        NOT NULL,
    category_code         VARCHAR(64)   NOT NULL,
    category_name         VARCHAR(128)  NOT NULL,
    category_desc         VARCHAR(512),
    display_order         INTEGER       NOT NULL DEFAULT 0,
    is_active             CHAR(1)       NOT NULL DEFAULT 'Y',
    remark                VARCHAR(1000),
    created_by            VARCHAR(64)   NOT NULL DEFAULT 'system',
    created_at            TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by            VARCHAR(64)   NOT NULL DEFAULT 'system',
    updated_at            TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_p_code_category_uk_01
    ON dwp.p_code_category (category_code);

CREATE INDEX IF NOT EXISTS idx_p_code_category_ix_01
    ON dwp.p_code_category (is_active, display_order);

CREATE TABLE IF NOT EXISTS dwp.p_code_item (
    item_id               BIGINT        NOT NULL,
    category_code         VARCHAR(64)   NOT NULL,
    item_code             VARCHAR(64)   NOT NULL,
    item_name             VARCHAR(128)  NOT NULL,
    item_value            VARCHAR(256),
    item_desc             VARCHAR(512),
    display_order         INTEGER       NOT NULL DEFAULT 0,
    ext_json              TEXT,
    is_active             CHAR(1)       NOT NULL DEFAULT 'Y',
    remark                VARCHAR(1000),
    created_by            VARCHAR(64)   NOT NULL DEFAULT 'system',
    created_at            TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by            VARCHAR(64)   NOT NULL DEFAULT 'system',
    updated_at            TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_p_code_item_uk_01
    ON dwp.p_code_item (category_code, item_code);

CREATE INDEX IF NOT EXISTS idx_p_code_item_ix_01
    ON dwp.p_code_item (category_code, is_active, display_order);

INSERT INTO dwp.p_code_category (
    category_id, category_code, category_name, category_desc, display_order, is_active, remark
)
SELECT 1, 'UPSTREAM_DB_TYPE', '上游数据库类型', '上游卸数系统数据库类型选项', 10, 'Y', '系统初始化'
WHERE NOT EXISTS (
    SELECT 1 FROM dwp.p_code_category WHERE category_code = 'UPSTREAM_DB_TYPE'
);

INSERT INTO dwp.p_code_item (
    item_id, category_code, item_code, item_name, item_value, item_desc, display_order, is_active, remark
)
SELECT 1, 'UPSTREAM_DB_TYPE', 'ORACLE', 'Oracle', 'Oracle', 'Oracle Database', 10, 'Y', '系统初始化'
WHERE NOT EXISTS (
    SELECT 1 FROM dwp.p_code_item WHERE category_code = 'UPSTREAM_DB_TYPE' AND item_code = 'ORACLE'
);

INSERT INTO dwp.p_code_item (
    item_id, category_code, item_code, item_name, item_value, item_desc, display_order, is_active, remark
)
SELECT 2, 'UPSTREAM_DB_TYPE', 'MYSQL', 'MySQL', 'MySQL', 'MySQL Database', 20, 'Y', '系统初始化'
WHERE NOT EXISTS (
    SELECT 1 FROM dwp.p_code_item WHERE category_code = 'UPSTREAM_DB_TYPE' AND item_code = 'MYSQL'
);

INSERT INTO dwp.p_code_item (
    item_id, category_code, item_code, item_name, item_value, item_desc, display_order, is_active, remark
)
SELECT 3, 'UPSTREAM_DB_TYPE', 'POSTGRESQL', 'PostgreSQL', 'PostgreSQL', 'PostgreSQL Database', 30, 'Y', '系统初始化'
WHERE NOT EXISTS (
    SELECT 1 FROM dwp.p_code_item WHERE category_code = 'UPSTREAM_DB_TYPE' AND item_code = 'POSTGRESQL'
);

INSERT INTO dwp.p_code_item (
    item_id, category_code, item_code, item_name, item_value, item_desc, display_order, is_active, remark
)
SELECT 4, 'UPSTREAM_DB_TYPE', 'DB2', 'DB2', 'DB2', 'IBM DB2', 40, 'Y', '系统初始化'
WHERE NOT EXISTS (
    SELECT 1 FROM dwp.p_code_item WHERE category_code = 'UPSTREAM_DB_TYPE' AND item_code = 'DB2'
);

INSERT INTO dwp.p_code_item (
    item_id, category_code, item_code, item_name, item_value, item_desc, display_order, is_active, remark
)
SELECT 5, 'UPSTREAM_DB_TYPE', 'SQL_SERVER', 'SQL Server', 'SQL Server', 'Microsoft SQL Server', 50, 'Y', '系统初始化'
WHERE NOT EXISTS (
    SELECT 1 FROM dwp.p_code_item WHERE category_code = 'UPSTREAM_DB_TYPE' AND item_code = 'SQL_SERVER'
);

INSERT INTO dwp.p_code_item (
    item_id, category_code, item_code, item_name, item_value, item_desc, display_order, is_active, remark
)
SELECT 6, 'UPSTREAM_DB_TYPE', 'OTHER', '其他', '其他', '其他数据库类型', 999, 'Y', '系统初始化'
WHERE NOT EXISTS (
    SELECT 1 FROM dwp.p_code_item WHERE category_code = 'UPSTREAM_DB_TYPE' AND item_code = 'OTHER'
);

INSERT INTO dwp.p_code_category (
    category_id, category_code, category_name, category_desc, display_order, is_active, remark
)
SELECT 2, 'PUSH_PROTOCOL', '下游推送协议', '下游系统连接协议选项', 20, 'Y', '系统初始化'
WHERE NOT EXISTS (
    SELECT 1 FROM dwp.p_code_category WHERE category_code = 'PUSH_PROTOCOL'
);

INSERT INTO dwp.p_code_item (
    item_id, category_code, item_code, item_name, item_value, item_desc, display_order, is_active, remark
)
SELECT 7, 'PUSH_PROTOCOL', 'SFTP', 'SFTP', 'SFTP', 'Secure File Transfer Protocol', 10, 'Y', '系统初始化'
WHERE NOT EXISTS (
    SELECT 1 FROM dwp.p_code_item WHERE category_code = 'PUSH_PROTOCOL' AND item_code = 'SFTP'
);

INSERT INTO dwp.p_code_item (
    item_id, category_code, item_code, item_name, item_value, item_desc, display_order, is_active, remark
)
SELECT 8, 'PUSH_PROTOCOL', 'FTP', 'FTP', 'FTP', 'File Transfer Protocol', 20, 'Y', '系统初始化'
WHERE NOT EXISTS (
    SELECT 1 FROM dwp.p_code_item WHERE category_code = 'PUSH_PROTOCOL' AND item_code = 'FTP'
);

INSERT INTO dwp.p_code_item (
    item_id, category_code, item_code, item_name, item_value, item_desc, display_order, is_active, remark
)
SELECT 9, 'PUSH_PROTOCOL', 'FTPS', 'FTPS', 'FTPS', 'FTP over SSL/TLS', 30, 'Y', '系统初始化'
WHERE NOT EXISTS (
    SELECT 1 FROM dwp.p_code_item WHERE category_code = 'PUSH_PROTOCOL' AND item_code = 'FTPS'
);

INSERT INTO dwp.p_code_item (
    item_id, category_code, item_code, item_name, item_value, item_desc, display_order, is_active, remark
)
SELECT 10, 'PUSH_PROTOCOL', 'HTTP', 'HTTP', 'HTTP', 'HTTP Push Endpoint', 40, 'Y', '系统初始化'
WHERE NOT EXISTS (
    SELECT 1 FROM dwp.p_code_item WHERE category_code = 'PUSH_PROTOCOL' AND item_code = 'HTTP'
);

INSERT INTO dwp.p_code_item (
    item_id, category_code, item_code, item_name, item_value, item_desc, display_order, is_active, remark
)
SELECT 11, 'PUSH_PROTOCOL', 'OSS', 'OSS', 'OSS', 'Object Storage Service', 50, 'Y', '系统初始化'
WHERE NOT EXISTS (
    SELECT 1 FROM dwp.p_code_item WHERE category_code = 'PUSH_PROTOCOL' AND item_code = 'OSS'
);

INSERT INTO dwp.p_code_category (
    category_id, category_code, category_name, category_desc, display_order, is_active, remark
)
SELECT 3, 'PUSH_AUTH_TYPE', '下游认证方式', '下游系统连接认证方式选项', 30, 'Y', '系统初始化'
WHERE NOT EXISTS (
    SELECT 1 FROM dwp.p_code_category WHERE category_code = 'PUSH_AUTH_TYPE'
);

INSERT INTO dwp.p_code_item (
    item_id, category_code, item_code, item_name, item_value, item_desc, display_order, is_active, remark
)
SELECT 12, 'PUSH_AUTH_TYPE', 'KEY', '密钥认证', '密钥认证', '使用密钥或证书认证', 10, 'Y', '系统初始化'
WHERE NOT EXISTS (
    SELECT 1 FROM dwp.p_code_item WHERE category_code = 'PUSH_AUTH_TYPE' AND item_code = 'KEY'
);

INSERT INTO dwp.p_code_item (
    item_id, category_code, item_code, item_name, item_value, item_desc, display_order, is_active, remark
)
SELECT 13, 'PUSH_AUTH_TYPE', 'PASSWORD', '账号密码', '账号密码', '使用账号和密码认证', 20, 'Y', '系统初始化'
WHERE NOT EXISTS (
    SELECT 1 FROM dwp.p_code_item WHERE category_code = 'PUSH_AUTH_TYPE' AND item_code = 'PASSWORD'
);

INSERT INTO dwp.p_code_category (
    category_id, category_code, category_name, category_desc, display_order, is_active, remark
)
SELECT 4, 'SYSTEM_STATUS', '系统状态', '系统启停状态选项', 40, 'Y', '系统初始化'
WHERE NOT EXISTS (
    SELECT 1 FROM dwp.p_code_category WHERE category_code = 'SYSTEM_STATUS'
);

INSERT INTO dwp.p_code_item (
    item_id, category_code, item_code, item_name, item_value, item_desc, display_order, is_active, remark
)
SELECT 14, 'SYSTEM_STATUS', 'ENABLED', '启用', 'enabled', '系统启用', 10, 'Y', '系统初始化'
WHERE NOT EXISTS (
    SELECT 1 FROM dwp.p_code_item WHERE category_code = 'SYSTEM_STATUS' AND item_code = 'ENABLED'
);

INSERT INTO dwp.p_code_item (
    item_id, category_code, item_code, item_name, item_value, item_desc, display_order, is_active, remark
)
SELECT 15, 'SYSTEM_STATUS', 'DISABLED', '禁用', 'disabled', '系统禁用', 20, 'Y', '系统初始化'
WHERE NOT EXISTS (
    SELECT 1 FROM dwp.p_code_item WHERE category_code = 'SYSTEM_STATUS' AND item_code = 'DISABLED'
);
INSERT INTO dwp.p_code_category (
    category_id, category_code, category_name, category_desc, display_order, is_active, remark
)
SELECT 5, 'UPSTREAM_DEPT', '上游业务部门', '上游卸数和下游推送共用的归属部门选项', 50, 'Y', '系统初始化'
WHERE NOT EXISTS (
    SELECT 1 FROM dwp.p_code_category WHERE category_code = 'UPSTREAM_DEPT'
);

INSERT INTO dwp.p_code_item (
    item_id, category_code, item_code, item_name, item_value, item_desc, display_order, is_active, remark
)
SELECT 16, 'UPSTREAM_DEPT', 'CORE_SYSTEM', '核心系统部', '核心系统部', '核心系统部', 10, 'Y', '系统初始化'
WHERE NOT EXISTS (
    SELECT 1 FROM dwp.p_code_item WHERE category_code = 'UPSTREAM_DEPT' AND item_code = 'CORE_SYSTEM'
);

INSERT INTO dwp.p_code_item (
    item_id, category_code, item_code, item_name, item_value, item_desc, display_order, is_active, remark
)
SELECT 17, 'UPSTREAM_DEPT', 'BUSINESS_DEV', '业务发展部', '业务发展部', '业务发展部', 20, 'Y', '系统初始化'
WHERE NOT EXISTS (
    SELECT 1 FROM dwp.p_code_item WHERE category_code = 'UPSTREAM_DEPT' AND item_code = 'BUSINESS_DEV'
);

INSERT INTO dwp.p_code_item (
    item_id, category_code, item_code, item_name, item_value, item_desc, display_order, is_active, remark
)
SELECT 18, 'UPSTREAM_DEPT', 'RISK_CONTROL', '风险控制部', '风险控制部', '风险控制部', 30, 'Y', '系统初始化'
WHERE NOT EXISTS (
    SELECT 1 FROM dwp.p_code_item WHERE category_code = 'UPSTREAM_DEPT' AND item_code = 'RISK_CONTROL'
);

INSERT INTO dwp.p_code_item (
    item_id, category_code, item_code, item_name, item_value, item_desc, display_order, is_active, remark
)
SELECT 19, 'UPSTREAM_DEPT', 'CUSTOMER_OPS', '客户运营部', '客户运营部', '客户运营部', 40, 'Y', '系统初始化'
WHERE NOT EXISTS (
    SELECT 1 FROM dwp.p_code_item WHERE category_code = 'UPSTREAM_DEPT' AND item_code = 'CUSTOMER_OPS'
);

INSERT INTO dwp.p_code_category (
    category_id, category_code, category_name, category_desc, display_order, is_active, remark
)
SELECT 6, 'PUSH_DELIMITER', '字段分隔符', '下游推送文件字段分隔符选项', 60, 'Y', '系统初始化'
WHERE NOT EXISTS (
    SELECT 1 FROM dwp.p_code_category WHERE category_code = 'PUSH_DELIMITER'
);

INSERT INTO dwp.p_code_item (
    item_id, category_code, item_code, item_name, item_value, item_desc, display_order, is_active, remark
)
SELECT 20, 'PUSH_DELIMITER', 'PIPE', '竖线', '|', '使用竖线分隔字段', 10, 'Y', '系统初始化'
WHERE NOT EXISTS (
    SELECT 1 FROM dwp.p_code_item WHERE category_code = 'PUSH_DELIMITER' AND item_code = 'PIPE'
);

INSERT INTO dwp.p_code_item (
    item_id, category_code, item_code, item_name, item_value, item_desc, display_order, is_active, remark
)
SELECT 21, 'PUSH_DELIMITER', 'COMMA', '逗号', ',', '使用逗号分隔字段', 20, 'Y', '系统初始化'
WHERE NOT EXISTS (
    SELECT 1 FROM dwp.p_code_item WHERE category_code = 'PUSH_DELIMITER' AND item_code = 'COMMA'
);

INSERT INTO dwp.p_code_item (
    item_id, category_code, item_code, item_name, item_value, item_desc, display_order, is_active, remark
)
SELECT 22, 'PUSH_DELIMITER', 'TAB', 'Tab', '\t', '使用制表符分隔字段', 30, 'Y', '系统初始化'
WHERE NOT EXISTS (
    SELECT 1 FROM dwp.p_code_item WHERE category_code = 'PUSH_DELIMITER' AND item_code = 'TAB'
);

INSERT INTO dwp.p_code_item (
    item_id, category_code, item_code, item_name, item_value, item_desc, display_order, is_active, remark
)
SELECT 23, 'PUSH_DELIMITER', 'SEMICOLON', '分号', ';', '使用分号分隔字段', 40, 'Y', '系统初始化'
WHERE NOT EXISTS (
    SELECT 1 FROM dwp.p_code_item WHERE category_code = 'PUSH_DELIMITER' AND item_code = 'SEMICOLON'
);

INSERT INTO dwp.p_code_item (
    item_id, category_code, item_code, item_name, item_value, item_desc, display_order, is_active, remark
)
SELECT 24, 'PUSH_DELIMITER', 'SOH', 'SOH', '\u0001', '使用 SOH 控制字符分隔字段', 50, 'Y', '系统初始化'
WHERE NOT EXISTS (
    SELECT 1 FROM dwp.p_code_item WHERE category_code = 'PUSH_DELIMITER' AND item_code = 'SOH'
);

INSERT INTO dwp.p_code_category (
    category_id, category_code, category_name, category_desc, display_order, is_active, remark
)
SELECT 8, 'FILE_ENCODING', '文件编码', '下游推送文件编码格式选项', 80, 'Y', '系统初始化'
WHERE NOT EXISTS (
    SELECT 1 FROM dwp.p_code_category WHERE category_code = 'FILE_ENCODING'
);

INSERT INTO dwp.p_code_item (
    item_id, category_code, item_code, item_name, item_value, item_desc, display_order, is_active, remark
)
SELECT 31, 'FILE_ENCODING', 'UTF8', 'UTF-8', 'UTF-8', 'UTF-8 编码', 10, 'Y', '系统初始化'
WHERE NOT EXISTS (
    SELECT 1 FROM dwp.p_code_item WHERE category_code = 'FILE_ENCODING' AND item_code = 'UTF8'
);

INSERT INTO dwp.p_code_item (
    item_id, category_code, item_code, item_name, item_value, item_desc, display_order, is_active, remark
)
SELECT 32, 'FILE_ENCODING', 'GBK', 'GBK', 'GBK', 'GBK 编码', 20, 'Y', '系统初始化'
WHERE NOT EXISTS (
    SELECT 1 FROM dwp.p_code_item WHERE category_code = 'FILE_ENCODING' AND item_code = 'GBK'
);

INSERT INTO dwp.p_code_item (
    item_id, category_code, item_code, item_name, item_value, item_desc, display_order, is_active, remark
)
SELECT 33, 'FILE_ENCODING', 'GB2312', 'GB2312', 'GB2312', 'GB2312 编码', 30, 'Y', '系统初始化'
WHERE NOT EXISTS (
    SELECT 1 FROM dwp.p_code_item WHERE category_code = 'FILE_ENCODING' AND item_code = 'GB2312'
);

INSERT INTO dwp.p_code_item (
    item_id, category_code, item_code, item_name, item_value, item_desc, display_order, is_active, remark
)
SELECT 34, 'FILE_ENCODING', 'ISO8859_1', 'ISO-8859-1', 'ISO-8859-1', 'ISO-8859-1 编码', 40, 'Y', '系统初始化'
WHERE NOT EXISTS (
    SELECT 1 FROM dwp.p_code_item WHERE category_code = 'FILE_ENCODING' AND item_code = 'ISO8859_1'
);

INSERT INTO dwp.p_code_category (
    category_id, category_code, category_name, category_desc, display_order, is_active, remark
)
SELECT 9, 'FREQ_TYPE', '推送频率', '下游推送频率类型选项（出数时间取决于上游，仅标注时效口径）', 90, 'Y', '系统初始化'
WHERE NOT EXISTS (
    SELECT 1 FROM dwp.p_code_category WHERE category_code = 'FREQ_TYPE'
);

INSERT INTO dwp.p_code_item (
    item_id, category_code, item_code, item_name, item_value, item_desc, display_order, is_active, remark
)
SELECT 35, 'FREQ_TYPE', 'T1', 'T+1', 'T+1', '按 T+1 频率推送', 10, 'Y', '系统初始化'
WHERE NOT EXISTS (
    SELECT 1 FROM dwp.p_code_item WHERE category_code = 'FREQ_TYPE' AND item_code = 'T1'
);

INSERT INTO dwp.p_code_item (
    item_id, category_code, item_code, item_name, item_value, item_desc, display_order, is_active, remark
)
SELECT 36, 'FREQ_TYPE', 'T0', 'T+0', 'T+0', '按 T+0 频率推送', 20, 'Y', '系统初始化'
WHERE NOT EXISTS (
    SELECT 1 FROM dwp.p_code_item WHERE category_code = 'FREQ_TYPE' AND item_code = 'T0'
);

INSERT INTO dwp.p_code_item (
    item_id, category_code, item_code, item_name, item_value, item_desc, display_order, is_active, remark
)
SELECT 41, 'FREQ_TYPE', 'NEAR_RT', '准实时', '准实时', '准实时：分钟级间隔推送（5/30/60 分钟）', 30, 'Y', '系统初始化'
WHERE NOT EXISTS (
    SELECT 1 FROM dwp.p_code_item WHERE category_code = 'FREQ_TYPE' AND item_code = 'NEAR_RT'
);

INSERT INTO dwp.p_code_item (
    item_id, category_code, item_code, item_name, item_value, item_desc, display_order, is_active, remark
)
SELECT 42, 'FREQ_TYPE', 'WEEKLY', '每周', '每周', '每周按指定星期几推送', 40, 'Y', '系统初始化'
WHERE NOT EXISTS (
    SELECT 1 FROM dwp.p_code_item WHERE category_code = 'FREQ_TYPE' AND item_code = 'WEEKLY'
);

INSERT INTO dwp.p_code_item (
    item_id, category_code, item_code, item_name, item_value, item_desc, display_order, is_active, remark
)
SELECT 43, 'FREQ_TYPE', 'MONTHLY', '每月', '每月', '每月按指定日期或月末推送', 50, 'Y', '系统初始化'
WHERE NOT EXISTS (
    SELECT 1 FROM dwp.p_code_item WHERE category_code = 'FREQ_TYPE' AND item_code = 'MONTHLY'
);
