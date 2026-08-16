// Copyright 2025 Jearhe
// Licensed under the Apache License, Version 2.0.

const OUTPUTS = [
  ["BI", "零售经营看板", "经营分析部", "HTTP", "trade_sales_stat_1d", "全渠道销售日汇总", ["store_id", "order_count", "net_sales_amount", "dt"]],
  ["REPL", "智能补货工作台", "供应链部", "HTTP", "inventory_replenishment_di", "仓店补货建议", ["location_id", "sku_id", "safety_stock", "suggested_quantity"]],
  ["CDP", "会员运营工作台", "会员运营部", "OSS", "member_segment_result_dd", "会员分群结果", ["member_id", "segment_code", "segment_name", "effective_date"]],
  ["MKT", "营销触达中心", "市场营销部", "HTTP", "marketing_conversion_stat_1d", "活动转化汇总", ["campaign_id", "exposure_count", "click_count", "conversion_rate"]],
  ["FUL", "履约监控中心", "履约运营部", "HTTP", "fulfillment_delivery_stat_1d", "履约时效日汇总", ["fulfillment_type", "package_count", "average_hours", "on_time_rate"]],
  ["VOC", "客户声音分析台", "客户服务部", "OSS", "service_review_di", "商品评价主题数据", ["review_id", "sku_id", "rating_score", "review_tag"]],
];

function makeFields(names) {
  return names.map((name) => ({
    name,
    cn: name.replaceAll("_", " "),
    meaning: `演示字段 ${name}`,
    src: "DWM",
    type: name.endsWith("amount") || name.endsWith("rate") || name.endsWith("hours") ? "decimal(18,2)" : "string",
  }));
}

export const PUSH_SYSTEMS = OUTPUTS.map(([abbr, name, dept, protocol, table, jobName, fields], index) => ({
  id: `DEMO_${abbr}`,
  name,
  abbr,
  desc: `${name}消费完全虚构的零售主题数据，用于外部产品演示。`,
  protocol,
  host: `${abbr.toLowerCase()}.consumer.demo.invalid`,
  port: protocol === "HTTP" ? 443 : 9000,
  account: "DEMO_ONLY",
  auth: "演示占位配置",
  downstreamContact: "演示业务维护组",
  dataDeveloperContact: "演示数据维护组",
  dept,
  status: index === 5 ? "disabled" : "enabled",
  importanceLevel: "normal",
  latestOutputTime: "",
  jobs: [
    {
      id: `JOB_${abbr}_${String(index + 1).padStart(2, "0")}`,
      cn: jobName,
      sourcePath: `/demo/dwm/${table}/dt=\${yyyy-MM-dd}`,
      sourceFileName: `${table}_\${yyyyMMdd}.json`,
      targetPath: `/demo/incoming/${abbr.toLowerCase()}/`,
      targetFileName: `${table}_\${yyyyMMdd}.json`,
      freqType: "T+1",
      freq: "",
      delimiter: ",",
      encoding: "UTF-8",
      rowCnt: `约 ${(index + 1) * 2} 万行`,
      enabled: index !== 5,
      desc: `${jobName}，内容均为确定性的虚构演示数据。`,
      fields: makeFields(fields),
    },
  ],
}));
