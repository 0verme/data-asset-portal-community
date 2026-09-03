export const INDICATOR_PATH_SEPARATOR = " > ";

type TopicGroup = [string, readonly string[]];
type DimensionSpec = [string, string, string, readonly TopicGroup[]];

const DIMENSIONS: readonly DimensionSpec[] = [
  [
    "prd",
    "PRD",
    "商品维度",
    [
      ["商品运营", ["规模", "动销"]],
      ["价格分析", ["价格", "变更"]],
    ],
  ],
  [
    "mem",
    "MEM",
    "会员维度",
    [
      ["会员增长", ["新增"]],
      ["会员活跃", ["活跃", "互动"]],
      ["会员价值", ["复购", "分层"]],
    ],
  ],
  [
    "ord",
    "ORD",
    "交易维度",
    [
      ["销售分析", ["规模", "订单", "效率"]],
      ["商品分析", ["件单"]],
    ],
  ],
  [
    "str",
    "STR",
    "门店维度",
    [
      ["门店经营", ["销售", "目标"]],
      ["客流分析", ["客流", "转化"]],
    ],
  ],
  [
    "inv",
    "INV",
    "库存维度",
    [
      ["库存健康", ["库存", "缺货", "在途"]],
      ["库存效率", ["周转"]],
      ["补货管理", ["建议"]],
    ],
  ],
  [
    "mkt",
    "MKT",
    "营销维度",
    [
      ["活动效果", ["曝光", "互动", "转化"]],
      ["优惠分析", ["用券"]],
    ],
  ],
  [
    "ful",
    "FUL",
    "履约维度",
    [
      ["配送效率", ["规模", "时效"]],
      ["履约质量", ["异常"]],
    ],
  ],
  [
    "svc",
    "SVC",
    "售后维度",
    [
      ["退换货", ["申请", "质量"]],
      ["退款处理", ["金额"]],
      ["客户服务", ["效率"]],
      ["客户声音", ["评价"]],
    ],
  ],
] as const;

export const INDICATOR_DIMENSION_CODE_MAP: Record<string, string> =
  Object.fromEntries(DIMENSIONS.map(([value, code]) => [value, code]));
export const INDICATOR_DIMENSION_VALUE_MAP: Record<string, string> =
  Object.fromEntries(DIMENSIONS.map(([value, code]) => [code, value]));
export const INDICATOR_DIMENSION_LABEL_MAP: Record<string, string> =
  Object.fromEntries(DIMENSIONS.map(([value, , label]) => [label, value]));

export interface IndicatorPathOptionNode {
  label: string;
  value: string;
  pathLabel?: string;
  dimension?: string;
  children?: IndicatorPathOptionNode[];
}

export const INDICATOR_PATH_OPTIONS: IndicatorPathOptionNode[] = DIMENSIONS.map(
  ([dimension, code, label, groups]) => ({
    label: `${code} ${label}`,
    value: code,
    pathLabel: code,
    dimension,
    children: groups.map(([group, topics]) => ({
      label: group,
      value: group,
      children: topics.map((topic) => ({ label: topic, value: topic })),
    })),
  }),
);

export function splitIndicatorPath(path?: unknown): string[] {
  return String(path ?? "")
    .split(INDICATOR_PATH_SEPARATOR)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function normalizeIndicatorDimension(value?: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  return INDICATOR_DIMENSION_CODE_MAP[raw.toLowerCase()]
    ? raw.toLowerCase()
    : INDICATOR_DIMENSION_VALUE_MAP[raw.toUpperCase()] ||
        INDICATOR_DIMENSION_LABEL_MAP[raw] ||
        "";
}

function findOptionBySegment(
  options: IndicatorPathOptionNode[] = [],
  segment: string,
): IndicatorPathOptionNode | undefined {
  return options.find(
    (option) =>
      option.value === segment ||
      option.pathLabel === segment ||
      option.label === segment,
  );
}

export function findIndicatorPathValuePath(
  path?: unknown,
  options: IndicatorPathOptionNode[] = INDICATOR_PATH_OPTIONS,
): string[] {
  const values: string[] = [];
  let currentOptions: IndicatorPathOptionNode[] = options;
  for (const segment of splitIndicatorPath(path)) {
    const matched = findOptionBySegment(currentOptions, segment);
    if (!matched) break;
    values.push(matched.value);
    currentOptions = matched.children || [];
  }
  return values;
}

export function findIndicatorPathNodes(
  valuePath?: unknown,
  options: IndicatorPathOptionNode[] = INDICATOR_PATH_OPTIONS,
): IndicatorPathOptionNode[] {
  const nodes: IndicatorPathOptionNode[] = [];
  let currentOptions: IndicatorPathOptionNode[] = options;
  const list = Array.isArray(valuePath) ? valuePath : [];
  for (const value of list) {
    const matched = currentOptions.find((option) => option.value === value);
    if (!matched) return [];
    nodes.push(matched);
    currentOptions = matched.children || [];
  }
  return nodes;
}

export function formatIndicatorPath(
  valuePath?: unknown,
  options: IndicatorPathOptionNode[] = INDICATOR_PATH_OPTIONS,
): string {
  return findIndicatorPathNodes(valuePath, options)
    .map((node) => node.pathLabel || node.value || node.label)
    .join(INDICATOR_PATH_SEPARATOR);
}

export function getIndicatorDimensionFromPath(
  path?: unknown,
  options: IndicatorPathOptionNode[] = INDICATOR_PATH_OPTIONS,
): string {
  const segments = Array.isArray(path) ? path : splitIndicatorPath(path);
  const first = segments[0] as string | undefined;
  const direct = normalizeIndicatorDimension(first);
  if (direct) return direct;
  const valPath = Array.isArray(path)
    ? path
    : findIndicatorPathValuePath(path, options);
  const root = String(valPath[0] ?? "");
  return INDICATOR_DIMENSION_VALUE_MAP[root] || "";
}
