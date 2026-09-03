// Copyright 2025 Jearhe
// Licensed under the Apache License, Version 2.0.
//
// Local mock option catalog only. The retired /api/common-codes endpoint is
// not a frontend runtime contract.

export interface CommonCodeItem {
  code: string;
  name: string;
  value: string;
  desc: string;
  order: number;
  active: boolean;
}

export interface CommonCodeCategory {
  code: string;
  name: string;
  desc: string;
  active: boolean;
  items: CommonCodeItem[];
}

export interface CommonCodeCatalog {
  categories: CommonCodeCategory[];
}

export interface UpstreamOption {
  code: string;
  name: string;
  value: string;
}

type OptionSeed = string | UpstreamOption;

function items(values: readonly OptionSeed[]): CommonCodeItem[] {
  return values.map((item, index) => {
    const option = typeof item === "string"
      ? { code: "", name: item, value: item }
      : item;
    return {
      code:
        option.code ||
        String(option.value)
          .toUpperCase()
          .replaceAll(/[^A-Z0-9]+/g, "_") || `ITEM_${index + 1}`,
      name: option.name,
      value: option.value,
      desc: `${option.name}演示选项`,
      order: (index + 1) * 10,
      active: true,
    };
  });
}

function category(
  code: string,
  name: string,
  values: readonly OptionSeed[],
): CommonCodeCategory {
  return {
    code,
    name,
    desc: `${name}公共码值`,
    active: true,
    items: items(values),
  };
}

export const UPSTREAM_DB_TYPE_OPTIONS = [
  { code: "POSTGRESQL", name: "PostgreSQL", value: "PostgreSQL" },
  { code: "MYSQL", name: "MySQL", value: "MySQL" },
  { code: "ORACLE", name: "Oracle", value: "Oracle" },
  { code: "SQL_SERVER", name: "SQL Server", value: "SQL Server" },
  { code: "MONGODB", name: "MongoDB", value: "MongoDB" },
  { code: "KAFKA", name: "Kafka", value: "Kafka" },
  { code: "OBJECT_STORAGE", name: "Object Storage", value: "Object Storage" },
  { code: "OTHER", name: "其他", value: "其他" },
] as const satisfies readonly UpstreamOption[];

export const UPSTREAM_DEPT_OPTIONS = [
  { code: "PRODUCT_OPERATIONS", name: "商品运营部", value: "商品运营部" },
  { code: "MEMBER_OPERATIONS", name: "会员运营部", value: "会员运营部" },
  { code: "TRADE_OPERATIONS", name: "交易运营部", value: "交易运营部" },
  { code: "STORE_OPERATIONS", name: "门店运营部", value: "门店运营部" },
  { code: "SUPPLY_CHAIN", name: "供应链部", value: "供应链部" },
  { code: "MARKETING", name: "市场营销部", value: "市场营销部" },
  { code: "FULFILLMENT", name: "履约运营部", value: "履约运营部" },
  { code: "CUSTOMER_SERVICE", name: "客户服务部", value: "客户服务部" },
] as const satisfies readonly UpstreamOption[];

export const UPSTREAM_DB_TYPE_VALUES = UPSTREAM_DB_TYPE_OPTIONS.map(({ value }) => value);
export const UPSTREAM_DEPT_VALUES = UPSTREAM_DEPT_OPTIONS.map(({ value }) => value);

const COMMON_CODES: CommonCodeCatalog = {
  categories: [
    category("UPSTREAM_DB_TYPE", "上游数据库类型", UPSTREAM_DB_TYPE_OPTIONS),
    category("UPSTREAM_DEPT", "零售业务部门", UPSTREAM_DEPT_OPTIONS),
    category("PUSH_PROTOCOL", "下游推送协议", ["HTTP", "OSS"]),
    category("PUSH_AUTH_TYPE", "下游认证方式", ["密钥认证", "账号密码"]),
    category("PUSH_DELIMITER", "字段分隔符", ["|", ",", "\\t", ";", "\\u0001"]),
    category("FILE_ENCODING", "文件编码", [
      "UTF-8",
      "GBK",
      "GB2312",
      "ISO-8859-1",
    ]),
    category("FREQ_TYPE", "推送频率", ["T+1", "T+0", "准实时", "每周", "每月"]),
    category("REPORT_STAT_PERIOD", "统计周期", [
      "实时",
      "小时",
      "日",
      "周",
      "月",
      "季",
      "年",
      "不定期",
    ]),
    category("REPORT_DATE_CALIBER", "统计口径", [
      "当日",
      "T-1日",
      "自然周",
      "上一自然周",
      "自然月",
      "上一自然月",
      "自然季",
      "自然年",
    ]),
    category("REPORT_DATA_TIMELINESS", "数据延迟", [
      "实时",
      "T+0",
      "T+1",
      "T+2",
    ]),
    // Kept only for mock/local catalog consumers; runtime status options come
    // from the shared BINARY_STATUS_OPTIONS contract.
    {
      code: "SYSTEM_STATUS",
      name: "系统状态",
      desc: "系统启停状态选项",
      active: true,
      items: [
        {
          code: "ENABLED",
          name: "启用",
          value: "enabled",
          desc: "系统启用",
          order: 10,
          active: true,
        },
        {
          code: "DISABLED",
          name: "禁用",
          value: "disabled",
          desc: "系统禁用",
          order: 20,
          active: true,
        },
      ],
    },
  ],
};

export default COMMON_CODES;
