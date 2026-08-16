CREATE SCHEMA IF NOT EXISTS dwp;
CREATE TABLE IF NOT EXISTS dwp.p_menu (
  menu_id BIGINT PRIMARY KEY, menu_code VARCHAR(64) NOT NULL UNIQUE,
  menu_name VARCHAR(128) NOT NULL, menu_icon VARCHAR(64) NOT NULL DEFAULT 'grid',
  menu_path VARCHAR(256), display_order INTEGER NOT NULL DEFAULT 0,
  nav_placement VARCHAR(16) NOT NULL DEFAULT 'more',
  admin_only CHAR(1) NOT NULL DEFAULT 'N', is_active CHAR(1) NOT NULL DEFAULT 'Y',
  menu_desc VARCHAR(512), remark VARCHAR(1000),
  created_by VARCHAR(64) NOT NULL DEFAULT 'system',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by VARCHAR(64) NOT NULL DEFAULT 'system',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS dwp.p_code_category (
  category_id BIGINT PRIMARY KEY, category_code VARCHAR(64) NOT NULL UNIQUE,
  category_name VARCHAR(128) NOT NULL, category_desc VARCHAR(512),
  display_order INTEGER NOT NULL DEFAULT 0, is_active CHAR(1) NOT NULL DEFAULT 'Y',
  remark VARCHAR(1000), created_by VARCHAR(64) NOT NULL DEFAULT 'system',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by VARCHAR(64) NOT NULL DEFAULT 'system',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS dwp.p_code_item (
  item_id BIGINT PRIMARY KEY, category_code VARCHAR(64) NOT NULL,
  item_code VARCHAR(64) NOT NULL, item_name VARCHAR(128) NOT NULL,
  item_value VARCHAR(256), item_desc VARCHAR(512),
  display_order INTEGER NOT NULL DEFAULT 0, ext_json TEXT,
  is_active CHAR(1) NOT NULL DEFAULT 'Y', remark VARCHAR(1000),
  created_by VARCHAR(64) NOT NULL DEFAULT 'system',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by VARCHAR(64) NOT NULL DEFAULT 'system',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(category_code, item_code)
);
CREATE TABLE IF NOT EXISTS dwp.p_root_change_log (
  change_id BIGINT PRIMARY KEY, root_id BIGINT, root_abbr VARCHAR(64) NOT NULL,
  change_type VARCHAR(64) NOT NULL, change_summary VARCHAR(512),
  before_json TEXT, after_json TEXT,
  operator_name VARCHAR(64) NOT NULL DEFAULT 'system',
  change_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS dwp.p_indicator_change_log (
  change_id BIGINT PRIMARY KEY, indicator_pk BIGINT, indicator_id VARCHAR(64) NOT NULL,
  change_type VARCHAR(64) NOT NULL, change_summary VARCHAR(512),
  before_json TEXT, after_json TEXT,
  operator_name VARCHAR(64) NOT NULL DEFAULT 'system',
  change_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
