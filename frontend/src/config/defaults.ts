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

import {
  UPSTREAM_DB_TYPE_VALUES,
  UPSTREAM_DEPT_VALUES,
} from "../data/commonCodes.ts";

export interface AssetRoute {
  page: string;
  table: string | null;
}

export interface PushRoute {
  page: string;
  sys: string | null;
  job: string | null;
}

export interface IndicatorRoute {
  page: string;
  id: string | null;
}

export interface ReportRoute {
  page: string;
  code: string | null;
}

export interface ApiAssetRoute {
  page: string;
  code: string | null;
}

export interface RootRoute {
  page: string;
  abbr: string | null;
}

export interface UpRoute {
  page: string;
  id: string | null;
}

export interface SystemRoute {
  page: string;
}

export interface MappingRoute {
  tab: string;
  sourceSystemId: string;
  sourceTable: string;
  dwfTable: string;
}

export const DEFAULT_ASSET_ROUTE: AssetRoute = { page: "home", table: null };
export const DEFAULT_PUSH_ROUTE: PushRoute = {
  page: "systems",
  sys: null,
  job: null,
};
export const DEFAULT_INDICATOR_ROUTE: IndicatorRoute = {
  page: "list",
  id: null,
};
export const DEFAULT_REPORT_ROUTE: ReportRoute = { page: "list", code: null };
export const DEFAULT_API_ASSET_ROUTE: ApiAssetRoute = {
  page: "list",
  code: null,
};
export const DEFAULT_ROOT_ROUTE: RootRoute = { page: "library", abbr: null };
export const DEFAULT_UP_ROUTE: UpRoute = { page: "list", id: null };
export const DEFAULT_SYSTEM_ROUTE: SystemRoute = { page: "users" };
export const DEFAULT_MAPPING_ROUTE: MappingRoute = {
  tab: "table",
  sourceSystemId: "",
  sourceTable: "",
  dwfTable: "",
};

export const DEFAULT_LAYOUT = "list";
export const DEFAULT_PUSH_VIEW = "card";
export const DEFAULT_UP_VIEW = "card";
export const DEFAULT_DETAIL_TAB = "fields";
export const ASSET_LAYOUT_OPTIONS: ReadonlySet<string> = new Set([
  "list",
  "card",
  "group",
]);

export interface PushFilter {
  status: string | null;
  protocol: string | null;
  dept: string | null;
  importanceLevel: string | null;
}

export const DEFAULT_PUSH_FILTER: PushFilter = {
  status: null,
  protocol: null,
  dept: null,
  importanceLevel: null,
};

export const DEFAULT_ROOT_CATEGORY: string | null = null;

export interface UpFilter {
  status: string | null;
  dbType: string | null;
}

export const DEFAULT_UP_FILTER: UpFilter = { status: null, dbType: null };

export interface IndicatorFilter {
  dimension: string;
  status: string;
}

export const DEFAULT_INDICATOR_FILTER: IndicatorFilter = {
  dimension: "all",
  status: "all",
};

export interface ReportFilter {
  type: string | null;
  status: string | null;
  ownerDept: string | null;
}

export const DEFAULT_REPORT_FILTER: ReportFilter = {
  type: null,
  status: null,
  ownerDept: null,
};

export interface ApiAssetFilter {
  status: string | null;
  method: string | null;
  downstreamSystemId: string | null;
}

export const DEFAULT_API_ASSET_FILTER: ApiAssetFilter = {
  status: null,
  method: null,
  downstreamSystemId: null,
};

export const DEFAULT_INDICATOR_VIEW = "list";
export const DEFAULT_REPORT_VIEW = "list";
export const DEFAULT_API_ASSET_VIEW = "list";
export const ASSET_VIEW_OPTIONS: ReadonlySet<string> = new Set([
  "list",
  "card",
  "group",
]);
export const APP_VERSION = "V0.2.0";

export const DATA_MODE = (
  typeof import.meta !== "undefined" && import.meta.env?.["VITE_API_MODE"]
    ? String(import.meta.env["VITE_API_MODE"])
    : "mock"
)
  .trim()
  .toLowerCase();

// Compatibility aliases retained for modules that use the defaults namespace.
// The option values themselves are defined by the local common-code catalog.
export const DEFAULT_UPSTREAM_DB_TYPES = UPSTREAM_DB_TYPE_VALUES;
export const DEFAULT_UPSTREAM_DEPTS = UPSTREAM_DEPT_VALUES;

export const DEFAULT_PUSH_PROTOCOL_OPTIONS = ["HTTP", "OSS"] as const;
export const DEFAULT_PUSH_AUTH_OPTIONS = ["密钥认证", "账号密码"] as const;

export interface NamedOption<T = string> {
  value: T;
  name: string;
}

export const DEFAULT_PUSH_DELIMITER_OPTIONS: readonly NamedOption[] = [
  { value: "|", name: "|" },
  { value: ",", name: "," },
  { value: "\\t", name: "\\t (Tab)" },
  { value: ";", name: ";" },
  { value: "\\u0001", name: "\\u0001 (SOH)" },
] as const;

export const DEFAULT_PUSH_ENCODING_OPTIONS: readonly NamedOption[] = [
  { value: "UTF-8", name: "UTF-8" },
  { value: "GBK", name: "GBK" },
  { value: "GB2312", name: "GB2312" },
  { value: "ISO-8859-1", name: "ISO-8859-1" },
] as const;

export const DEFAULT_PUSH_FREQ_TYPE_OPTIONS: readonly NamedOption[] = [
  { value: "T+1", name: "T+1" },
  { value: "T+0", name: "T+0" },
  { value: "准实时", name: "准实时" },
  { value: "每周", name: "每周" },
  { value: "每月", name: "每月" },
] as const;

export const DEFAULT_STATUS_OPTIONS: readonly NamedOption[] = [
  { value: "enabled", name: "启用" },
  { value: "disabled", name: "禁用" },
] as const;

export const INDICATOR_VIEW_OPTIONS: ReadonlySet<string> = new Set([
  "list",
  "card",
  "group",
]);
