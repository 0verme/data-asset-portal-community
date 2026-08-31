// Copyright 2025 Jearhe
// Licensed under the Apache License, Version 2.0.

function items(values) {
  return values.map((value, index) => ({
    code: String(value).toUpperCase().replaceAll(/[^A-Z0-9]+/g, "_") || `ITEM_${index + 1}`,
    name: value,
    value,
    desc: `${value}演示选项`,
    order: (index + 1) * 10,
    active: true,
  }));
}

function category(code, name, values) {
  return { code, name, desc: `${name}公共码值`, active: true, items: items(values) };
}

const COMMON_CODES = {
  categories: [
    category("UPSTREAM_DB_TYPE", "上游数据库类型", ["PostgreSQL", "MySQL", "Oracle", "SQL Server", "MongoDB", "Kafka", "Object Storage", "其他"]),
    category("UPSTREAM_DEPT", "零售业务部门", ["商品运营部", "会员运营部", "交易运营部", "门店运营部", "供应链部", "市场营销部", "履约运营部", "客户服务部"]),
    category("PUSH_PROTOCOL", "下游推送协议", ["HTTP", "OSS"]),
    category("PUSH_AUTH_TYPE", "下游认证方式", ["密钥认证", "账号密码"]),
    category("PUSH_DELIMITER", "字段分隔符", ["|", ",", "\\t", ";", "\\u0001"]),
    category("FILE_ENCODING", "文件编码", ["UTF-8", "GBK", "GB2312", "ISO-8859-1"]),
    category("FREQ_TYPE", "推送频率", ["T+1", "T+0", "准实时", "每周", "每月"]),
    category("REPORT_TYPE", "报表类型", ["经营分析", "运营分析", "供应链分析", "营销分析", "服务分析"]),
    category("REPORT_STAT_PERIOD", "统计周期", ["实时", "小时", "日", "周", "月", "季", "年", "不定期"]),
    category("REPORT_DATE_CALIBER", "统计口径", ["当日", "T-1日", "自然周", "上一自然周", "自然月", "上一自然月", "自然季", "自然年"]),
    category("REPORT_DATA_TIMELINESS", "数据延迟", ["实时", "T+0", "T+1", "T+2"]),
    {
      code: "SYSTEM_STATUS",
      name: "系统状态",
      desc: "系统启停状态选项",
      active: true,
      items: [
        { code: "ENABLED", name: "启用", value: "enabled", desc: "系统启用", order: 10, active: true },
        { code: "DISABLED", name: "禁用", value: "disabled", desc: "系统禁用", order: 20, active: true },
      ],
    },
  ],
};

export default COMMON_CODES;
