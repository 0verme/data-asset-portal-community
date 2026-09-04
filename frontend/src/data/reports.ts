// Copyright 2025 Jearhe
// Licensed under the Apache License, Version 2.0.

export interface RelatedTableSummary {
  tableName: string;
  tableCn?: string | undefined;
  domain?: string | undefined;
  layer?: string | undefined;
  [key: string]: unknown;
}

export interface RelatedIndicatorSummary {
  indicatorId: string;
  indicatorName?: string | undefined;
  dimension?: string | undefined;
  path?: string | undefined;
  [key: string]: unknown;
}

export interface MockReportItem {
  code: string;
  name: string;
  alias: string;
  type: string;
  domain: string;
  freq: string;
  statPeriod: string;
  dateCaliber: string;
  dateCaliberOther: string;
  dataTimeliness: string;
  dataTimelinessCustom: string;
  statCaliber?: string | undefined;
  dataDelay?: string | undefined;
  businessScopeTags?: string | undefined;
  legacyFreq?: string | undefined;
  legacyTimeCaliber?: string | undefined;
  status: string;
  effectiveDate: string;
  expireDate: string;
  purpose: string;
  statObject: string;
  statScope: string;
  timeCaliber: string;
  filterCondition: string;
  specialRule: string;
  ownerDept: string;
  ownerName: string;
  maintainerName: string;
  relatedTables: RelatedTableSummary[];
  relatedIndicators: RelatedIndicatorSummary[];
  remark: string;
  updatedBy: string;
  updatedAt: string;
  [key: string]: unknown;
}

const SPECS: ReadonlyArray<
  [string, string, string, string, string, string, string, string[]]
> = [
  [
    "RPT_RETAIL_DAILY",
    "全渠道零售经营日报",
    "经营分析",
    "交易",
    "日报",
    "dwm_trade_sales_stat_1d",
    "全渠道销售汇总日表",
    ["ORD00001", "ORD00003", "ORD00004"],
  ],
  [
    "RPT_STORE_WEEKLY",
    "门店经营周报",
    "经营分析",
    "门店",
    "周报",
    "dwm_store_target_progress_1d",
    "门店目标达成日表",
    ["STR00001", "STR00002", "STR00004"],
  ],
  [
    "RPT_PRODUCT_WEEKLY",
    "商品运营周报",
    "运营分析",
    "商品",
    "周报",
    "dwm_product_sku_detail_di",
    "商品 SKU 明细中间表",
    ["PRD00001", "PRD00002", "PRD00003"],
  ],
  [
    "RPT_MEMBER_MONTHLY",
    "会员增长月报",
    "运营分析",
    "会员",
    "月报",
    "dwm_member_activity_stat_1d",
    "会员活跃统计日表",
    ["MEM00001", "MEM00002", "MEM00003"],
  ],
  [
    "RPT_INVENTORY_DAILY",
    "库存健康日报",
    "供应链分析",
    "库存",
    "日报",
    "dwm_inventory_stock_snap_dd",
    "仓店库存快照日表",
    ["INV00001", "INV00002", "INV00005"],
  ],
  [
    "RPT_CAMPAIGN",
    "营销活动复盘报告",
    "营销分析",
    "营销",
    "按活动",
    "dwm_marketing_conversion_stat_1d",
    "营销转化统计日表",
    ["MKT00001", "MKT00003", "MKT00004"],
  ],
  [
    "RPT_FULFILLMENT",
    "履约服务质量周报",
    "服务分析",
    "履约",
    "周报",
    "dwm_fulfillment_delivery_stat_1d",
    "履约时效统计日表",
    ["FUL00001", "FUL00002", "FUL00004"],
  ],
  [
    "RPT_AFTERSALE",
    "售后体验月报",
    "服务分析",
    "售后",
    "月报",
    "dwm_service_return_request_di",
    "退货申请明细表",
    ["SVC00001", "SVC00002", "SVC00005"],
  ],
];

const INDICATOR_NAMES: Record<string, string> = {
  ORD00001: "销售额",
  ORD00003: "有效订单数",
  ORD00004: "平均客单价",
  STR00001: "门店销售额",
  STR00002: "门店目标达成率",
  STR00004: "门店成交转化率",
  PRD00001: "在售商品数",
  PRD00002: "商品动销率",
  PRD00003: "平均零售价格",
  MEM00001: "新增会员数",
  MEM00002: "活跃会员数",
  MEM00003: "会员复购率",
  INV00001: "可售库存量",
  INV00002: "缺货商品数",
  INV00005: "在途库存量",
  MKT00001: "营销曝光次数",
  MKT00003: "活动转化率",
  MKT00004: "优惠券使用金额",
  FUL00001: "履约包裹数",
  FUL00002: "准时履约率",
  FUL00004: "物流异常包裹数",
  SVC00001: "退货申请数",
  SVC00002: "商品退货率",
  SVC00005: "商品平均评分",
};

export const REPORTS: MockReportItem[] = SPECS.map(
  (
    [code, name, type, domain, freq, tableName, tableCn, indicatorIds],
    index,
  ) => ({
    code,
    name,
    alias: `${domain}演示报表`,
    type,
    domain,
    freq,
    statPeriod: freq.includes("日") ? "日" : freq.includes("周") ? "周" : "月",
    dateCaliber: "自然日",
    dateCaliberOther: "",
    dataTimeliness: "T+1",
    dataTimelinessCustom: "",
    status: index === 7 ? "disabled" : "enabled",
    effectiveDate: "2026-07-01",
    expireDate: "",
    purpose: `展示全渠道零售场景下的${domain}数据治理与经营分析能力。`,
    statObject: `虚构零售${domain}业务`,
    statScope: "线上商城、门店 POS 与小程序三个演示渠道",
    timeCaliber: "按业务完成时间归属自然日",
    filterCondition: "仅统计有效演示记录，剔除已关闭记录。",
    specialRule: "跨渠道订单按统一订单标识去重。",
    ownerDept: `${domain}运营部`,
    ownerName: "演示业务维护组",
    maintainerName: "演示数据维护组",
    relatedTables: [{ tableName, tableCn, domain, layer: "DWM" }],
    relatedIndicators: indicatorIds.map((indicatorId) => ({
      indicatorId,
      indicatorName: INDICATOR_NAMES[indicatorId],
      dimension: indicatorId.slice(0, 3).toLowerCase(),
      path: "零售演示指标目录",
    })),
    remark: "全部内容均为虚构演示数据。",
    updatedBy: "demo",
    updatedAt: `2026-07-${String(index + 10).padStart(2, "0")} 10:00:00`,
  }),
);
