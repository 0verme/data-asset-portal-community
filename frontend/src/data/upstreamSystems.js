// Copyright 2025 Jearhe
// Licensed under the Apache License, Version 2.0.

export const DB_TYPE_OPTIONS = ["PostgreSQL", "MySQL", "Oracle", "SQL Server", "MongoDB", "Kafka", "Object Storage", "其他"];

const SPECS = [
  [1, "up_member", "MEM", "会员中心", "PostgreSQL", "会员运营部", "会员档案、等级与成长事件"],
  [2, "up_product", "PIM", "商品中心", "MySQL", "商品运营部", "商品、类目、价格与上下架信息"],
  [3, "up_order", "OMS", "订单中心", "PostgreSQL", "交易运营部", "线上订单、订单商品与支付状态"],
  [4, "up_pos", "POS", "门店 POS", "SQL Server", "门店运营部", "门店小票、班次与收银汇总"],
  [5, "up_inventory", "IMS", "库存中心", "Oracle", "供应链部", "仓店库存、异动与补货建议"],
  [6, "up_marketing", "MKT", "营销平台", "MongoDB", "市场营销部", "活动、触点互动与优惠券数据"],
  [7, "up_fulfillment", "FUL", "履约平台", "Kafka", "履约运营部", "包裹、配送轨迹与自提状态"],
  [8, "up_service", "SVC", "售后中心", "Object Storage", "客户服务部", "退货、退款、工单与评价数据"],
];

export const UPSTREAM_SYSTEMS = SPECS.map(([upstreamSystemId, id, abbr, name, dbType, dept, subject], index) => ({
  upstreamSystemId,
  id,
  abbr,
  name,
  dbType,
  host: `${abbr.toLowerCase()}.demo.invalid`,
  db: `DEMO_${abbr}`,
  schema: `DEMO_${abbr}_OWNER`,
  unloadTimes: index === 6 ? ["00:15", "00:30", "00:45"] : ["01:00", "07:00", "13:00", "19:00"],
  status: index === 7 ? "disabled" : "enabled",
  owner: "演示数据维护组",
  dept,
  desc: `${subject}，仅用于完全虚构的零售演示。`,
}));
