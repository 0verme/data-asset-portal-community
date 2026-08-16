-- data-asset-portal application DDL
-- module: menus
-- scope: system menu tree and visibility/order metadata
-- schema: dwp
-- target: postgres

CREATE SCHEMA IF NOT EXISTS dwp;

CREATE TABLE IF NOT EXISTS dwp.p_menu (
    menu_id               BIGINT        NOT NULL,
    menu_code             VARCHAR(64)   NOT NULL,
    menu_name             VARCHAR(128)  NOT NULL,
    menu_icon             VARCHAR(64)   NOT NULL DEFAULT 'grid',
    menu_path             VARCHAR(256),
    display_order         INTEGER       NOT NULL DEFAULT 0,
    nav_placement         VARCHAR(16)    NOT NULL DEFAULT 'more',
    admin_only            CHAR(1)       NOT NULL DEFAULT 'N',
    is_active             CHAR(1)       NOT NULL DEFAULT 'Y',
    menu_desc             VARCHAR(512),
    remark                VARCHAR(1000),
    created_by            VARCHAR(64)   NOT NULL DEFAULT 'system',
    created_at            TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by            VARCHAR(64)   NOT NULL DEFAULT 'system',
    updated_at            TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_p_menu_uk_01
    ON dwp.p_menu (menu_code);

CREATE INDEX IF NOT EXISTS idx_p_menu_ix_01
    ON dwp.p_menu (is_active, display_order);

INSERT INTO dwp.p_menu (menu_id, menu_code, menu_name, menu_icon, menu_path, display_order, nav_placement, admin_only, is_active, menu_desc, remark)
SELECT 1, 'upstream', '上游卸数', 'download', '/upstream', 10, 'primary', 'N', 'Y', '上游卸数系统列表与维护', '系统初始化'
WHERE NOT EXISTS (SELECT 1 FROM dwp.p_menu WHERE menu_code = 'upstream');

INSERT INTO dwp.p_menu (menu_id, menu_code, menu_name, menu_icon, menu_path, display_order, nav_placement, admin_only, is_active, menu_desc, remark)
SELECT 2, 'dwm', '数据仓库', 'db', '/data-warehouse', 20, 'primary', 'N', 'Y', 'DWM 表资产、字段与 DDL', '系统初始化'
WHERE NOT EXISTS (SELECT 1 FROM dwp.p_menu WHERE menu_code = 'dwm');

INSERT INTO dwp.p_menu (menu_id, menu_code, menu_name, menu_icon, menu_path, display_order, nav_placement, admin_only, is_active, menu_desc, remark)
SELECT 3, 'mapping', '字段映射', 'link', '/field-mapping', 30, 'primary', 'N', 'Y', '字段与表的映射关系查询', '系统初始化'
WHERE NOT EXISTS (SELECT 1 FROM dwp.p_menu WHERE menu_code = 'mapping');

INSERT INTO dwp.p_menu (menu_id, menu_code, menu_name, menu_icon, menu_path, display_order, nav_placement, admin_only, is_active, menu_desc, remark)
SELECT 10, 'lineage', '血缘分析', 'layers', '/lineage', 35, 'primary', 'N', 'Y', '任务与数据表的上下游血缘排查', '系统初始化'
WHERE NOT EXISTS (SELECT 1 FROM dwp.p_menu WHERE menu_code = 'lineage');

INSERT INTO dwp.p_menu (menu_id, menu_code, menu_name, menu_icon, menu_path, display_order, admin_only, is_active, menu_desc, remark)
SELECT 4, 'root', '词根管理', 'book', '/root-management', 40, 'N', 'Y', '词根、分类与批量导入', '系统初始化'
WHERE NOT EXISTS (SELECT 1 FROM dwp.p_menu WHERE menu_code = 'root');

INSERT INTO dwp.p_menu (menu_id, menu_code, menu_name, menu_icon, menu_path, display_order, nav_placement, admin_only, is_active, menu_desc, remark)
SELECT 5, 'indicator', '指标维护', 'hash', '/indicator-maintenance', 50, 'primary', 'N', 'Y', '指标列表、详情与启停', '系统初始化'
WHERE NOT EXISTS (SELECT 1 FROM dwp.p_menu WHERE menu_code = 'indicator');

INSERT INTO dwp.p_menu (menu_id, menu_code, menu_name, menu_icon, menu_path, display_order, admin_only, is_active, menu_desc, remark)
SELECT 6, 'report', '报表资产', 'file', '/report-assets', 55, 'N', 'Y', '报表元数据台账、归属信息与关联引用', '系统初始化'
WHERE NOT EXISTS (SELECT 1 FROM dwp.p_menu WHERE menu_code = 'report');

INSERT INTO dwp.p_menu (menu_id, menu_code, menu_name, menu_icon, menu_path, display_order, admin_only, is_active, menu_desc, remark)
SELECT 9, 'apiAsset', 'API 资产', 'api', '/api-assets', 58, 'N', 'Y', 'API 元数据台账、参数、响应字段与关联资产维护', '系统初始化'
WHERE NOT EXISTS (SELECT 1 FROM dwp.p_menu WHERE menu_code = 'apiAsset');

INSERT INTO dwp.p_menu (menu_id, menu_code, menu_name, menu_icon, menu_path, display_order, admin_only, is_active, menu_desc, remark)
SELECT 7, 'push', '下游推送', 'upload', '/push', 60, 'N', 'Y', '下游推送系统、作业与字段', '系统初始化'
WHERE NOT EXISTS (SELECT 1 FROM dwp.p_menu WHERE menu_code = 'push');

INSERT INTO dwp.p_menu (menu_id, menu_code, menu_name, menu_icon, menu_path, display_order, admin_only, is_active, menu_desc, remark)
SELECT 8, 'system', '系统管理', 'shield', '/system-management', 70, 'Y', 'Y', '用户、菜单、参数字典与操作日志（仅管理员可见）', '系统初始化'
WHERE NOT EXISTS (SELECT 1 FROM dwp.p_menu WHERE menu_code = 'system');

INSERT INTO dwp.p_menu (menu_id, menu_code, menu_name, menu_icon, menu_path, display_order, nav_placement, admin_only, is_active, menu_desc, remark)
SELECT 11, 'codeTable', '码值表维护', 'table', '/code-table-maintenance', 65, 'more', 'N', 'Y', '湖仓手工码值表的表级元数据登记与维护', '系统初始化'
WHERE NOT EXISTS (SELECT 1 FROM dwp.p_menu WHERE menu_code = 'codeTable');
