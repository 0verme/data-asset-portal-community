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

// SAFETY: demo/datasets/indicator_paths.json is generated from the demo seed and
// follows the PathCatalogNode shape; JSON imports arrive from TypeScript as
// `unknown`, so the narrowing happens here once instead of at every read.
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

export const INDICATOR_PATH_OPTIONS: IndicatorPathOptionNode[] = ROOTS.map(
  (root) => toPathOption(root, root.dimensionCode || "", true),
);

/** Storage format of `p_indicator_item.dimension_code` (String(16)). */
export const INDICATOR_DIMENSION_CODE_RE = /^[A-Za-z][A-Za-z0-9_]{0,15}$/;

export function splitIndicatorPath(path?: unknown): string[] {
  return String(path ?? "")
    .split(INDICATOR_PATH_SEPARATOR)
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Normalize a dimension code.
 *
 * Dimensions are user data: this only checks the generic storage format and
 * lowercases the code. It never consults a list of "known" business dimensions
 * and never translates industry wording into a code.
 */
export function normalizeIndicatorDimension(value?: unknown): string {
  const raw = String(value ?? "").trim();
  if (!INDICATOR_DIMENSION_CODE_RE.test(raw)) return "";
  return raw.toLowerCase();
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
  // Fall back to the configured path tree: `dimension` there comes from the path
  // configuration, never from built-in industry vocabulary.
  const root = String(
    (Array.isArray(path) ? path[0] : findIndicatorPathValuePath(path, options)[0]) ?? "",
  );
  const matched = options.find((option) => option.value === root);
  return normalizeIndicatorDimension(matched?.dimension);
}
