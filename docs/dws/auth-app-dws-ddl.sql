-- data-asset-portal application DDL
-- module: auth
-- scope: administrator accounts and login metadata
-- schema: dwp
-- target: dws-compatible

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
)
DISTRIBUTE BY REPLICATION;

COMMENT ON TABLE dwp.p_admin_user IS '数据资产门户管理员账号表';
COMMENT ON COLUMN dwp.p_admin_user.id IS '主键ID';
COMMENT ON COLUMN dwp.p_admin_user.username IS '管理员登录账号';
COMMENT ON COLUMN dwp.p_admin_user.password_hash IS '密码哈希';
COMMENT ON COLUMN dwp.p_admin_user.display_name IS '显示名称';
COMMENT ON COLUMN dwp.p_admin_user.role IS '角色，admin/editor/viewer';
COMMENT ON COLUMN dwp.p_admin_user.status IS '状态，ACTIVE/DISABLED';
COMMENT ON COLUMN dwp.p_admin_user.last_login_at IS '最近登录时间';
COMMENT ON COLUMN dwp.p_admin_user.created_at IS '创建时间';
COMMENT ON COLUMN dwp.p_admin_user.updated_at IS '更新时间';

CREATE UNIQUE INDEX idx_p_admin_user_uk_01
    ON dwp.p_admin_user (username);

CREATE UNIQUE INDEX idx_p_admin_user_uk_02
    ON dwp.p_admin_user (id);

