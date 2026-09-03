// Copyright 2025 Jearhe
// Licensed under the Apache License, Version 2.0.

import { normalizeDataType } from "../constants/dataTypes.ts";

export interface TableField {
  name: string;
  cn: string;
  type: string;
  nullable: boolean;
  pk: boolean;
  part: boolean;
  enum: string | null;
}

export interface FieldOptions {
  nullable?: boolean;
  pk?: boolean;
  part?: boolean;
  enum?: string | null;
}

function field(
  name: string,
  cn: string,
  type = "string",
  options: FieldOptions = {},
): TableField {
  return {
    name,
    cn,
    type: normalizeDataType(type),
    nullable: Boolean(options.nullable),
    pk: Boolean(options.pk),
    part: Boolean(options.part),
    enum: options.enum || null,
  };
}

const COMMON_FIELDS: readonly TableField[] = [
  field("business_time", "业务发生时间", "timestamp"),
  field("source_channel", "来源渠道", "string", {
    enum: "ONLINE-线上 / STORE-门店 / MINI_APP-小程序",
  }),
  field("record_status", "记录状态", "string", {
    enum: "VALID-有效 / INVALID-无效",
  }),
  field("dt", "数据日期分区", "date", { part: true }),
  field("etl_time", "数据写入时间", "timestamp"),
] as const;

const DOMAIN_HUE: Record<string, number> = {
  商品: 255,
  会员: 288,
  交易: 232,
  门店: 162,
  库存: 78,
  营销: 332,
  履约: 28,
  售后: 196,
};

type TableDef = [string, string, string, string, TableField[]];

const DEFINITIONS: readonly TableDef[] = [
  [
    "product_sku_detail_di",
    "商品 SKU 明细中间表",
    "商品",
    "一条 SKU",
    [
      field("sku_id", "SKU 标识", "string", { pk: true }),
      field("spu_id", "SPU 标识"),
      field("product_name", "商品名称"),
      field("category_id", "叶子类目标识"),
      field("brand_name", "虚构品牌名称", "string", { nullable: true }),
      field("sale_price", "零售价格", "decimal(18,2)"),
    ],
  ],
  [
    "product_category_tree_dd",
    "商品类目树全量表",
    "商品",
    "一个商品类目",
    [
      field("category_id", "类目标识", "string", { pk: true }),
      field("parent_category_id", "父类目标识", "string", { nullable: true }),
      field("category_name", "类目名称"),
      field("category_level", "类目层级", "integer"),
      field("leaf_flag", "是否叶子类目", "integer"),
    ],
  ],
  [
    "product_price_change_di",
    "商品价格变更明细表",
    "商品",
    "一次价格变更",
    [
      field("change_id", "变更标识", "string", { pk: true }),
      field("sku_id", "SKU 标识"),
      field("before_price", "变更前价格", "decimal(18,2)"),
      field("after_price", "变更后价格", "decimal(18,2)"),
      field("change_reason", "变更原因"),
    ],
  ],
  [
    "product_listing_status_dd",
    "商品上下架状态表",
    "商品",
    "一个渠道商品",
    [
      field("listing_id", "上架记录标识", "string", { pk: true }),
      field("sku_id", "SKU 标识"),
      field("channel_id", "销售渠道标识"),
      field("listing_status", "上下架状态", "string", {
        enum: "ON-已上架 / OFF-已下架 / REVIEW-审核中",
      }),
      field("listed_at", "上架时间", "timestamp", { nullable: true }),
    ],
  ],

  [
    "member_profile_full_dd",
    "会员基础画像全量表",
    "会员",
    "一位虚构会员",
    [
      field("member_id", "会员标识", "string", { pk: true }),
      field("member_level", "会员等级", "string", {
        enum: "NORMAL-普通 / SILVER-银卡 / GOLD-金卡",
      }),
      field("join_date", "入会日期", "date"),
      field("city_level", "常驻城市级别", "string", { nullable: true }),
      field("consent_flag", "营销授权标识", "integer"),
    ],
  ],
  [
    "member_activity_stat_1d",
    "会员活跃统计日表",
    "会员",
    "会员与日期",
    [
      field("member_id", "会员标识", "string", { pk: true }),
      field("visit_count", "访问次数", "bigint"),
      field("order_count", "下单次数", "bigint"),
      field("interaction_count", "互动次数", "bigint"),
      field("active_flag", "活跃标识", "integer"),
    ],
  ],
  [
    "member_growth_event_di",
    "会员成长事件明细表",
    "会员",
    "一次成长值变动",
    [
      field("event_id", "成长事件标识", "string", { pk: true }),
      field("member_id", "会员标识"),
      field("point_change", "成长值变化", "integer"),
      field("event_type", "事件类型"),
      field("balance_after", "变更后成长值", "integer"),
    ],
  ],
  [
    "member_segment_result_dd",
    "会员分群结果全量表",
    "会员",
    "会员与分群",
    [
      field("segment_record_id", "分群记录标识", "string", { pk: true }),
      field("member_id", "会员标识"),
      field("segment_code", "分群编码"),
      field("segment_name", "分群名称"),
      field("effective_date", "生效日期", "date"),
    ],
  ],

  [
    "trade_order_detail_di",
    "零售订单明细中间表",
    "交易",
    "一笔零售订单",
    [
      field("order_id", "订单标识", "string", { pk: true }),
      field("member_id", "会员标识", "string", { nullable: true }),
      field("store_id", "门店标识", "string", { nullable: true }),
      field("order_amount", "订单原始金额", "decimal(18,2)"),
      field("paid_amount", "订单实付金额", "decimal(18,2)"),
      field("order_status", "订单状态", "string", {
        enum: "CREATED-待支付 / PAID-已支付 / COMPLETED-已完成 / CLOSED-已关闭",
      }),
    ],
  ],
  [
    "trade_order_item_di",
    "订单商品明细中间表",
    "交易",
    "订单与 SKU",
    [
      field("order_item_id", "订单商品标识", "string", { pk: true }),
      field("order_id", "订单标识"),
      field("sku_id", "SKU 标识"),
      field("sale_quantity", "销售数量", "integer"),
      field("item_amount", "商品成交金额", "decimal(18,2)"),
      field("discount_amount", "优惠金额", "decimal(18,2)"),
    ],
  ],
  [
    "trade_payment_detail_di",
    "订单支付明细中间表",
    "交易",
    "一次订单支付",
    [
      field("payment_id", "支付标识", "string", { pk: true }),
      field("order_id", "订单标识"),
      field("payment_method", "支付方式", "string", {
        enum: "MOBILE-移动支付 / CARD-刷卡 / CASH-现金 / POINTS-积分",
      }),
      field("payment_amount", "支付金额", "decimal(18,2)"),
      field("payment_status", "支付状态"),
      field("paid_at", "支付完成时间", "timestamp", { nullable: true }),
    ],
  ],
  [
    "trade_sales_stat_1d",
    "全渠道销售汇总日表",
    "交易",
    "渠道、门店与日期",
    [
      field("sales_stat_id", "销售统计标识", "string", { pk: true }),
      field("store_id", "门店标识", "string", { nullable: true }),
      field("order_count", "有效订单数", "bigint"),
      field("sales_quantity", "销售件数", "bigint"),
      field("gross_sales_amount", "销售总额", "decimal(18,2)"),
      field("net_sales_amount", "净销售额", "decimal(18,2)"),
    ],
  ],

  [
    "store_profile_full_dd",
    "门店档案全量表",
    "门店",
    "一家虚构门店",
    [
      field("store_id", "门店标识", "string", { pk: true }),
      field("store_name", "虚构门店名称"),
      field("region_code", "经营区域编码"),
      field("store_type", "门店类型", "string", {
        enum: "FLAGSHIP-旗舰店 / STANDARD-标准店 / COMMUNITY-社区店",
      }),
      field("opening_date", "开业日期", "date"),
    ],
  ],
  [
    "store_pos_order_di",
    "门店 POS 订单明细表",
    "门店",
    "一笔 POS 小票",
    [
      field("pos_order_id", "POS 订单标识", "string", { pk: true }),
      field("store_id", "门店标识"),
      field("terminal_id", "终端标识"),
      field("member_id", "会员标识", "string", { nullable: true }),
      field("receipt_amount", "小票金额", "decimal(18,2)"),
      field("cashier_shift", "收银班次"),
    ],
  ],
  [
    "store_traffic_stat_1h",
    "门店客流统计小时表",
    "门店",
    "门店与小时",
    [
      field("traffic_stat_id", "客流统计标识", "string", { pk: true }),
      field("store_id", "门店标识"),
      field("hour_no", "小时序号", "integer"),
      field("visitor_count", "进店人数", "bigint"),
      field("buyer_count", "成交人数", "bigint"),
      field("traffic_quality", "客流质量等级"),
    ],
  ],
  [
    "store_target_progress_1d",
    "门店目标达成日表",
    "门店",
    "门店与日期",
    [
      field("target_record_id", "目标记录标识", "string", { pk: true }),
      field("store_id", "门店标识"),
      field("sales_target", "销售目标", "decimal(18,2)"),
      field("actual_sales", "实际销售额", "decimal(18,2)"),
      field("achievement_rate", "目标达成率", "decimal(9,4)"),
    ],
  ],

  [
    "inventory_stock_snap_dd",
    "仓店库存快照日表",
    "库存",
    "仓店、SKU 与日期",
    [
      field("stock_record_id", "库存记录标识", "string", { pk: true }),
      field("location_id", "库存地点标识"),
      field("sku_id", "SKU 标识"),
      field("available_quantity", "可售库存", "bigint"),
      field("locked_quantity", "锁定库存", "bigint"),
      field("in_transit_quantity", "在途库存", "bigint"),
    ],
  ],
  [
    "inventory_movement_di",
    "库存异动明细表",
    "库存",
    "一次库存异动",
    [
      field("movement_id", "异动标识", "string", { pk: true }),
      field("location_id", "库存地点标识"),
      field("sku_id", "SKU 标识"),
      field("movement_type", "异动类型", "string", {
        enum: "INBOUND-入库 / SALE-销售 / RETURN-退货 / ADJUST-调整",
      }),
      field("quantity_change", "数量变化", "integer"),
      field("reference_id", "关联业务标识"),
    ],
  ],
  [
    "inventory_replenishment_di",
    "补货建议明细表",
    "库存",
    "地点与 SKU",
    [
      field("suggestion_id", "补货建议标识", "string", { pk: true }),
      field("location_id", "库存地点标识"),
      field("sku_id", "SKU 标识"),
      field("safety_stock", "安全库存", "bigint"),
      field("suggested_quantity", "建议补货量", "bigint"),
      field("suggestion_status", "建议状态"),
    ],
  ],
  [
    "inventory_turnover_stat_1d",
    "库存周转统计日表",
    "库存",
    "地点、类目与日期",
    [
      field("turnover_stat_id", "周转统计标识", "string", { pk: true }),
      field("location_id", "库存地点标识"),
      field("category_id", "类目标识"),
      field("average_stock_amount", "平均库存金额", "decimal(18,2)"),
      field("cost_amount", "销售成本", "decimal(18,2)"),
      field("turnover_days", "库存周转天数", "decimal(10,2)"),
    ],
  ],

  [
    "marketing_campaign_full_dd",
    "营销活动配置全量表",
    "营销",
    "一个营销活动",
    [
      field("campaign_id", "活动标识", "string", { pk: true }),
      field("campaign_name", "活动名称"),
      field("campaign_type", "活动类型"),
      field("start_time", "开始时间", "timestamp"),
      field("end_time", "结束时间", "timestamp"),
      field("campaign_status", "活动状态"),
    ],
  ],
  [
    "marketing_exposure_click_di",
    "营销曝光点击明细表",
    "营销",
    "一次营销互动",
    [
      field("interaction_id", "互动标识", "string", { pk: true }),
      field("campaign_id", "活动标识"),
      field("member_id", "会员标识", "string", { nullable: true }),
      field("interaction_type", "互动类型", "string", {
        enum: "EXPOSURE-曝光 / CLICK-点击 / CLAIM-领券",
      }),
      field("touchpoint", "触点类型"),
    ],
  ],
  [
    "marketing_coupon_use_di",
    "优惠券使用明细表",
    "营销",
    "一张优惠券",
    [
      field("coupon_instance_id", "券实例标识", "string", { pk: true }),
      field("campaign_id", "活动标识"),
      field("member_id", "会员标识"),
      field("coupon_amount", "券面金额", "decimal(18,2)"),
      field("coupon_status", "券状态"),
      field("used_order_id", "使用订单标识", "string", { nullable: true }),
    ],
  ],
  [
    "marketing_conversion_stat_1d",
    "营销转化统计日表",
    "营销",
    "活动与日期",
    [
      field("conversion_stat_id", "转化统计标识", "string", { pk: true }),
      field("campaign_id", "活动标识"),
      field("exposure_count", "曝光次数", "bigint"),
      field("click_count", "点击次数", "bigint"),
      field("order_count", "转化订单数", "bigint"),
      field("conversion_rate", "活动转化率", "decimal(9,4)"),
    ],
  ],

  [
    "fulfillment_package_di",
    "履约包裹明细表",
    "履约",
    "一个履约包裹",
    [
      field("package_id", "包裹标识", "string", { pk: true }),
      field("order_id", "订单标识"),
      field("warehouse_id", "发货仓标识"),
      field("carrier_code", "虚构承运商编码"),
      field("package_status", "包裹状态"),
      field("promised_at", "承诺送达时间", "timestamp"),
    ],
  ],
  [
    "fulfillment_route_event_di",
    "物流轨迹事件明细表",
    "履约",
    "一次物流事件",
    [
      field("route_event_id", "轨迹事件标识", "string", { pk: true }),
      field("package_id", "包裹标识"),
      field("event_code", "轨迹事件编码"),
      field("event_city_level", "事件城市级别"),
      field("event_time", "事件时间", "timestamp"),
      field("exception_flag", "异常标识", "integer"),
    ],
  ],
  [
    "fulfillment_delivery_stat_1d",
    "履约时效统计日表",
    "履约",
    "履约方式与日期",
    [
      field("delivery_stat_id", "履约统计标识", "string", { pk: true }),
      field("fulfillment_type", "履约方式"),
      field("package_count", "包裹数量", "bigint"),
      field("on_time_count", "准时送达数量", "bigint"),
      field("average_hours", "平均履约小时", "decimal(10,2)"),
      field("on_time_rate", "准时履约率", "decimal(9,4)"),
    ],
  ],
  [
    "fulfillment_pickup_order_di",
    "门店自提订单明细表",
    "履约",
    "一笔自提订单",
    [
      field("pickup_id", "自提标识", "string", { pk: true }),
      field("order_id", "订单标识"),
      field("store_id", "自提门店标识"),
      field("ready_at", "备货完成时间", "timestamp", { nullable: true }),
      field("picked_at", "提货时间", "timestamp", { nullable: true }),
      field("pickup_status", "自提状态"),
    ],
  ],

  [
    "service_return_request_di",
    "退货申请明细表",
    "售后",
    "一次退货申请",
    [
      field("return_id", "退货申请标识", "string", { pk: true }),
      field("order_id", "订单标识"),
      field("sku_id", "SKU 标识"),
      field("return_reason", "退货原因"),
      field("return_quantity", "退货数量", "integer"),
      field("return_status", "退货状态"),
    ],
  ],
  [
    "service_refund_detail_di",
    "退款处理明细表",
    "售后",
    "一次退款处理",
    [
      field("refund_id", "退款标识", "string", { pk: true }),
      field("return_id", "退货申请标识"),
      field("order_id", "订单标识"),
      field("refund_amount", "退款金额", "decimal(18,2)"),
      field("refund_status", "退款状态"),
      field("completed_at", "退款完成时间", "timestamp", { nullable: true }),
    ],
  ],
  [
    "service_ticket_di",
    "客服工单明细表",
    "售后",
    "一张客服工单",
    [
      field("ticket_id", "工单标识", "string", { pk: true }),
      field("member_id", "会员标识", "string", { nullable: true }),
      field("order_id", "订单标识", "string", { nullable: true }),
      field("ticket_type", "工单类型"),
      field("priority_code", "优先级"),
      field("ticket_status", "工单状态"),
    ],
  ],
  [
    "service_review_di",
    "商品评价明细表",
    "售后",
    "一次商品评价",
    [
      field("review_id", "评价标识", "string", { pk: true }),
      field("order_item_id", "订单商品标识"),
      field("sku_id", "SKU 标识"),
      field("rating_score", "评价星级", "integer"),
      field("review_tag", "评价标签", "string", { nullable: true }),
      field("anonymous_flag", "匿名标识", "integer"),
    ],
  ],
] as const;

export interface MockDwmTable {
  name: string;
  cn: string;
  domain: string;
  layer: string;
  owner: string;
  grain: string;
  cycle: string;
  desc: string;
  fields: TableField[];
}

export const DWM_TABLES: MockDwmTable[] = DEFINITIONS.map(
  ([name, cn, domain, grain, fields]) => ({
    name: `dwm_${name}`,
    cn,
    domain,
    layer: "DWM",
    owner: "演示数据维护组",
    grain,
    cycle: "每日增量 T+1",
    desc: `${cn}，用于完全虚构的全渠道零售数据治理演示。`,
    fields: [...fields, ...COMMON_FIELDS],
  }),
);

export const DOMAIN_HUE_MAP = DOMAIN_HUE;
