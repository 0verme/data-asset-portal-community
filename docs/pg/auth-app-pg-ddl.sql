-- data-asset-portal application DDL
-- module: auth
-- scope: administrator accounts and login metadata
-- schema: dwp
-- target: postgres

CREATE SCHEMA IF NOT EXISTS dwp;

CREATE TABLE IF NOT EXISTS dwp.p_role (
    role_code VARCHAR(64) PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    description VARCHAR(2000),
    builtin CHAR(1) NOT NULL DEFAULT 'N',
    enabled CHAR(1) NOT NULL DEFAULT 'Y',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS dwp.p_permission (
    permission_code VARCHAR(128) PRIMARY KEY,
    resource VARCHAR(64) NOT NULL,
    action VARCHAR(32) NOT NULL,
    name VARCHAR(128) NOT NULL,
    description VARCHAR(2000)
);

CREATE TABLE IF NOT EXISTS dwp.p_role_permission (
    role_code VARCHAR(64) NOT NULL,
    permission_code VARCHAR(128) NOT NULL,
    PRIMARY KEY (role_code, permission_code),
    FOREIGN KEY (role_code) REFERENCES dwp.p_role(role_code) ON DELETE CASCADE,
    FOREIGN KEY (permission_code) REFERENCES dwp.p_permission(permission_code) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_p_role_permission_permission
    ON dwp.p_role_permission (permission_code);

CREATE TABLE IF NOT EXISTS dwp.p_admin_user (
    id                  BIGINT                 NOT NULL,
    username            VARCHAR(64)            NOT NULL,
    password_hash       VARCHAR(512)           NOT NULL,
    display_name        VARCHAR(128),
    role                VARCHAR(16)            NOT NULL DEFAULT 'admin',
    status              VARCHAR(16)            NOT NULL DEFAULT 'ACTIVE',
    last_login_at       TIMESTAMP,
    created_at          TIMESTAMP              NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP              NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE dwp.p_admin_user IS '数据资产门户管理员账号表';
COMMENT ON COLUMN dwp.p_admin_user.id IS '主键ID';
COMMENT ON COLUMN dwp.p_admin_user.username IS '管理员登录账号';
COMMENT ON COLUMN dwp.p_admin_user.password_hash IS '密码哈希';
COMMENT ON COLUMN dwp.p_admin_user.display_name IS '显示名称';
COMMENT ON COLUMN dwp.p_admin_user.role IS '角色代码，admin/maintainer 或自定义 Role code';
COMMENT ON COLUMN dwp.p_admin_user.status IS '状态，ACTIVE/DISABLED';
COMMENT ON COLUMN dwp.p_admin_user.last_login_at IS '最近登录时间';
COMMENT ON COLUMN dwp.p_admin_user.created_at IS '创建时间';
COMMENT ON COLUMN dwp.p_admin_user.updated_at IS '更新时间';

CREATE UNIQUE INDEX IF NOT EXISTS idx_p_admin_user_uk_01
    ON dwp.p_admin_user (username);

CREATE UNIQUE INDEX IF NOT EXISTS idx_p_admin_user_uk_02
    ON dwp.p_admin_user (id);

