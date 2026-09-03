export interface ApiAssetParam {
  name: string;
  in: string;
  dataType: string;
  required: boolean;
  description: string;
  example: string;
}

export interface ApiAssetResponseField {
  name: string;
  dataType: string;
  description: string;
  example: string;
}

export interface ApiAssetRelation {
  type: string;
  targetCode: string;
  targetName: string;
}

export interface MockApiAsset {
  code: string;
  name: string;
  method: string;
  path: string;
  version: string;
  systemId: number;
  downstreamSystemId: number;
  downstreamSystemName: string;
  downstreamSystemShortName: string;
  type: string;
  status: string;
  ownerDept: string;
  ownerName: string;
  maintainerName: string;
  description: string;
  remark: string;
  params: ApiAssetParam[];
  responseFields: ApiAssetResponseField[];
  relations: ApiAssetRelation[];
}

const SPECS: ReadonlyArray<
  [string, string, string, string, number, string, string]
> = [
  [
    "PRODUCT_QUERY",
    "商品详情查询 API",
    "GET",
    "/demo/products/{skuId}",
    2,
    "DWM_PRODUCT_SKU_DETAIL_DI",
    "商品 SKU 明细中间表",
  ],
  [
    "PRODUCT_SEARCH",
    "商品检索 API",
    "GET",
    "/demo/products",
    2,
    "DWM_PRODUCT_SKU_DETAIL_DI",
    "商品 SKU 明细中间表",
  ],
  [
    "MEMBER_PROFILE",
    "会员画像查询 API",
    "GET",
    "/demo/members/{memberId}",
    1,
    "DWM_MEMBER_PROFILE_FULL_DD",
    "会员基础画像全量表",
  ],
  [
    "ORDER_QUERY",
    "订单详情查询 API",
    "GET",
    "/demo/orders/{orderId}",
    3,
    "DWM_TRADE_ORDER_DETAIL_DI",
    "零售订单明细中间表",
  ],
  [
    "STORE_SALES",
    "门店销售汇总 API",
    "GET",
    "/demo/stores/{storeId}/sales",
    4,
    "DWM_STORE_TARGET_PROGRESS_1D",
    "门店目标达成日表",
  ],
  [
    "STOCK_QUERY",
    "商品库存查询 API",
    "GET",
    "/demo/inventory/{skuId}",
    5,
    "DWM_INVENTORY_STOCK_SNAP_DD",
    "仓店库存快照日表",
  ],
  [
    "CAMPAIGN_RESULT",
    "活动效果查询 API",
    "GET",
    "/demo/campaigns/{campaignId}/result",
    6,
    "DWM_MARKETING_CONVERSION_STAT_1D",
    "营销转化统计日表",
  ],
  [
    "PACKAGE_TRACK",
    "包裹轨迹查询 API",
    "GET",
    "/demo/packages/{packageId}/events",
    7,
    "DWM_FULFILLMENT_ROUTE_EVENT_DI",
    "物流轨迹事件明细表",
  ],
  [
    "RETURN_CREATE",
    "退货申请 API",
    "POST",
    "/demo/returns",
    8,
    "DWM_SERVICE_RETURN_REQUEST_DI",
    "退货申请明细表",
  ],
  [
    "REVIEW_SUMMARY",
    "商品评价汇总 API",
    "GET",
    "/demo/products/{skuId}/reviews",
    8,
    "DWM_SERVICE_REVIEW_DI",
    "商品评价明细表",
  ],
];

const SYSTEM_NAMES = [
  "会员中心",
  "商品中心",
  "订单中心",
  "门店 POS",
  "库存中心",
  "营销平台",
  "履约平台",
  "售后中心",
] as const;
const SYSTEM_SHORT_NAMES = [
  "会员",
  "商品",
  "订单",
  "门店",
  "库存",
  "营销",
  "履约",
  "售后",
] as const;

export const API_ASSETS: MockApiAsset[] = SPECS.map(
  ([code, name, method, path, systemId, targetCode, targetName], index) => ({
    code,
    name,
    method,
    path,
    version: "v1",
    systemId,
    downstreamSystemId: systemId,
    downstreamSystemName: SYSTEM_NAMES[systemId - 1] ?? "",
    downstreamSystemShortName: SYSTEM_SHORT_NAMES[systemId - 1] ?? "",
    type: method === "GET" ? "query" : "command",
    status: index === 9 ? "disabled" : "enabled",
    ownerDept: "零售数据开放组",
    ownerName: "演示数据维护组",
    maintainerName: "演示数据维护组",
    description: `${name}，仅返回完全虚构的全渠道零售演示数据。`,
    remark: "Community 安全演示数据",
    params: [
      {
        name: path.includes("skuId")
          ? "skuId"
          : path.includes("orderId")
            ? "orderId"
            : method === "POST"
              ? "orderId"
              : "demoId",
        in: path.includes("{") ? "path" : "body",
        dataType: "string",
        required: true,
        description: "演示业务标识",
        example: `DEMO-${String(index + 1).padStart(3, "0")}`,
      },
    ],
    responseFields: [
      {
        name: "status",
        dataType: "string",
        description: "演示处理状态",
        example: "READY",
      },
    ],
    relations: [{ type: "table", targetCode, targetName }],
  }),
);
