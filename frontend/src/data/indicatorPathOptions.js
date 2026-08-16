export const INDICATOR_PATH_SEPARATOR = " > ";

const DIMENSIONS = [
  ["prd", "PRD", "商品维度", [["商品运营", ["规模", "动销"]], ["价格分析", ["价格", "变更"]]]],
  ["mem", "MEM", "会员维度", [["会员增长", ["新增"]], ["会员活跃", ["活跃", "互动"]], ["会员价值", ["复购", "分层"]]]],
  ["ord", "ORD", "交易维度", [["销售分析", ["规模", "订单", "效率"]], ["商品分析", ["件单"]]]],
  ["str", "STR", "门店维度", [["门店经营", ["销售", "目标"]], ["客流分析", ["客流", "转化"]]]],
  ["inv", "INV", "库存维度", [["库存健康", ["库存", "缺货", "在途"]], ["库存效率", ["周转"]], ["补货管理", ["建议"]]]],
  ["mkt", "MKT", "营销维度", [["活动效果", ["曝光", "互动", "转化"]], ["优惠分析", ["用券"]]]],
  ["ful", "FUL", "履约维度", [["配送效率", ["规模", "时效"]], ["履约质量", ["异常"]]]],
  ["svc", "SVC", "售后维度", [["退换货", ["申请", "质量"]], ["退款处理", ["金额"]], ["客户服务", ["效率"]], ["客户声音", ["评价"]]]],
];

export const INDICATOR_DIMENSION_CODE_MAP = Object.fromEntries(DIMENSIONS.map(([value, code]) => [value, code]));
export const INDICATOR_DIMENSION_VALUE_MAP = Object.fromEntries(DIMENSIONS.map(([value, code]) => [code, value]));
export const INDICATOR_DIMENSION_LABEL_MAP = Object.fromEntries(DIMENSIONS.map(([value, , label]) => [label, value]));

export const INDICATOR_PATH_OPTIONS = DIMENSIONS.map(([dimension, code, label, groups]) => ({
  label: `${code} ${label}`,
  value: code,
  pathLabel: code,
  dimension,
  children: groups.map(([group, topics]) => ({
    label: group,
    value: group,
    children: topics.map((topic) => ({ label: topic, value: topic })),
  })),
}));

export function splitIndicatorPath(path) {
  return String(path || "").split(INDICATOR_PATH_SEPARATOR).map((item) => item.trim()).filter(Boolean);
}

export function normalizeIndicatorDimension(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return INDICATOR_DIMENSION_CODE_MAP[raw.toLowerCase()]
    ? raw.toLowerCase()
    : INDICATOR_DIMENSION_VALUE_MAP[raw.toUpperCase()] || INDICATOR_DIMENSION_LABEL_MAP[raw] || "";
}

function findOptionBySegment(options, segment) {
  return (options || []).find((option) => option.value === segment || option.pathLabel === segment || option.label === segment);
}

export function findIndicatorPathValuePath(path, options = INDICATOR_PATH_OPTIONS) {
  const values = [];
  let currentOptions = options;
  for (const segment of splitIndicatorPath(path)) {
    const matched = findOptionBySegment(currentOptions, segment);
    if (!matched) break;
    values.push(matched.value);
    currentOptions = matched.children || [];
  }
  return values;
}

export function findIndicatorPathNodes(valuePath, options = INDICATOR_PATH_OPTIONS) {
  const nodes = [];
  let currentOptions = options;
  for (const value of Array.isArray(valuePath) ? valuePath : []) {
    const matched = (currentOptions || []).find((option) => option.value === value);
    if (!matched) return [];
    nodes.push(matched);
    currentOptions = matched.children || [];
  }
  return nodes;
}

export function formatIndicatorPath(valuePath, options = INDICATOR_PATH_OPTIONS) {
  return findIndicatorPathNodes(valuePath, options).map((node) => node.pathLabel || node.value || node.label).join(INDICATOR_PATH_SEPARATOR);
}

export function getIndicatorDimensionFromPath(path, options = INDICATOR_PATH_OPTIONS) {
  const segments = Array.isArray(path) ? path : splitIndicatorPath(path);
  const direct = normalizeIndicatorDimension(segments[0]);
  if (direct) return direct;
  const root = (Array.isArray(path) ? path : findIndicatorPathValuePath(path, options))[0];
  return INDICATOR_DIMENSION_VALUE_MAP[root] || "";
}
