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

export const DEFAULT_ASSET_ROUTE = { page: "home", table: null };
export const DEFAULT_PUSH_ROUTE = { page: "systems", sys: null, job: null };
export const DEFAULT_INDICATOR_ROUTE = { page: "list", id: null };
export const DEFAULT_REPORT_ROUTE = { page: "list", code: null };
export const DEFAULT_API_ASSET_ROUTE = { page: "list", code: null };
export const DEFAULT_ROOT_ROUTE = { page: "library", abbr: null };
export const DEFAULT_UP_ROUTE = { page: "list", id: null };
export const DEFAULT_SYSTEM_ROUTE = { page: "users" };
export const DEFAULT_MAPPING_ROUTE = {
  tab: "table",
  upstreamSystemId: "",
  sourceTable: "",
  dwfTable: "",
};
export const DEFAULT_LAYOUT = "list";
export const DEFAULT_PUSH_VIEW = "card";
export const DEFAULT_UP_VIEW = "card";
export const DEFAULT_DETAIL_TAB = "fields";
export const ASSET_LAYOUT_OPTIONS = new Set(["list", "card", "group"]);
export const DEFAULT_PUSH_FILTER = {
  status: null,
  protocol: null,
  dept: null,
  importanceLevel: null,
};
export const DEFAULT_ROOT_CATEGORY = null;
export const DEFAULT_UP_FILTER = { status: null, dbType: null };
export const DEFAULT_INDICATOR_FILTER = { dimension: "all", status: "all" };
export const DEFAULT_REPORT_FILTER = { type: null, status: null, ownerDept: null };
export const DEFAULT_API_ASSET_FILTER = { status: null, method: null, downstreamSystemId: null };
export const DEFAULT_INDICATOR_VIEW = "list";
export const DEFAULT_REPORT_VIEW = "list";
export const DEFAULT_API_ASSET_VIEW = "list";
export const ASSET_VIEW_OPTIONS = new Set(["list", "card", "group"]);
export const APP_VERSION = "V0.2.0";
export const DATA_MODE = (import.meta.env?.VITE_API_MODE || "mock").trim().toLowerCase();
export const DEFAULT_UPSTREAM_DB_TYPES = ["PostgreSQL", "MySQL", "Oracle", "SQL Server", "MongoDB", "Kafka", "Object Storage", "其他"];
export const DEFAULT_UPSTREAM_DEPTS = ["商品运营部", "会员运营部", "交易运营部", "门店运营部", "供应链部", "市场营销部", "履约运营部", "客户服务部"];
export const DEFAULT_PUSH_PROTOCOL_OPTIONS = ["HTTP", "OSS"];
export const DEFAULT_PUSH_AUTH_OPTIONS = ["演示占位配置", "无需认证"];
export const DEFAULT_PUSH_DELIMITER_OPTIONS = [
  { value: "|", name: "|" },
  { value: ",", name: "," },
  { value: "\\t", name: "\\t (Tab)" },
  { value: ";", name: ";" },
  { value: "\\u0001", name: "\\u0001 (SOH)" },
];
export const DEFAULT_PUSH_ENCODING_OPTIONS = [
  { value: "UTF-8", name: "UTF-8" },
  { value: "GBK", name: "GBK" },
  { value: "GB2312", name: "GB2312" },
  { value: "ISO-8859-1", name: "ISO-8859-1" },
];
export const DEFAULT_PUSH_FREQ_TYPE_OPTIONS = [
  { value: "T+1", name: "T+1" },
  { value: "T+0", name: "T+0" },
  { value: "准实时", name: "准实时" },
  { value: "每周", name: "每周" },
  { value: "每月", name: "每月" },
];
export const DEFAULT_STATUS_OPTIONS = [
  { value: "enabled", name: "启用" },
  { value: "disabled", name: "停用" },
];
export const INDICATOR_VIEW_OPTIONS = new Set(["list", "card", "group"]);
