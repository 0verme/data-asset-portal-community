export interface UserFormDefaults {
  username: string;
  displayName: string;
  status: string;
  role: string;
  email: string;
  remark: string;
}

export interface ParamFormDefaults {
  categoryCode: string;
  code: string;
  name: string;
  value: string;
  status: string;
  desc: string;
}

export interface MenuFormDefaults {
  code: string;
  name: string;
  icon: string;
  path: string;
  order: string;
  navPlacement: string;
  adminOnly: boolean;
  status: string;
  desc: string;
}

export interface SystemStatusMeta {
  label: string;
  className: string;
  [key: string]: unknown;
}

export const DEFAULT_USER_FORM: UserFormDefaults = {
  username: "",
  displayName: "",
  status: "enabled",
  role: "admin",
  email: "",
  remark: "",
};

export const DEFAULT_PARAM_FORM: ParamFormDefaults = {
  categoryCode: "",
  code: "",
  name: "",
  value: "",
  status: "enabled",
  desc: "",
};

export const USER_STATUS_META: Record<string, SystemStatusMeta> = {
  enabled: { label: "启用", className: "st-on" },
  disabled: { label: "禁用", className: "st-off" },
};

export const USER_ROLE_META: Record<string, string> = {
  admin: "系统管理员",
  maintainer: "业务维护员",
};

export const PARAM_STATUS_META: Record<string, SystemStatusMeta> = {
  enabled: { label: "启用", className: "st-on" },
  disabled: { label: "禁用", className: "st-off" },
};

export const DEFAULT_MENU_FORM: MenuFormDefaults = {
  code: "",
  name: "",
  icon: "grid",
  path: "",
  order: "",
  navPlacement: "more",
  adminOnly: false,
  status: "enabled",
  desc: "",
};

export const MENU_STATUS_META: Record<string, SystemStatusMeta> = {
  enabled: { label: "启用", className: "st-on" },
  disabled: { label: "禁用", className: "st-off" },
};

export interface MenuIconOption {
  value: string;
  name: string;
}

export const MENU_ICON_OPTIONS: readonly MenuIconOption[] = [
  { value: "download", name: "下载 / 卸数" },
  { value: "db", name: "数据库" },
  { value: "link", name: "链接 / 映射" },
  { value: "book", name: "书 / 词根" },
  { value: "hash", name: "井号 / 指标" },
  { value: "push", name: "推送" },
  { value: "shield", name: "盾牌 / 系统" },
  { value: "grid", name: "宫格" },
  { value: "layers", name: "层级" },
  { value: "list", name: "列表" },
];
