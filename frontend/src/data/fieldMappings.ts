// Copyright 2025 Jearhe
// Licensed under the Apache License, Version 2.0.

export interface FieldMappingRow {
  sourceSystemId: number;
  systemCode: string;
  upstreamSystemId: number;
  srcSystem: string;
  srcTable: string;
  srcTableCn: string;
  loadMode: string;
  srcField: string;
  srcType: string;
  srcComment: string;
  targetLayer: string;
  targetTable: string;
  targetField: string;
  mappingRule: string;
  updatedAt: string;
}

type FieldDef = [string, string, string, string, string];
type TableDef = [string, string, string, string, string, FieldDef[]];

const TABLE_MAPPINGS: TableDef[] = [
  [
    "商品中心",
    "PIM_SKU",
    "商品 SKU",
    "DWD_PRODUCT_SKU",
    "full_zip",
    [
      ["SKU_CODE", "VARCHAR(40)", "SKU 编码", "sku_id", "直接映射"],
      ["SPU_CODE", "VARCHAR(40)", "SPU 编码", "spu_id", "直接映射"],
      [
        "PRODUCT_NAME",
        "VARCHAR(200)",
        "商品名称",
        "product_name",
        "清理首尾空格",
      ],
      ["CATEGORY_CODE", "VARCHAR(40)", "类目编码", "category_id", "直接映射"],
      [
        "LIST_PRICE_CENT",
        "BIGINT",
        "零售价（分）",
        "sale_price",
        "金额除以 100",
      ],
      [
        "UPDATED_TIME",
        "TIMESTAMP",
        "更新时间",
        "business_time",
        "时间格式转换",
      ],
    ],
  ],
  [
    "商品中心",
    "PIM_CATEGORY",
    "商品类目",
    "DWD_PRODUCT_CATEGORY",
    "full_zip",
    [
      ["CATEGORY_CODE", "VARCHAR(40)", "类目编码", "category_id", "直接映射"],
      [
        "PARENT_CODE",
        "VARCHAR(40)",
        "父类目编码",
        "parent_category_id",
        "空值标准化",
      ],
      [
        "CATEGORY_NAME",
        "VARCHAR(120)",
        "类目名称",
        "category_name",
        "清理首尾空格",
      ],
      ["LEVEL_NO", "INTEGER", "类目层级", "category_level", "直接映射"],
      ["IS_LEAF", "CHAR(1)", "叶子节点标识", "leaf_flag", "Y/N 转 1/0"],
      [
        "UPDATED_TIME",
        "TIMESTAMP",
        "更新时间",
        "business_time",
        "时间格式转换",
      ],
    ],
  ],
  [
    "会员中心",
    "MEMBER_PROFILE",
    "会员档案",
    "DWD_MEMBER_PROFILE",
    "full_zip",
    [
      ["MEMBER_CODE", "VARCHAR(40)", "会员编码", "member_id", "不可逆演示编码"],
      ["LEVEL_CODE", "VARCHAR(20)", "会员等级", "member_level", "字典转换"],
      ["JOIN_DATE", "CHAR(8)", "入会日期", "join_date", "日期格式转换"],
      ["CITY_CODE", "VARCHAR(20)", "城市编码", "city_level", "仅保留城市级别"],
      [
        "MOBILE_TEXT",
        "VARCHAR(40)",
        "联系信息",
        "contact_mask",
        "固定掩码替换",
      ],
      ["CONSENT_FLAG", "CHAR(1)", "营销授权", "consent_flag", "Y/N 转 1/0"],
    ],
  ],
  [
    "订单中心",
    "ORDER_HEADER",
    "订单主表",
    "DWD_TRADE_ORDER",
    "incr",
    [
      ["ORDER_CODE", "VARCHAR(40)", "订单编码", "order_id", "直接映射"],
      ["MEMBER_CODE", "VARCHAR(40)", "会员编码", "member_id", "不可逆演示编码"],
      ["STORE_CODE", "VARCHAR(40)", "门店编码", "store_id", "直接映射"],
      [
        "ORDER_AMT_CENT",
        "BIGINT",
        "订单金额（分）",
        "order_amount",
        "金额除以 100",
      ],
      [
        "PAID_AMT_CENT",
        "BIGINT",
        "实付金额（分）",
        "paid_amount",
        "金额除以 100",
      ],
      [
        "ORDER_STATUS",
        "VARCHAR(20)",
        "订单状态",
        "order_status",
        "状态字典转换",
      ],
    ],
  ],
  [
    "订单中心",
    "ORDER_ITEM",
    "订单商品",
    "DWD_TRADE_ORDER_ITEM",
    "incr",
    [
      ["ITEM_CODE", "VARCHAR(50)", "订单商品编码", "order_item_id", "直接映射"],
      ["ORDER_CODE", "VARCHAR(40)", "订单编码", "order_id", "直接映射"],
      ["SKU_CODE", "VARCHAR(40)", "SKU 编码", "sku_id", "直接映射"],
      ["SALE_QTY", "INTEGER", "销售数量", "sale_quantity", "空值补零"],
      [
        "ITEM_AMT_CENT",
        "BIGINT",
        "商品金额（分）",
        "item_amount",
        "金额除以 100",
      ],
      [
        "DISCOUNT_CENT",
        "BIGINT",
        "优惠金额（分）",
        "discount_amount",
        "金额除以 100",
      ],
    ],
  ],
  [
    "门店 POS",
    "POS_RECEIPT",
    "门店小票",
    "DWD_STORE_POS_ORDER",
    "incr",
    [
      ["RECEIPT_CODE", "VARCHAR(50)", "小票编码", "pos_order_id", "直接映射"],
      ["STORE_CODE", "VARCHAR(40)", "门店编码", "store_id", "直接映射"],
      ["TERMINAL_CODE", "VARCHAR(30)", "终端编码", "terminal_id", "直接映射"],
      ["MEMBER_CODE", "VARCHAR(40)", "会员编码", "member_id", "不可逆演示编码"],
      [
        "RECEIPT_AMT",
        "DECIMAL(18,2)",
        "小票金额",
        "receipt_amount",
        "直接映射",
      ],
      ["SHIFT_CODE", "VARCHAR(20)", "收银班次", "cashier_shift", "字典转换"],
    ],
  ],
  [
    "库存中心",
    "STOCK_SNAPSHOT",
    "库存快照",
    "DWD_INVENTORY_STOCK",
    "full",
    [
      [
        "STOCK_CODE",
        "VARCHAR(50)",
        "库存记录编码",
        "stock_record_id",
        "直接映射",
      ],
      [
        "LOCATION_CODE",
        "VARCHAR(40)",
        "库存地点编码",
        "location_id",
        "直接映射",
      ],
      ["SKU_CODE", "VARCHAR(40)", "SKU 编码", "sku_id", "直接映射"],
      ["AVAILABLE_QTY", "BIGINT", "可售数量", "available_quantity", "空值补零"],
      ["LOCKED_QTY", "BIGINT", "锁定数量", "locked_quantity", "空值补零"],
      ["TRANSIT_QTY", "BIGINT", "在途数量", "in_transit_quantity", "空值补零"],
    ],
  ],
  [
    "库存中心",
    "REPLENISHMENT",
    "补货建议",
    "DWD_INVENTORY_REPLENISHMENT",
    "incr",
    [
      [
        "SUGGESTION_CODE",
        "VARCHAR(50)",
        "建议编码",
        "suggestion_id",
        "直接映射",
      ],
      [
        "LOCATION_CODE",
        "VARCHAR(40)",
        "库存地点编码",
        "location_id",
        "直接映射",
      ],
      ["SKU_CODE", "VARCHAR(40)", "SKU 编码", "sku_id", "直接映射"],
      ["SAFETY_QTY", "BIGINT", "安全库存", "safety_stock", "空值补零"],
      ["SUGGESTED_QTY", "BIGINT", "建议数量", "suggested_quantity", "空值补零"],
      [
        "SUGGEST_STATUS",
        "VARCHAR(20)",
        "建议状态",
        "suggestion_status",
        "状态字典转换",
      ],
    ],
  ],
  [
    "营销平台",
    "CAMPAIGN_EVENT",
    "活动互动事件",
    "DWD_MARKETING_INTERACTION",
    "incr",
    [
      [
        "EVENT_CODE",
        "VARCHAR(50)",
        "互动事件编码",
        "interaction_id",
        "直接映射",
      ],
      ["CAMPAIGN_CODE", "VARCHAR(40)", "活动编码", "campaign_id", "直接映射"],
      ["MEMBER_CODE", "VARCHAR(40)", "会员编码", "member_id", "不可逆演示编码"],
      [
        "EVENT_TYPE",
        "VARCHAR(20)",
        "互动类型",
        "interaction_type",
        "事件类型归一",
      ],
      ["TOUCH_POINT", "VARCHAR(30)", "触点", "touchpoint", "字典转换"],
      ["EVENT_TIME", "TIMESTAMP", "互动时间", "business_time", "时间格式转换"],
    ],
  ],
  [
    "履约平台",
    "PACKAGE_INFO",
    "包裹信息",
    "DWD_FULFILLMENT_PACKAGE",
    "incr_zip",
    [
      ["PACKAGE_CODE", "VARCHAR(50)", "包裹编码", "package_id", "直接映射"],
      ["ORDER_CODE", "VARCHAR(40)", "订单编码", "order_id", "直接映射"],
      [
        "WAREHOUSE_CODE",
        "VARCHAR(40)",
        "发货仓编码",
        "warehouse_id",
        "直接映射",
      ],
      [
        "CARRIER_CODE",
        "VARCHAR(30)",
        "虚构承运商编码",
        "carrier_code",
        "直接映射",
      ],
      [
        "PACKAGE_STATUS",
        "VARCHAR(20)",
        "包裹状态",
        "package_status",
        "状态字典转换",
      ],
      ["PROMISED_TIME", "TIMESTAMP", "承诺时间", "promised_at", "时间格式转换"],
    ],
  ],
  [
    "售后中心",
    "RETURN_REQUEST",
    "退货申请",
    "DWD_SERVICE_RETURN",
    "incr_zip",
    [
      ["RETURN_CODE", "VARCHAR(50)", "退货编码", "return_id", "直接映射"],
      ["ORDER_CODE", "VARCHAR(40)", "订单编码", "order_id", "直接映射"],
      ["SKU_CODE", "VARCHAR(40)", "SKU 编码", "sku_id", "直接映射"],
      [
        "REASON_CODE",
        "VARCHAR(30)",
        "退货原因编码",
        "return_reason",
        "原因字典转换",
      ],
      ["RETURN_QTY", "INTEGER", "退货数量", "return_quantity", "空值补零"],
      [
        "RETURN_STATUS",
        "VARCHAR(20)",
        "退货状态",
        "return_status",
        "状态字典转换",
      ],
    ],
  ],
  [
    "售后中心",
    "SERVICE_TICKET",
    "客服工单",
    "DWD_SERVICE_TICKET",
    "incr_zip",
    [
      ["TICKET_CODE", "VARCHAR(50)", "工单编码", "ticket_id", "直接映射"],
      ["MEMBER_CODE", "VARCHAR(40)", "会员编码", "member_id", "不可逆演示编码"],
      ["ORDER_CODE", "VARCHAR(40)", "订单编码", "order_id", "直接映射"],
      ["TICKET_TYPE", "VARCHAR(30)", "工单类型", "ticket_type", "字典转换"],
      ["PRIORITY_CODE", "VARCHAR(20)", "优先级", "priority_code", "字典转换"],
      [
        "TICKET_STATUS",
        "VARCHAR(20)",
        "工单状态",
        "ticket_status",
        "状态字典转换",
      ],
    ],
  ],
];

interface SystemSourceMapping {
  sourceSystemId: number;
  systemCode: string;
}

// Stable mock relation: source-table fixtures point at the upstream-system
// primary key explicitly. Never derive this relation from the display name.
const SOURCE_SYSTEM_BY_TABLE: Record<string, SystemSourceMapping> =
  Object.freeze({
    PIM_SKU: { sourceSystemId: 2, systemCode: "PIM" },
    PIM_CATEGORY: { sourceSystemId: 2, systemCode: "PIM" },
    MEMBER_PROFILE: { sourceSystemId: 1, systemCode: "MEM" },
    ORDER_HEADER: { sourceSystemId: 3, systemCode: "OMS" },
    ORDER_ITEM: { sourceSystemId: 3, systemCode: "OMS" },
    POS_RECEIPT: { sourceSystemId: 4, systemCode: "POS" },
    STOCK_SNAPSHOT: { sourceSystemId: 5, systemCode: "IMS" },
    REPLENISHMENT: { sourceSystemId: 5, systemCode: "IMS" },
    CAMPAIGN_EVENT: { sourceSystemId: 6, systemCode: "MKT" },
    PACKAGE_INFO: { sourceSystemId: 7, systemCode: "FUL" },
    RETURN_REQUEST: { sourceSystemId: 8, systemCode: "SVC" },
    SERVICE_TICKET: { sourceSystemId: 8, systemCode: "SVC" },
  });

export const FIELD_MAPPING_ROWS: FieldMappingRow[] = TABLE_MAPPINGS.flatMap(
  (
    [srcSystem, srcTable, srcTableCn, targetTable, loadMode, fields],
    tableIndex,
  ) => {
    const sysInfo = SOURCE_SYSTEM_BY_TABLE[srcTable] || {
      sourceSystemId: 0,
      systemCode: "",
    };
    return fields.map(
      (
        [srcField, srcType, srcComment, targetField, mappingRule],
        fieldIndex,
      ) => ({
        ...sysInfo,
        upstreamSystemId: sysInfo.sourceSystemId,
        srcSystem,
        srcTable,
        srcTableCn,
        loadMode,
        srcField,
        srcType,
        srcComment,
        targetLayer: "DWD",
        targetTable,
        targetField: tableIndex === 11 && fieldIndex === 5 ? "" : targetField,
        mappingRule:
          tableIndex === 11 && fieldIndex === 5 ? "待补充" : mappingRule,
        updatedAt: `2026-07-${String(tableIndex + 1).padStart(2, "0")}`,
      }),
    );
  },
);
