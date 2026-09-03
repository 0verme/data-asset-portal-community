export interface MockSystem {
  id: number;
  code: string;
  name: string;
  short_name: string;
  type: string;
  status: string;
}

export const SYSTEMS: readonly MockSystem[] = [
  {
    id: 1,
    code: "MEMBER_CENTER",
    name: "会员中心",
    short_name: "会员",
    type: "business",
    status: "enabled",
  },
  {
    id: 2,
    code: "PRODUCT_CENTER",
    name: "商品中心",
    short_name: "商品",
    type: "business",
    status: "enabled",
  },
  {
    id: 3,
    code: "ORDER_CENTER",
    name: "订单中心",
    short_name: "订单",
    type: "business",
    status: "enabled",
  },
  {
    id: 4,
    code: "STORE_POS",
    name: "门店 POS",
    short_name: "门店",
    type: "business",
    status: "enabled",
  },
  {
    id: 5,
    code: "INVENTORY_CENTER",
    name: "库存中心",
    short_name: "库存",
    type: "business",
    status: "enabled",
  },
  {
    id: 6,
    code: "MARKETING_PLATFORM",
    name: "营销平台",
    short_name: "营销",
    type: "business",
    status: "enabled",
  },
  {
    id: 7,
    code: "FULFILLMENT_PLATFORM",
    name: "履约平台",
    short_name: "履约",
    type: "business",
    status: "enabled",
  },
  {
    id: 8,
    code: "SERVICE_CENTER",
    name: "售后中心",
    short_name: "售后",
    type: "business",
    status: "disabled",
  },
] as const;
