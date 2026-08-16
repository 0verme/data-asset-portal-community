// Copyright 2025 Jearhe
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

export const DEFAULT_USER_FORM = {
  username: "",
  displayName: "",
  status: "enabled",
  role: "admin",
  email: "",
  remark: "",
};

export const DEFAULT_PARAM_FORM = {
  categoryCode: "",
  code: "",
  name: "",
  value: "",
  status: "enabled",
  desc: "",
};

export const USER_STATUS_META = {
  enabled: { label: "启用", className: "st-on" },
  disabled: { label: "禁用", className: "st-off" },
};

export const USER_ROLE_META = {
  admin: "系统管理员",
  maintainer: "业务维护员",
};

export const PARAM_STATUS_META = {
  enabled: { label: "启用", className: "st-on" },
  disabled: { label: "禁用", className: "st-off" },
};

export const DEFAULT_MENU_FORM = {
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

export const MENU_STATUS_META = {
  enabled: { label: "启用", className: "st-on" },
  disabled: { label: "禁用", className: "st-off" },
};

export const MENU_ICON_OPTIONS = [
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
