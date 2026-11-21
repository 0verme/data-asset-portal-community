export const WAREHOUSE_DOMAIN_TRANSLATION_KEYS = {
  商品: "domains.product",
  会员: "domains.members",
  交易: "domains.transactions",
  门店: "domains.stores",
  库存: "domains.inventory",
  营销: "domains.marketing",
  履约: "domains.fulfillment",
  售后: "domains.afterSales",
} as const;

export const WAREHOUSE_LAYER_TRANSLATION_KEYS = {
  ODS: "layerLabels.ODS",
  DWD: "layerLabels.DWD",
  DWA: "layerLabels.DWA",
  DWM: "layerLabels.DWM",
  DWS: "layerLabels.DWS",
  DM: "layerLabels.DM",
  ADS: "layerLabels.ADS",
} as const;

export type WarehouseDomainTranslationKey =
  (typeof WAREHOUSE_DOMAIN_TRANSLATION_KEYS)[keyof typeof WAREHOUSE_DOMAIN_TRANSLATION_KEYS];
export type WarehouseLayerTranslationKey =
  (typeof WAREHOUSE_LAYER_TRANSLATION_KEYS)[keyof typeof WAREHOUSE_LAYER_TRANSLATION_KEYS];

export function getWarehouseDomainLabel(
  domain: string,
  translate: (key: WarehouseDomainTranslationKey) => string,
): string {
  const key = WAREHOUSE_DOMAIN_TRANSLATION_KEYS[domain as keyof typeof WAREHOUSE_DOMAIN_TRANSLATION_KEYS];
  return key ? translate(key) : domain;
}

export function getWarehouseLayerLabel(
  code: string,
  fallback: string,
  translate: (key: WarehouseLayerTranslationKey) => string,
): string {
  const key = WAREHOUSE_LAYER_TRANSLATION_KEYS[code as keyof typeof WAREHOUSE_LAYER_TRANSLATION_KEYS];
  return key ? translate(key) : fallback || code;
}
