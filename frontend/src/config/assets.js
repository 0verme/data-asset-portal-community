export const DOMAIN_ORDER = ["商品", "会员", "交易", "门店", "库存", "营销", "履约", "售后"];

export const DOMAIN_HUE_MAP = {
  商品: 255,
  会员: 288,
  交易: 232,
  门店: 162,
  库存: 78,
  营销: 332,
  履约: 28,
  售后: 196,
};

export const LAYER_OPTIONS = [
  { code: "ODS", cn: "贴源层", active: false },
  { code: "DWD", cn: "明细层", active: false },
  { code: "DWA", cn: "应用明细层", active: false },
  { code: "DWM", cn: "中间层", active: true },
  { code: "DWS", cn: "汇总层", active: false },
  { code: "DM", cn: "数据集市层", active: false },
  { code: "ADS", cn: "应用层", active: false },
];
