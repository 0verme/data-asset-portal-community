export const ROOT_CATEGORIES = [
  "业务对象",
  "经营度量",
  "状态属性",
  "时间周期",
  "数据处理",
  "技术后缀",
] as const;

export type RootCategory = (typeof ROOT_CATEGORIES)[number];

export interface MockWordRoot {
  abbr: string;
  en: string;
  cn: string;
  cat: string;
  desc: string;
  status: string;
}

type RootTuple = [string, string, string, string];

const ROOTS: readonly RootTuple[] = [
  ["sku", "stock keeping unit", "商品 SKU", "业务对象"],
  ["spu", "standard product unit", "标准商品", "业务对象"],
  ["prd", "product", "商品", "业务对象"],
  ["cat", "category", "类目", "业务对象"],
  ["mem", "member", "会员", "业务对象"],
  ["ord", "order", "订单", "业务对象"],
  ["item", "order item", "订单商品", "业务对象"],
  ["store", "store", "门店", "业务对象"],
  ["wh", "warehouse", "仓库", "业务对象"],
  ["stock", "inventory stock", "库存", "业务对象"],
  ["camp", "campaign", "营销活动", "业务对象"],
  ["coupon", "coupon", "优惠券", "业务对象"],
  ["pkg", "package", "包裹", "业务对象"],
  ["return", "return request", "退货", "业务对象"],
  ["refund", "refund", "退款", "业务对象"],
  ["ticket", "service ticket", "客服工单", "业务对象"],
  ["amt", "amount", "金额", "经营度量"],
  ["qty", "quantity", "数量", "经营度量"],
  ["cnt", "count", "计数", "经营度量"],
  ["rate", "rate", "比率", "经营度量"],
  ["price", "price", "价格", "经营度量"],
  ["cost", "cost", "成本", "经营度量"],
  ["sales", "sales", "销售", "经营度量"],
  ["traffic", "traffic", "客流", "经营度量"],
  ["status", "status", "状态", "状态属性"],
  ["flag", "flag", "标识", "状态属性"],
  ["level", "level", "等级", "状态属性"],
  ["type", "type", "类型", "状态属性"],
  ["reason", "reason", "原因", "状态属性"],
  ["channel", "channel", "渠道", "状态属性"],
  ["dt", "date partition", "日期分区", "时间周期"],
  ["hr", "hour partition", "小时分区", "时间周期"],
  ["time", "timestamp", "时间", "时间周期"],
  ["snap", "snapshot", "快照", "数据处理"],
  ["detail", "detail", "明细", "数据处理"],
  ["stat", "statistics", "统计", "数据处理"],
  ["di", "daily increment", "日增量后缀", "技术后缀"],
  ["dd", "daily full", "日全量后缀", "技术后缀"],
  ["1d", "one day", "日汇总后缀", "技术后缀"],
  ["1h", "one hour", "小时汇总后缀", "技术后缀"],
];

export const WORD_ROOTS: MockWordRoot[] = ROOTS.map(
  ([abbr, en, cn, cat], index) => ({
    abbr,
    en,
    cn,
    cat,
    desc: `${cn}相关标准词根，可用于全渠道零售演示表和字段命名。`,
    status: index === 39 ? "disabled" : "enabled",
  }),
);
