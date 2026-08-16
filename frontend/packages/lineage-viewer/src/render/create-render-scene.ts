import { layoutLineageGraph } from "../layout/index.js";
import type { NormalizedLineageGraph } from "../graph/types.js";
import type { ResolvedLineageViewerOptions } from "../public-api/options.js";
import { fieldRowCenter, measureNodeHeight } from "./node-metrics.js";
import type { RenderEdge, RenderNode, RenderScene } from "./types.js";

const sceneCache = new WeakMap<NormalizedLineageGraph, Map<string, RenderScene>>();
const maximumCachedLayouts = 8;

export function createLayeredRenderScene(
  graph: NormalizedLineageGraph,
  options: ResolvedLineageViewerOptions,
): RenderScene {
  const cacheKey = layoutCacheKey(options);
  const cached = sceneCache.get(graph)?.get(cacheKey);
  if (cached !== undefined) return cached;
  const nodeHeightById = new Map(
    graph.nodes.map((node) => [node.id, measureNodeHeight(node, options.nodeHeight)]),
  );
  const layout = layoutLineageGraph(graph, { ...options, nodeHeightById });
  const nodes: RenderNode[] = layout.nodes.map((position) => ({
    ...position,
    node: graph.nodeById.get(position.id)!,
  }));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const edges: RenderEdge[] = graph.edges.flatMap((edge) => {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    return source === undefined || target === undefined
      ? []
      : [
          {
            key: edge.key,
            edge,
            ...routeEdge(source, target, edge, options.direction),
          },
        ];
  });
  const scene = { width: layout.width, height: layout.height, nodes, edges };
  const graphCache = sceneCache.get(graph) ?? new Map<string, RenderScene>();
  if (graphCache.size >= maximumCachedLayouts) graphCache.delete(graphCache.keys().next().value!);
  graphCache.set(cacheKey, scene);
  sceneCache.set(graph, graphCache);
  return scene;
}

function layoutCacheKey(options: ResolvedLineageViewerOptions): string {
  return JSON.stringify([
    options.direction,
    options.nodeWidth,
    options.nodeHeight,
    options.layerGap,
    options.nodeGap,
  ]);
}

interface RoutedEdge {
  readonly path: string;
  readonly labelX: number;
  readonly labelY: number;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

function routeEdge(
  source: RenderNode,
  target: RenderNode,
  edge: NormalizedLineageGraph["edges"][number],
  direction: ResolvedLineageViewerOptions["direction"],
): RoutedEdge {
  if (edge.sourceField !== undefined && edge.targetField !== undefined) {
    const columnRoute = routeColumnEdge(
      source,
      target,
      edge.sourceField,
      edge.targetField,
      direction,
      edge.key,
    );
    if (columnRoute !== null) return columnRoute;
  }
  if (source.id === target.id) return selfLoop(source, direction);
  const vertical = direction === "TB" || direction === "BT";
  const forward = direction === "LR" || direction === "TB";
  const sameRank = source.rank === target.rank;
  if (sameRank) return sameLayerCurve(source, target, vertical, edge.key);
  if (vertical) {
    const start = { x: source.x + source.width / 2, y: source.y + (forward ? source.height : 0) };
    const end = { x: target.x + target.width / 2, y: target.y + (forward ? 0 : target.height) };
    const middle = (start.y + end.y) / 2;
    return cubicRoute(start, { x: start.x, y: middle }, { x: end.x, y: middle }, end);
  }
  const start = { x: source.x + (forward ? source.width : 0), y: source.y + source.height / 2 };
  const end = { x: target.x + (forward ? 0 : target.width), y: target.y + target.height / 2 };
  const middle = (start.x + end.x) / 2;
  return cubicRoute(start, { x: middle, y: start.y }, { x: middle, y: end.y }, end);
}

function routeColumnEdge(
  source: RenderNode,
  target: RenderNode,
  sourceField: string,
  targetField: string,
  direction: ResolvedLineageViewerOptions["direction"],
  key: string,
): RoutedEdge | null {
  const sourceCenter = fieldRowCenter(source.node, sourceField);
  const targetCenter = fieldRowCenter(target.node, targetField);
  if (sourceCenter === null || targetCenter === null) return null;
  const forward = direction === "LR" || direction === "TB";
  const start = {
    x: source.x + (forward ? source.width : 0),
    y: source.y + sourceCenter,
  };
  const end = {
    x: target.x + (forward ? 0 : target.width),
    y: target.y + targetCenter,
  };
  if (source.id === target.id) return columnSelfLoop(source, start, end, forward, key);
  if (source.rank === target.rank)
    return sameLayerColumnCurve(source, target, start, end, direction, key);
  if (direction === "TB" || direction === "BT") {
    const middle = (start.y + end.y) / 2;
    return cubicRoute(start, { x: start.x, y: middle }, { x: end.x, y: middle }, end);
  }
  const middle = (start.x + end.x) / 2;
  return cubicRoute(start, { x: middle, y: start.y }, { x: middle, y: end.y }, end);
}

function sameLayerColumnCurve(
  source: RenderNode,
  target: RenderNode,
  start: Point,
  end: Point,
  direction: ResolvedLineageViewerOptions["direction"],
  key: string,
): RoutedEdge {
  const forward = direction === "LR" || direction === "TB";
  const offset = 28 + (stableOffset(key) % 3) * 12;
  if (direction === "TB" || direction === "BT") {
    const y = forward
      ? Math.max(source.y + source.height, target.y + target.height) + offset
      : Math.min(source.y, target.y) - offset;
    return cubicRoute(start, { x: start.x, y }, { x: end.x, y }, end);
  }
  const x = forward
    ? Math.max(source.x + source.width, target.x + target.width) + offset
    : Math.min(source.x, target.x) - offset;
  return cubicRoute(start, { x, y: start.y }, { x, y: end.y }, end);
}

function columnSelfLoop(
  node: RenderNode,
  start: Point,
  end: Point,
  forward: boolean,
  key: string,
): RoutedEdge {
  const offset = 36 + (stableOffset(key) % 3) * 10;
  const outerX = forward ? node.x + node.width + offset : node.x - offset;
  if (start.y !== end.y) {
    return cubicRoute(start, { x: outerX, y: start.y }, { x: outerX, y: end.y }, end);
  }
  return cubicRoute(start, { x: outerX, y: start.y - 28 }, { x: outerX, y: end.y + 28 }, end);
}

function sameLayerCurve(
  source: RenderNode,
  target: RenderNode,
  vertical: boolean,
  key: string,
): RoutedEdge {
  const offset = 28 + (stableOffset(key) % 3) * 12;
  if (vertical) {
    const startX = source.x + source.width / 2;
    const endX = target.x + target.width / 2;
    const y = Math.min(source.y, target.y) - offset;
    return cubicRoute(
      { x: startX, y: source.y },
      { x: startX, y },
      { x: endX, y },
      { x: endX, y: target.y },
    );
  }
  const startY = source.y + source.height / 2;
  const endY = target.y + target.height / 2;
  const x = Math.min(source.x, target.x) - offset;
  return cubicRoute(
    { x: source.x, y: startY },
    { x, y: startY },
    { x, y: endY },
    { x: target.x, y: endY },
  );
}

function selfLoop(
  node: RenderNode,
  direction: ResolvedLineageViewerOptions["direction"],
): RoutedEdge {
  const vertical = direction === "TB" || direction === "BT";
  if (vertical) {
    const x = node.x + node.width / 2;
    const y = node.y;
    return cubicRoute({ x, y }, { x: x + 40, y: y - 36 }, { x: x - 40, y: y - 36 }, { x, y });
  }
  const x = node.x + node.width;
  const y = node.y + node.height / 2;
  return cubicRoute({ x, y }, { x: x + 40, y: y - 36 }, { x: x + 40, y: y + 36 }, { x, y: y + 1 });
}

function cubicRoute(start: Point, control1: Point, control2: Point, end: Point): RoutedEdge {
  // At t = 0.5 the cubic coefficients are 1/8, 3/8, 3/8, 1/8.
  const midpoint = (axis: "x" | "y") =>
    (start[axis] + 3 * control1[axis] + 3 * control2[axis] + end[axis]) / 8;
  return {
    path: `M ${start.x} ${start.y} C ${control1.x} ${control1.y}, ${control2.x} ${control2.y}, ${end.x} ${end.y}`,
    labelX: midpoint("x"),
    labelY: midpoint("y"),
  };
}

function stableOffset(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1)
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  return hash;
}
