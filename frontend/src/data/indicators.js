// Copyright 2025 Jearhe
// Licensed under the Apache License, Version 2.0.

export const INDICATOR_DIMENSIONS = [
  { value: "all", label: "全部指标", code: "ALL" },
  { value: "prd", label: "商品维度", code: "PRD" },
  { value: "mem", label: "会员维度", code: "MEM" },
  { value: "ord", label: "交易维度", code: "ORD" },
  { value: "str", label: "门店维度", code: "STR" },
  { value: "inv", label: "库存维度", code: "INV" },
  { value: "mkt", label: "营销维度", code: "MKT" },
  { value: "ful", label: "履约维度", code: "FUL" },
  { value: "svc", label: "售后维度", code: "SVC" },
];

export const INDICATOR_STATUS_OPTIONS = [
  { value: "all", label: "全部状态" },
  { value: "enabled", label: "启用" },
  { value: "disabled", label: "禁用" },
];

const SPECS = [
  ["PRD00001", "在售商品数", "prd", "商品运营", "规模", "dws_product_listing_status_dd", "listing_status", "统计当前处于上架状态的 SKU 数量。"],
  ["PRD00002", "商品动销率", "prd", "商品运营", "动销", "dws_product_sku_detail_di", "sale_price", "统计周期内发生销售的商品占全部在售商品的比例。"],
  ["PRD00003", "平均零售价格", "prd", "价格分析", "价格", "dws_product_sku_detail_di", "sale_price", "按在售 SKU 计算平均零售价格。"],
  ["PRD00004", "价格调整商品数", "prd", "价格分析", "变更", "dws_product_price_change_di", "after_price", "统计周期内发生价格调整的商品数量。"],

  ["MEM00001", "新增会员数", "mem", "会员增长", "新增", "dws_member_profile_full_dd", "join_date", "统计周期内新加入的虚构会员数量。"],
  ["MEM00002", "活跃会员数", "mem", "会员活跃", "活跃", "dws_member_activity_stat_1d", "active_flag", "统计当天发生访问、互动或下单行为的会员数量。"],
  ["MEM00003", "会员复购率", "mem", "会员价值", "复购", "dws_member_activity_stat_1d", "order_count", "统计周期内完成两次及以上购买的会员占比。"],
  ["MEM00004", "高价值会员数", "mem", "会员价值", "分层", "dws_member_segment_result_dd", "segment_code", "统计被划入高价值分群的会员数量。"],
  ["MEM00005", "会员互动次数", "mem", "会员活跃", "互动", "dws_member_activity_stat_1d", "interaction_count", "统计会员在各零售触点产生的互动次数。"],

  ["ORD00001", "销售额", "ord", "销售分析", "规模", "dws_trade_sales_stat_1d", "gross_sales_amount", "统计有效订单产生的含优惠前销售总额。"],
  ["ORD00002", "净销售额", "ord", "销售分析", "规模", "dws_trade_sales_stat_1d", "net_sales_amount", "统计扣除退款等调整后的零售净销售额。"],
  ["ORD00003", "有效订单数", "ord", "销售分析", "订单", "dws_trade_sales_stat_1d", "order_count", "统计已支付且未关闭的有效订单数量。"],
  ["ORD00004", "平均客单价", "ord", "销售分析", "效率", "dws_trade_order_detail_di", "paid_amount", "按净销售额除以有效订单数计算平均客单价。"],
  ["ORD00005", "连带销售件数", "ord", "商品分析", "件单", "dws_trade_order_item_di", "sale_quantity", "统计每笔订单平均包含的商品件数。"],

  ["STR00001", "门店销售额", "str", "门店经营", "销售", "dws_store_target_progress_1d", "actual_sales", "统计线下门店完成的销售金额。"],
  ["STR00002", "门店目标达成率", "str", "门店经营", "目标", "dws_store_target_progress_1d", "achievement_rate", "统计门店实际销售额相对销售目标的完成比例。"],
  ["STR00003", "进店客流量", "str", "客流分析", "客流", "dws_store_traffic_stat_1h", "visitor_count", "汇总门店各小时段进店人数。"],
  ["STR00004", "门店成交转化率", "str", "客流分析", "转化", "dws_store_traffic_stat_1h", "buyer_count", "按成交人数除以进店人数计算门店转化率。"],

  ["INV00001", "可售库存量", "inv", "库存健康", "库存", "dws_inventory_stock_snap_dd", "available_quantity", "统计仓库和门店当前可用于销售的库存数量。"],
  ["INV00002", "缺货商品数", "inv", "库存健康", "缺货", "dws_inventory_stock_snap_dd", "available_quantity", "统计可售库存为零的在售商品数量。"],
  ["INV00003", "库存周转天数", "inv", "库存效率", "周转", "dws_inventory_turnover_stat_1d", "turnover_days", "衡量当前库存按近期销售成本消化所需天数。"],
  ["INV00004", "建议补货量", "inv", "补货管理", "建议", "dws_inventory_replenishment_di", "suggested_quantity", "汇总系统生成且尚未执行的建议补货数量。"],
  ["INV00005", "在途库存量", "inv", "库存健康", "在途", "dws_inventory_stock_snap_dd", "in_transit_quantity", "统计已经发出但尚未完成入库的商品数量。"],

  ["MKT00001", "营销曝光次数", "mkt", "活动效果", "曝光", "dws_marketing_conversion_stat_1d", "exposure_count", "统计活动在各触点产生的有效曝光次数。"],
  ["MKT00002", "营销点击次数", "mkt", "活动效果", "互动", "dws_marketing_conversion_stat_1d", "click_count", "统计活动素材获得的有效点击次数。"],
  ["MKT00003", "活动转化率", "mkt", "活动效果", "转化", "dws_marketing_conversion_stat_1d", "conversion_rate", "按活动带来的订单数除以有效点击数计算转化率。"],
  ["MKT00004", "优惠券使用金额", "mkt", "优惠分析", "用券", "dws_marketing_coupon_use_di", "coupon_amount", "汇总已核销优惠券的券面金额。"],

  ["FUL00001", "履约包裹数", "ful", "配送效率", "规模", "dws_fulfillment_delivery_stat_1d", "package_count", "统计进入仓配履约流程的包裹数量。"],
  ["FUL00002", "准时履约率", "ful", "配送效率", "时效", "dws_fulfillment_delivery_stat_1d", "on_time_rate", "统计在承诺时间内完成送达或自提的包裹比例。"],
  ["FUL00003", "平均履约时长", "ful", "配送效率", "时效", "dws_fulfillment_delivery_stat_1d", "average_hours", "统计订单支付到完成履约的平均小时数。"],
  ["FUL00004", "物流异常包裹数", "ful", "履约质量", "异常", "dws_fulfillment_route_event_di", "exception_flag", "统计出现延迟、退回或轨迹中断事件的包裹数。"],

  ["SVC00001", "退货申请数", "svc", "退换货", "申请", "dws_service_return_request_di", "return_quantity", "统计消费者发起的有效退货申请数量。"],
  ["SVC00002", "商品退货率", "svc", "退换货", "质量", "dws_service_return_request_di", "return_quantity", "按退货商品件数除以已售商品件数计算。"],
  ["SVC00003", "退款完成金额", "svc", "退款处理", "金额", "dws_service_refund_detail_di", "refund_amount", "汇总已经完成的退款处理金额。"],
  ["SVC00004", "客服工单解决率", "svc", "客户服务", "效率", "dws_service_ticket_di", "ticket_status", "统计周期内已解决工单占已受理工单的比例。"],
  ["SVC00005", "商品平均评分", "svc", "客户声音", "评价", "dws_service_review_di", "rating_score", "统计有效商品评价的平均星级。"],
];

export const INDICATORS = SPECS.map(([id, name, dimension, group, topic, resultTableName, resultFieldName, meaning], index) => ({
  id,
  name,
  meaning,
  resultTableName,
  resultFieldName,
  dimension,
  caliber: "全渠道零售演示口径",
  path: `${dimension.toUpperCase()} > ${group} > ${topic}`,
  registrar: "演示数据维护组",
  registeredAt: `2026-07-${String((index % 20) + 1).padStart(2, "0")}`,
  status: index === 35 ? "disabled" : "enabled",
}));

export const INDICATOR_DIMENSION_OPTIONS = INDICATOR_DIMENSIONS.filter((item) => item.value !== "all");
