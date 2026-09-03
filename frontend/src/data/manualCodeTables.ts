export interface MockManualCodeTable {
  id: string;
  tableCode: string;
  tableName: string;
  style: string;
  owner: string;
  status: string;
  remark: string;
  updatedAt: string;
}

export const MANUAL_CODE_TABLES: readonly MockManualCodeTable[] = [
  {
    id: "1",
    tableCode: "STATUS_ORDER",
    tableName: "订单状态码表",
    style: "status",
    owner: "演示数据维护组",
    status: "enabled",
    remark: "订单创建、支付、完成和关闭状态。",
    updatedAt: "2026-07-18 10:22:00",
  },
  {
    id: "2",
    tableCode: "DIM_MEMBER_LEVEL",
    tableName: "会员等级字典",
    style: "dim",
    owner: "演示数据维护组",
    status: "enabled",
    remark: "普通、银卡和金卡会员等级。",
    updatedAt: "2026-07-17 16:40:00",
  },
  {
    id: "3",
    tableCode: "DIM_SALES_CHANNEL",
    tableName: "销售渠道字典",
    style: "dim",
    owner: "演示数据维护组",
    status: "enabled",
    remark: "线上商城、门店和小程序渠道。",
    updatedAt: "2026-07-16 09:15:00",
  },
  {
    id: "4",
    tableCode: "MAP_PRODUCT_CATEGORY",
    tableName: "商品类目映射表",
    style: "mapping",
    owner: "演示数据维护组",
    status: "enabled",
    remark: "统一各渠道商品类目。",
    updatedAt: "2026-07-15 14:20:00",
  },
  {
    id: "5",
    tableCode: "STATUS_PACKAGE",
    tableName: "包裹状态码表",
    style: "status",
    owner: "演示数据维护组",
    status: "enabled",
    remark: "待出库、运输中、已送达和异常状态。",
    updatedAt: "2026-07-14 11:05:00",
  },
  {
    id: "6",
    tableCode: "REASON_RETURN",
    tableName: "退货原因字典",
    style: "dim",
    owner: "演示数据维护组",
    status: "enabled",
    remark: "尺码、质量、错发和主观原因分类。",
    updatedAt: "2026-07-13 12:10:00",
  },
  {
    id: "7",
    tableCode: "TYPE_CAMPAIGN",
    tableName: "营销活动类型表",
    style: "dim",
    owner: "演示数据维护组",
    status: "enabled",
    remark: "满减、折扣、赠品和会员专享活动。",
    updatedAt: "2026-07-12 10:10:00",
  },
  {
    id: "8",
    tableCode: "STATUS_LEGACY_COUPON",
    tableName: "旧版优惠券状态表",
    style: "status",
    owner: "演示数据维护组",
    status: "disabled",
    remark: "禁用样例，仅用于状态筛选演示。",
    updatedAt: "2026-06-28 12:10:00",
  },
] as const;
