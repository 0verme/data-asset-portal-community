CREATE TABLE IF NOT EXISTS dwp.p_menu (
  menu_id INTEGER PRIMARY KEY, menu_code TEXT NOT NULL UNIQUE, menu_name TEXT NOT NULL,
  menu_icon TEXT NOT NULL DEFAULT 'grid', menu_path TEXT,
  display_order INTEGER NOT NULL DEFAULT 0, nav_placement TEXT NOT NULL DEFAULT 'more',
  admin_only TEXT NOT NULL DEFAULT 'N', is_active TEXT NOT NULL DEFAULT 'Y',
  menu_desc TEXT, remark TEXT, created_by TEXT NOT NULL DEFAULT 'system',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by TEXT NOT NULL DEFAULT 'system',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS dwp.p_code_category (
  category_id INTEGER PRIMARY KEY, category_code TEXT NOT NULL UNIQUE,
  category_name TEXT NOT NULL, category_desc TEXT,
  display_order INTEGER NOT NULL DEFAULT 0, is_active TEXT NOT NULL DEFAULT 'Y',
  remark TEXT, created_by TEXT NOT NULL DEFAULT 'system',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by TEXT NOT NULL DEFAULT 'system',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS dwp.p_code_item (
  item_id INTEGER PRIMARY KEY, category_code TEXT NOT NULL,
  item_code TEXT NOT NULL, item_name TEXT NOT NULL, item_value TEXT,
  item_desc TEXT, display_order INTEGER NOT NULL DEFAULT 0, ext_json TEXT,
  is_active TEXT NOT NULL DEFAULT 'Y', remark TEXT,
  created_by TEXT NOT NULL DEFAULT 'system',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by TEXT NOT NULL DEFAULT 'system',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(category_code, item_code)
);
CREATE TABLE IF NOT EXISTS dwp.p_root_change_log (
  change_id INTEGER PRIMARY KEY, root_id INTEGER, root_abbr TEXT NOT NULL,
  change_type TEXT NOT NULL, change_summary TEXT, before_json TEXT, after_json TEXT,
  operator_name TEXT NOT NULL DEFAULT 'system',
  change_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS dwp.p_indicator_change_log (
  change_id INTEGER PRIMARY KEY, indicator_pk INTEGER, indicator_id TEXT NOT NULL,
  change_type TEXT NOT NULL, change_summary TEXT, before_json TEXT, after_json TEXT,
  operator_name TEXT NOT NULL DEFAULT 'system',
  change_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
