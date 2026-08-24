export const DEFAULT_ASSET_ROUTE: {
  page: string;
  table: string | null;
};
export const DEFAULT_PUSH_ROUTE: {
  page: string;
  sys: string | null;
  job: string | null;
};
export const DEFAULT_INDICATOR_ROUTE: {
  page: string;
  id: string | null;
};
export const DEFAULT_REPORT_ROUTE: {
  page: string;
  code: string | null;
};
export const DEFAULT_API_ASSET_ROUTE: {
  page: string;
  code: string | null;
};
export const DEFAULT_ROOT_ROUTE: {
  page: string;
  abbr: string | null;
};
export const DEFAULT_UP_ROUTE: {
  page: string;
  id: string | null;
};
export const DEFAULT_SYSTEM_ROUTE: {
  page: string;
};
export const DEFAULT_MAPPING_ROUTE: {
  tab: string;
  upstreamSystemId: string;
  sourceTable: string;
  dwfTable: string;
};
export const DEFAULT_LAYOUT: string;
export const DEFAULT_PUSH_VIEW: string;
export const DEFAULT_UP_VIEW: string;
export const DEFAULT_DETAIL_TAB: string;
export const ASSET_LAYOUT_OPTIONS: ReadonlySet<string>;
export const DEFAULT_PUSH_FILTER: {
  status: string | null;
  protocol: string | null;
  dept: string | null;
  importanceLevel: string | null;
};
export const DEFAULT_ROOT_CATEGORY: string | null;
export const DEFAULT_UP_FILTER: {
  status: string | null;
  dbType: string | null;
};
export const DEFAULT_INDICATOR_FILTER: {
  dimension: string;
  status: string;
};
export const DEFAULT_REPORT_FILTER: {
  type: string | null;
  status: string | null;
  ownerDept: string | null;
};
export const DEFAULT_API_ASSET_FILTER: {
  status: string | null;
  method: string | null;
  downstreamSystemId: string | null;
};
export const DEFAULT_INDICATOR_VIEW: string;
export const DEFAULT_REPORT_VIEW: string;
export const DEFAULT_API_ASSET_VIEW: string;
export const ASSET_VIEW_OPTIONS: ReadonlySet<string>;
export const APP_VERSION: string;
export const DATA_MODE: string;
export const DEFAULT_UPSTREAM_DB_TYPES: readonly string[];
export const DEFAULT_UPSTREAM_DEPTS: readonly string[];
export const DEFAULT_PUSH_PROTOCOL_OPTIONS: readonly string[];
export const DEFAULT_PUSH_AUTH_OPTIONS: readonly string[];
export const DEFAULT_PUSH_DELIMITER_OPTIONS: readonly {
  value: string;
  name: string;
}[];
export const DEFAULT_PUSH_ENCODING_OPTIONS: readonly {
  value: string;
  name: string;
}[];
export const DEFAULT_PUSH_FREQ_TYPE_OPTIONS: readonly {
  value: string;
  name: string;
}[];
export const DEFAULT_STATUS_OPTIONS: readonly {
  value: string;
  name: string;
}[];
export const INDICATOR_VIEW_OPTIONS: ReadonlySet<string>;
