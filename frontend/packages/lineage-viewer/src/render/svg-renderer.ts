import type { ResolvedLineageViewerOptions } from "../public-api/options.js";
import type { InteractionState } from "../interactions/index.js";
import { fieldReferenceKey } from "../interactions/index.js";
import type { SearchState } from "../search/index.js";
import type { ViewportTransform } from "../interactions/viewport-types.js";
import { NodeRenderer } from "./node-renderer.js";
import { createSvgElement } from "./svg-dom.js";
import type { RenderEdge, RenderNode, RenderScene } from "./types.js";

interface EdgeElements {
  readonly path: SVGPathElement;
  readonly hitArea: SVGPathElement;
  label: SVGTextElement | null;
  signature: string;
  item: RenderEdge;
}

interface NodeElement {
  readonly group: SVGGElement;
  readonly signature: string;
}

let rendererCount = 0;
export class SvgRenderer {
  readonly svg: SVGSVGElement;
  private readonly viewportGroup: SVGGElement;
  private readonly sceneGroup: SVGGElement;
  private viewportWidth = 0;
  private viewportHeight = 0;
  private readonly markerId = `lineage-viewer-arrow-${++rendererCount}`;
  private readonly nodeRenderer = new NodeRenderer(this.markerId);
  private readonly edgesGroup: SVGGElement;
  private readonly nodesGroup: SVGGElement;
  private readonly edgeElements = new Map<string, EdgeElements>();
  private readonly nodeElements = new Map<string, NodeElement>();
  private fieldElements = new Map<string, SVGGElement>();
  private interactionState: InteractionState | null = null;
  private searchState: SearchState | null = null;
  private interactionDirty = true;
  private searchDirty = true;
  private destroyed = false;
  constructor(host: ShadowRoot) {
    this.svg = createSvgElement("svg");
    this.svg.setAttribute("part", "svg");
    this.svg.setAttribute("width", "100%");
    this.svg.setAttribute("height", "100%");
    this.svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    const defs = createSvgElement("defs");
    const marker = createSvgElement("marker");
    marker.setAttribute("id", this.markerId);
    marker.setAttribute("viewBox", "0 0 10 10");
    marker.setAttribute("refX", "9");
    marker.setAttribute("refY", "5");
    marker.setAttribute("markerWidth", "7");
    marker.setAttribute("markerHeight", "7");
    marker.setAttribute("orient", "auto-start-reverse");
    const arrow = createSvgElement("path");
    arrow.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
    arrow.setAttribute("class", "arrow");
    marker.append(arrow);
    defs.append(marker);
    this.viewportGroup = createSvgElement("g");
    this.viewportGroup.setAttribute("class", "viewport");
    this.sceneGroup = createSvgElement("g");
    this.sceneGroup.setAttribute("class", "scene");
    this.edgesGroup = createSvgElement("g");
    this.edgesGroup.setAttribute("class", "edges");
    this.nodesGroup = createSvgElement("g");
    this.nodesGroup.setAttribute("class", "nodes");
    this.sceneGroup.append(this.edgesGroup, this.nodesGroup);
    this.viewportGroup.append(this.sceneGroup);
    this.svg.append(defs, this.viewportGroup);
    host.append(this.svg);
  }
  render(scene: RenderScene, options: ResolvedLineageViewerOptions): void {
    if (this.destroyed) return;
    this.svg.setAttribute("data-view-mode", options.viewMode);
    const activeEdgeKeys = new Set<string>();
    for (const item of scene.edges) {
      activeEdgeKeys.add(item.key);
      const signature = edgeSignature(item);
      let elements = this.edgeElements.get(item.key);
      if (elements === undefined) {
        elements = {
          path: createSvgElement("path"),
          hitArea: createSvgElement("path"),
          label: null,
          signature: "",
          item,
        };
        this.edgeElements.set(item.key, elements);
      }
      if (elements.signature !== signature) {
        updateEdgePath(elements.path, item, this.markerId);
        updateEdgeHitArea(elements.hitArea, item);
        elements.signature = signature;
        elements.item = item;
      }
      this.edgesGroup.append(elements.hitArea, elements.path);
    }
    for (const [key, elements] of this.edgeElements)
      if (!activeEdgeKeys.has(key)) {
        elements.hitArea.remove();
        elements.path.remove();
        elements.label?.remove();
        this.edgeElements.delete(key);
      }

    const activeNodeIds = new Set<string>();
    for (const [index, item] of scene.nodes.entries()) {
      activeNodeIds.add(item.id);
      const signature = nodeSignature(item);
      let element = this.nodeElements.get(item.id);
      if (element === undefined || element.signature !== signature) {
        element?.group.remove();
        element = { group: this.nodeRenderer.render(item, index), signature };
        this.nodeElements.set(item.id, element);
      }
      this.nodesGroup.append(element.group);
    }
    for (const [id, element] of this.nodeElements)
      if (!activeNodeIds.has(id)) {
        element.group.remove();
        this.nodeElements.delete(id);
      }
    this.fieldElements = collectFieldElements(this.nodeElements);
    this.interactionDirty = true;
    this.searchDirty = true;
    this.setEdgeLabels(options.showEdgeLabels);
  }
  clear(): void {
    this.edgesGroup.replaceChildren();
    this.nodesGroup.replaceChildren();
    this.edgeElements.clear();
    this.nodeElements.clear();
    this.fieldElements.clear();
    this.interactionState = null;
    this.searchState = null;
    this.interactionDirty = true;
    this.searchDirty = true;
  }
  setEdgeLabels(show: boolean): void {
    if (this.destroyed) return;
    for (const elements of this.edgeElements.values()) {
      const shouldShow = show && elements.item.edge.label !== "";
      if (!shouldShow) {
        elements.label?.remove();
        elements.label = null;
        continue;
      }
      const label = elements.label ?? createEdgeLabel();
      label.setAttribute("x", String(elements.item.labelX));
      label.setAttribute("y", String(elements.item.labelY));
      label.textContent = elements.item.edge.label;
      elements.label = label;
      this.edgesGroup.append(label);
    }
  }
  setViewportSize(width: number, height: number): void {
    if (
      width > 0 &&
      height > 0 &&
      Number.isFinite(width) &&
      Number.isFinite(height) &&
      (width !== this.viewportWidth || height !== this.viewportHeight)
    ) {
      this.viewportWidth = width;
      this.viewportHeight = height;
      this.svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    }
  }
  setViewportTransform(transform: ViewportTransform): void {
    this.viewportGroup.setAttribute(
      "transform",
      `translate(${transform.translateX} ${transform.translateY}) scale(${transform.scale})`,
    );
  }
  setInteractionState(state: InteractionState): void {
    const previous = this.interactionDirty ? null : this.interactionState;
    updateSelected(this.nodeElements, previous?.selectedNodeId ?? null, state.selectedNodeId);
    updateFlags(
      this.nodeElements,
      "highlighted",
      previous?.highlightedNodeIds,
      state.highlightedNodeIds,
    );
    updateFlags(this.nodeElements, "dimmed", previous?.dimmedNodeIds, state.dimmedNodeIds);
    updateEdgeFlags(
      this.edgeElements,
      "highlighted",
      previous?.highlightedEdgeKeys,
      state.highlightedEdgeKeys,
    );
    updateEdgeFlags(this.edgeElements, "dimmed", previous?.dimmedEdgeKeys, state.dimmedEdgeKeys);
    updateSelected(this.fieldElements, previous?.selectedFieldKey ?? null, state.selectedFieldKey);
    updateFlags(
      this.fieldElements,
      "highlighted",
      previous?.highlightedFieldKeys,
      state.highlightedFieldKeys,
    );
    updateFlags(this.fieldElements, "dimmed", previous?.dimmedFieldKeys, state.dimmedFieldKeys);
    this.interactionState = state;
    this.interactionDirty = false;
  }
  setSearchState(state: SearchState): void {
    const previous = this.searchDirty ? null : this.searchState;
    updateFlags(this.nodeElements, "search-match", previous?.matchedNodeIds, state.matchedNodeIds);
    updateFlags(this.nodeElements, "search-dimmed", previous?.dimmedNodeIds, state.dimmedNodeIds);
    updateEdgeFlags(
      this.edgeElements,
      "search-dimmed",
      previous?.dimmedEdgeKeys,
      state.dimmedEdgeKeys,
    );
    updateFlags(
      this.fieldElements,
      "search-match",
      previous?.matchedFieldKeys,
      state.matchedFieldKeys,
    );
    updateFlags(
      this.fieldElements,
      "search-dimmed",
      previous?.dimmedFieldKeys,
      state.dimmedFieldKeys,
    );
    this.searchState = state;
    this.searchDirty = false;
  }
  destroy(): void {
    if (this.destroyed) return;
    this.clear();
    this.svg.remove();
    this.destroyed = true;
  }
}

function edgeSignature(item: RenderEdge): string {
  return JSON.stringify([
    item.path,
    item.labelX,
    item.labelY,
    item.edge.source,
    item.edge.target,
    item.edge.sourceField,
    item.edge.targetField,
    item.edge.label,
    item.edge.type,
    item.edge.transformType,
    item.edge.expression,
  ]);
}

function nodeSignature(item: RenderNode): string {
  return JSON.stringify([
    item.x,
    item.y,
    item.width,
    item.height,
    item.rank,
    item.node.label,
    item.node.subtitle,
    item.node.type,
    item.node.status,
    metadataString(item.node.metadata, "fullLabel"),
    metadataString(item.node.metadata, "fullSubtitle"),
    item.node.fields?.map((field) => [field.id, field.label, field.dataType, field.description]),
  ]);
}

function updateEdgePath(path: SVGPathElement, item: RenderEdge, markerId: string): void {
  const isColumnEdge = item.edge.sourceField !== undefined && item.edge.targetField !== undefined;
  path.setAttribute("class", isColumnEdge ? "edge column-edge" : "edge table-edge");
  path.setAttribute("d", item.path);
  path.setAttribute("marker-end", `url(#${markerId})`);
  path.setAttribute("data-edge-key", item.key);
  path.setAttribute("data-edge-source", item.edge.source);
  path.setAttribute("data-edge-target", item.edge.target);
  setOptionalAttribute(path, "data-edge-source-field", item.edge.sourceField);
  setOptionalAttribute(path, "data-edge-target-field", item.edge.targetField);
}

function updateEdgeHitArea(path: SVGPathElement, item: RenderEdge): void {
  path.setAttribute("class", "edge-hit-area");
  path.setAttribute("d", item.path);
  path.setAttribute("data-edge-key", item.key);
}

function createEdgeLabel(): SVGTextElement {
  const label = createSvgElement("text");
  label.setAttribute("class", "edge-label");
  label.setAttribute("dy", "-6");
  label.setAttribute("text-anchor", "middle");
  return label;
}

function collectFieldElements(nodes: ReadonlyMap<string, NodeElement>): Map<string, SVGGElement> {
  const fields = new Map<string, SVGGElement>();
  for (const [nodeId, node] of nodes)
    for (const field of node.group.querySelectorAll<SVGGElement>(".field-row")) {
      const fieldId = field.dataset["fieldId"];
      if (fieldId !== undefined) fields.set(fieldReferenceKey({ nodeId, fieldId }), field);
    }
  return fields;
}

function updateSelected<T extends Element | NodeElement>(
  elements: ReadonlyMap<string, T>,
  previous: string | null,
  next: string | null,
): void {
  if (previous !== null && previous !== next)
    setFlag(elementFrom(elements.get(previous)), "selected", false);
  if (next !== null) setFlag(elementFrom(elements.get(next)), "selected", true);
}

function updateFlags<T extends Element | NodeElement>(
  elements: ReadonlyMap<string, T>,
  name: string,
  previous: ReadonlySet<string> | undefined,
  next: ReadonlySet<string>,
): void {
  if (previous === undefined) {
    for (const [key, value] of elements) setFlag(elementFrom(value), name, next.has(key));
    return;
  }
  for (const key of previous)
    if (!next.has(key)) setFlag(elementFrom(elements.get(key)), name, false);
  for (const key of next)
    if (!previous.has(key)) setFlag(elementFrom(elements.get(key)), name, true);
}

function updateEdgeFlags(
  elements: ReadonlyMap<string, EdgeElements>,
  name: string,
  previous: ReadonlySet<string> | undefined,
  next: ReadonlySet<string>,
): void {
  if (previous === undefined) {
    for (const [key, value] of elements) setFlag(value.path, name, next.has(key));
    return;
  }
  for (const key of previous) if (!next.has(key)) setFlag(elements.get(key)?.path, name, false);
  for (const key of next) if (!previous.has(key)) setFlag(elements.get(key)?.path, name, true);
}

function elementFrom(value: Element | NodeElement | undefined): Element | undefined {
  return value instanceof Element ? value : value?.group;
}

function setOptionalAttribute(element: Element, name: string, value: string | undefined): void {
  if (value === undefined) element.removeAttribute(name);
  else element.setAttribute(name, value);
}

function metadataString(
  metadata: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" ? value : undefined;
}

function setFlag(element: Element | undefined, name: string, active: boolean): void {
  if (element === undefined) return;
  if (active) element.setAttribute(`data-${name}`, "");
  else element.removeAttribute(`data-${name}`);
}
