import demoIndicatorPathTree from "../../../demo/datasets/indicator_paths.json" with {
  type: "json",
};

export const INDICATOR_PATH_SEPARATOR = " > ";

type PathCatalogNode = {
  pathCode: string;
  pathName: string;
  dimensionCode?: string;
  sortOrder: number;
  children?: readonly PathCatalogNode[];
};

export interface IndicatorPathOptionNode {
  label: string;
  value: string;
  pathLabel?: string;
  dimension?: string;
  children?: IndicatorPathOptionNode[];
}

const PATH_CATALOG = demoIndicatorPathTree as unknown as readonly PathCatalogNode[];

function orderedChildren(node: PathCatalogNode): readonly PathCatalogNode[] {
  return [...(node.children || [])].sort((left, right) => left.sortOrder - right.sortOrder);
}

function toPathOption(
  node: PathCatalogNode,
  dimension: string,
  isRoot = false,
): IndicatorPathOptionNode {
  const pathLabel = isRoot ? node.pathCode : node.pathName;
  const children = orderedChildren(node).map((child) =>
    toPathOption(child, dimension),
  );
  return {
    label: isRoot ? `${node.pathCode} ${node.pathName}` : node.pathName,
    value: pathLabel,
    pathLabel,
    dimension,
    ...(children.length ? { children } : {}),
  };
}

const ROOTS = [...PATH_CATALOG].sort(
  (left, right) => left.sortOrder - right.sortOrder,
);

export const INDICATOR_DIMENSION_CODE_MAP: Record<string, string> =
  Object.fromEntries(
    ROOTS.map((root) => [root.dimensionCode || "", root.pathCode]),
  );
export const INDICATOR_DIMENSION_VALUE_MAP: Record<string, string> =
  Object.fromEntries(
    ROOTS.map((root) => [root.pathCode.toUpperCase(), root.dimensionCode || ""]),
  );
export const INDICATOR_DIMENSION_LABEL_MAP: Record<string, string> =
  Object.fromEntries(
    ROOTS.flatMap((root) => [
      [root.pathName, root.dimensionCode || ""],
      [`${root.pathCode} ${root.pathName}`, root.dimensionCode || ""],
    ]),
  );

export const INDICATOR_PATH_OPTIONS: IndicatorPathOptionNode[] = ROOTS.map(
  (root) => toPathOption(root, root.dimensionCode || "", true),
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
