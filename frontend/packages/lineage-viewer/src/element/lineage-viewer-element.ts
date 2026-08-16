import { normalizeLineageGraphData, type NormalizedLineageGraph } from "../graph/index.js";
import {
  calculateInteractionState,
  ViewportController,
  type FieldReference,
} from "../interactions/index.js";
import type {
  SceneBounds,
  ViewportFitOptions,
  ViewportSize,
} from "../interactions/viewport-types.js";
import { unionBounds } from "../interactions/viewport-math.js";
import { createLayeredRenderScene, type RenderScene, SvgRenderer } from "../render/index.js";
import type { LineageDiagnostic, LineageEdge, LineageGraphData } from "../schema/index.js";
import {
  defaultLineageViewerOptions,
  resolveOptions,
  type LineageViewerOptions,
  type ResolvedLineageViewerOptions,
} from "../public-api/options.js";
import type {
  LineageDiagnosticEventDetail,
  LineageEdgeClickEventDetail,
  LineageFieldClickEventDetail,
  LineageFieldSelection,
  LineageNodeClickEventDetail,
  LineageReadyEventDetail,
  LineageSelectionChangeEventDetail,
} from "../public-api/events.js";
import type {
  LineageFieldLocation,
  LineageSearchFilter,
  LineageSearchOptions,
  LineageSearchResult,
} from "../public-api/search.js";
import {
  calculateSearchState,
  normalizeSearchOptions,
  searchFields as searchFieldLocations,
  searchLineageGraph,
} from "../search/index.js";
import { createLineageViewGraph } from "../view/index.js";
import { lineageViewerStyles } from "./styles.js";
import type { LineageViewerState } from "./element-state.js";

const ElementBase: typeof HTMLElement =
  typeof HTMLElement === "undefined" ? (class {} as typeof HTMLElement) : HTMLElement;
export class LineageViewerElement extends ElementBase {
  private readonly root: ShadowRoot;
  private renderer: SvgRenderer | null = null;
  private viewport: ViewportController | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private state: LineageViewerState = "idle";
  private graph: NormalizedLineageGraph | null = null;
  private viewGraph: NormalizedLineageGraph | null = null;
  private scene: RenderScene | null = null;
  private diagnostics: readonly LineageDiagnostic[] = [];
  private input: unknown = null;
  private resolvedOptions: ResolvedLineageViewerOptions = defaultLineageViewerOptions;
  private selectedId: string | null = null;
  private selectedFieldRef: FieldReference | null = null;
  private searchOptions: LineageSearchOptions | null = null;
  private fieldSearchKeyword: string | null = null;
  private currentSearchResults: readonly LineageSearchResult[] = [];
  private initialized = false;
  private readyDispatched = false;
  private hasObservedViewport = false;
  private drag: { pointerId: number; x: number; y: number; moved: boolean } | null = null;
  private suppressClick = false;
  constructor() {
    super();
    this.root = this.attachShadow({ mode: "open" });
  }
  get data(): LineageGraphData | null {
    return this.graph === null
      ? null
      : {
          schemaVersion: this.graph.schemaVersion,
          nodes: this.graph.nodes.map((node) => ({ ...node })),
          edges: this.graph.edges.map(toPublicEdge),
        };
  }
  set data(data: LineageGraphData | null) {
    this.setData(data);
  }
  get options(): ResolvedLineageViewerOptions {
    return { ...this.resolvedOptions };
  }
  set options(options: Partial<LineageViewerOptions>) {
    this.setOptions(options);
  }
  get selectedNodeId(): string | null {
    return this.state === "destroyed" ? null : this.selectedId;
  }
  get selectedField(): LineageFieldSelection | null {
    return this.state === "destroyed" || this.selectedFieldRef === null
      ? null
      : { ...this.selectedFieldRef };
  }
  get searchResults(): readonly LineageSearchResult[] {
    return this.state === "destroyed"
      ? []
      : this.currentSearchResults.map((result) => ({ ...result }));
  }
  connectedCallback(): void {
    if (this.state === "destroyed") return;
    this.ensureInitialized();
    this.observe();
    this.process(false);
  }
  disconnectedCallback(): void {
    this.stopObserving();
    this.renderer?.clear();
  }
  setData(data: LineageGraphData | null): void {
    if (this.state === "destroyed") return;
    this.input = data;
    this.process(true);
  }
  setOptions(options: Partial<LineageViewerOptions>): void {
    if (this.state === "destroyed") return;
    const previous = this.resolvedOptions;
    this.resolvedOptions = resolveOptions(previous, options);
    const normalizationChanged =
      previous.validationMode !== this.resolvedOptions.validationMode ||
      previous.showSelfLoops !== this.resolvedOptions.showSelfLoops;
    const layoutChanged =
      previous.direction !== this.resolvedOptions.direction ||
      previous.nodeWidth !== this.resolvedOptions.nodeWidth ||
      previous.nodeHeight !== this.resolvedOptions.nodeHeight ||
      previous.layerGap !== this.resolvedOptions.layerGap ||
      previous.nodeGap !== this.resolvedOptions.nodeGap;
    const viewModeChanged = previous.viewMode !== this.resolvedOptions.viewMode;
    if (viewModeChanged && this.resolvedOptions.viewMode === "table")
      this.updateFieldSelection(null, "api");
    if (normalizationChanged) this.process(true);
    else if ((layoutChanged || viewModeChanged) && this.initialized) this.renderCurrent(true);
    else if (
      previous.fitOnLoad !== this.resolvedOptions.fitOnLoad &&
      this.resolvedOptions.fitOnLoad &&
      this.scene
    )
      this.viewport?.setScene(bounds(this.scene), this.size(), true);
    else if (previous.showEdgeLabels !== this.resolvedOptions.showEdgeLabels && this.initialized)
      this.renderer?.setEdgeLabels(this.resolvedOptions.showEdgeLabels);
    this.applyInteractionState();
  }
  getDiagnostics(): readonly LineageDiagnostic[] {
    return [...this.diagnostics];
  }
  fitView(): void {
    if (this.state !== "destroyed") this.viewport?.fit();
  }
  fitBounds(bounds: SceneBounds, options?: ViewportFitOptions): void {
    if (this.state !== "destroyed") this.viewport?.fitBounds(bounds, options);
  }
  fitNodes(nodeIds: readonly string[], options?: ViewportFitOptions): void {
    if (this.state === "destroyed" || nodeIds.length === 0) return;
    const nodes = nodeIds
      .map((nodeId) => this.findSceneNode(nodeId))
      .filter((node): node is RenderScene["nodes"][number] => node !== undefined);
    if (nodes.length === 0) return;
    const bounds = unionBounds(nodes.map((node) => node));
    if (bounds) this.viewport?.fitBounds(bounds, options);
  }
  resetView(): void {
    if (this.state !== "destroyed") this.viewport?.reset();
  }
  focusNode(nodeId: string): void {
    const node = this.findSceneNode(nodeId);
    if (node) this.viewport?.focus({ x: node.x + node.width / 2, y: node.y + node.height / 2 });
  }
  focusField(nodeId: string, fieldId: string): void {
    const reference = { nodeId: nodeId.trim(), fieldId: fieldId.trim() };
    if (this.findField(reference) !== null) this.focusNode(reference.nodeId);
  }
  zoomBy(factor: number): void {
    const size = this.size();
    this.viewport?.zoom({ x: size.width / 2, y: size.height / 2 }, factor);
  }
  selectNode(nodeId: string): void {
    const id = nodeId.trim();
    if (this.graph?.nodeById.has(id)) this.updateSelection(id, "api");
  }
  selectField(nodeId: string, fieldId: string): void {
    if (this.resolvedOptions.viewMode === "table") return;
    const reference = { nodeId: nodeId.trim(), fieldId: fieldId.trim() };
    if (this.findField(reference) !== null) this.updateFieldSelection(reference, "api");
  }
  clearSelection(): void {
    this.updateSelection(null, "api");
  }
  search(query: string, filter?: LineageSearchFilter): readonly LineageSearchResult[];
  search(options: LineageSearchOptions): readonly LineageSearchResult[];
  search(
    queryOrOptions: string | LineageSearchOptions,
    filter: LineageSearchFilter = {},
  ): readonly LineageSearchResult[] {
    if (this.state === "destroyed") return [];
    this.fieldSearchKeyword = null;
    this.searchOptions = normalizeSearchOptions(queryOrOptions, filter);
    this.refreshSearch();
    return this.searchResults;
  }
  searchFields(keyword: string): readonly LineageFieldLocation[] {
    if (this.state === "destroyed") return [];
    const normalized = keyword.trim();
    this.searchOptions = null;
    this.fieldSearchKeyword = normalized === "" ? null : normalized;
    const results = searchFieldLocations(this.graph, normalized);
    this.currentSearchResults = results.map(({ nodeId, fieldId }) => ({
      kind: "field",
      nodeId,
      fieldId,
    }));
    this.applySearchState();
    const first = results[0];
    if (first !== undefined) this.focusField(first.nodeId, first.fieldId);
    return results.map((result) => ({ ...result }));
  }
  clearSearch(): void {
    if (
      this.state === "destroyed" ||
      (this.searchOptions === null && this.fieldSearchKeyword === null)
    )
      return;
    this.searchOptions = null;
    this.fieldSearchKeyword = null;
    this.currentSearchResults = [];
    this.applySearchState();
  }
  destroy(): void {
    if (this.state === "destroyed") return;
    this.stopObserving();
    this.renderer?.destroy();
    this.renderer = null;
    this.viewport?.destroy();
    this.viewport = null;
    this.root.replaceChildren();
    this.graph = null;
    this.viewGraph = null;
    this.scene = null;
    this.selectedId = null;
    this.selectedFieldRef = null;
    this.searchOptions = null;
    this.fieldSearchKeyword = null;
    this.currentSearchResults = [];
    this.diagnostics = [];
    this.state = "destroyed";
  }
  private ensureInitialized(): void {
    if (this.initialized) return;
    const style = document.createElement("style");
    style.textContent = lineageViewerStyles;
    const container = document.createElement("div");
    container.className = "root";
    this.root.append(style, container);
    this.renderer = new SvgRenderer(this.root);
    this.viewport = new ViewportController((transform) =>
      this.renderer?.setViewportTransform(transform),
    );
    this.renderer.svg.addEventListener("wheel", this.onWheel, { passive: false });
    this.renderer.svg.addEventListener("pointerdown", this.onPointerDown);
    this.renderer.svg.addEventListener("pointermove", this.onPointerMove);
    this.renderer.svg.addEventListener("pointerup", this.onPointerEnd);
    this.renderer.svg.addEventListener("pointercancel", this.onPointerEnd);
    this.renderer.svg.addEventListener("click", this.onClick);
    this.initialized = true;
  }
  private process(emitEvents: boolean): void {
    if (this.state === "destroyed") return;
    if (this.input === null) {
      this.graph = null;
      this.diagnostics = [];
      this.state = "idle";
      this.clearForData();
      this.refreshSearch();
      this.renderCurrent(true);
      return;
    }
    const result = normalizeLineageGraphData(this.input, {
      validationMode: this.resolvedOptions.validationMode,
      showSelfLoops: this.resolvedOptions.showSelfLoops,
    });
    this.graph = result.graph;
    this.diagnostics = result.diagnostics;
    this.state =
      result.graph === null ? "invalid" : result.graph.nodes.length === 0 ? "empty" : "rendered";
    if (this.selectedId !== null && !this.graph?.nodeById.has(this.selectedId))
      this.updateSelection(null, "data");
    if (this.selectedFieldRef !== null && this.findField(this.selectedFieldRef) === null)
      this.updateFieldSelection(null, "data");
    this.refreshSearch();
    this.renderCurrent(true);
    if (emitEvents && this.isConnected) this.emitDiagnostics();
    this.dispatchReadyIfPossible();
  }
  private clearForData(): void {
    if (this.selectedId !== null || this.selectedFieldRef !== null)
      this.updateSelection(null, "data");
  }
  private renderCurrent(newScene: boolean): void {
    if (!this.initialized || this.renderer === null) return;
    this.root.querySelector(".state")?.remove();
    this.scene = null;
    this.viewGraph = null;
    if (this.state === "rendered" && this.graph !== null) {
      this.viewGraph = createLineageViewGraph(this.graph, this.resolvedOptions.viewMode);
      this.scene = createLayeredRenderScene(this.viewGraph, this.resolvedOptions);
      this.renderer.render(this.scene, this.resolvedOptions);
      const size = this.size();
      this.renderer.setViewportSize(size.width, size.height);
      if (newScene)
        this.viewport?.setScene(bounds(this.scene), size, this.resolvedOptions.fitOnLoad);
      this.applyInteractionState();
      this.applySearchState();
      return;
    }
    this.renderer.clear();
    this.viewport?.setScene(null, this.size(), false);
    const container = document.createElement("div");
    container.className = "state";
    container.dataset["kind"] = this.state;
    const primary = document.createElement("p");
    primary.textContent =
      this.state === "empty"
        ? "No lineage nodes"
        : this.state === "invalid"
          ? "Unable to render lineage data"
          : "No lineage data";
    container.append(primary);
    if (this.state === "invalid") {
      const first = this.diagnostics.find((item) => item.level === "error");
      if (first) {
        const summary = document.createElement("p");
        summary.textContent = first.message;
        container.append(summary);
      }
    }
    this.root.append(container);
  }
  private applyInteractionState(): void {
    this.renderer?.setInteractionState(
      calculateInteractionState(
        this.viewGraph,
        this.selectedId,
        this.resolvedOptions.highlightMode,
        this.selectedFieldRef,
      ),
    );
  }
  private refreshSearch(): void {
    this.currentSearchResults =
      this.fieldSearchKeyword === null
        ? searchLineageGraph(this.graph, this.searchOptions)
        : searchFieldLocations(this.graph, this.fieldSearchKeyword).map(({ nodeId, fieldId }) => ({
            kind: "field",
            nodeId,
            fieldId,
          }));
    this.applySearchState();
  }
  private applySearchState(): void {
    this.renderer?.setSearchState(
      calculateSearchState(
        this.graph,
        this.viewGraph,
        this.currentSearchResults,
        this.searchOptions !== null || this.fieldSearchKeyword !== null,
      ),
    );
  }
  private updateSelection(next: string | null, source: "pointer" | "api" | "data"): void {
    if (next === this.selectedId && this.selectedFieldRef === null) return;
    const previousSelectedNodeId = this.selectedId;
    const previousSelectedField = this.selectedFieldRef;
    this.selectedId = next;
    this.selectedFieldRef = null;
    this.applyInteractionState();
    const node = next === null ? null : (this.graph?.nodeById.get(next) ?? null);
    this.emitSelectionChange(
      previousSelectedNodeId,
      previousSelectedField,
      node ?? null,
      null,
      source,
    );
  }
  private updateFieldSelection(
    next: FieldReference | null,
    source: "pointer" | "api" | "data",
  ): void {
    if (
      next?.nodeId === this.selectedFieldRef?.nodeId &&
      next?.fieldId === this.selectedFieldRef?.fieldId &&
      this.selectedId === null
    )
      return;
    const previousSelectedNodeId = this.selectedId;
    const previousSelectedField = this.selectedFieldRef;
    this.selectedId = null;
    this.selectedFieldRef = next;
    this.applyInteractionState();
    const match = next === null ? null : this.findField(next);
    this.emitSelectionChange(
      previousSelectedNodeId,
      previousSelectedField,
      match?.node ?? null,
      match?.field ?? null,
      source,
    );
  }
  private emitSelectionChange(
    previousSelectedNodeId: string | null,
    previousSelectedField: FieldReference | null,
    node: NormalizedLineageGraph["nodes"][number] | null,
    field: NonNullable<NormalizedLineageGraph["nodes"][number]["fields"]>[number] | null,
    source: "pointer" | "api" | "data",
  ): void {
    this.dispatchEvent(
      new CustomEvent<LineageSelectionChangeEventDetail>("lineage-selection-change", {
        detail: {
          selectedNodeId: this.selectedId,
          previousSelectedNodeId,
          selectedField: this.selectedFieldRef === null ? null : { ...this.selectedFieldRef },
          previousSelectedField:
            previousSelectedField === null ? null : { ...previousSelectedField },
          node: node === null ? null : { ...node },
          field: field === null ? null : { ...field },
          source,
        },
        bubbles: true,
        composed: true,
      }),
    );
  }
  private findField(reference: FieldReference): {
    node: NormalizedLineageGraph["nodes"][number];
    field: NonNullable<NormalizedLineageGraph["nodes"][number]["fields"]>[number];
  } | null {
    const node = this.graph?.nodeById.get(reference.nodeId);
    const field = node?.fields?.find((candidate) => candidate.id === reference.fieldId);
    return node && field ? { node, field } : null;
  }
  private findSceneNode(value: string): RenderScene["nodes"][number] | undefined {
    const id = value.trim();
    return id ? this.scene?.nodes.find((node) => node.id === id) : undefined;
  }
  private readonly onWheel = (event: WheelEvent): void => {
    if (this.state !== "rendered") return;
    event.preventDefault();
    const point = this.eventPoint(event);
    this.viewport?.zoom(point, Math.exp(-event.deltaY * 0.002));
  };
  private readonly onPointerDown = (event: PointerEvent): void => {
    if (
      event.button !== 0 ||
      this.state !== "rendered" ||
      (event.target instanceof Element && event.target.closest(".node"))
    )
      return;
    this.drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    this.renderer?.svg.setPointerCapture(event.pointerId);
    this.renderer?.svg.setAttribute("data-panning", "");
  };
  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    const x = event.clientX - this.drag.x;
    const y = event.clientY - this.drag.y;
    if (Math.abs(x) + Math.abs(y) > 3) this.drag.moved = true;
    this.drag.x = event.clientX;
    this.drag.y = event.clientY;
    this.viewport?.pan(x, y);
  };
  private readonly onPointerEnd = (event: PointerEvent): void => {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    this.suppressClick = this.drag.moved;
    if (this.renderer?.svg.hasPointerCapture(event.pointerId))
      this.renderer.svg.releasePointerCapture(event.pointerId);
    this.drag = null;
    this.renderer?.svg.removeAttribute("data-panning");
  };
  private readonly onClick = (event: MouseEvent): void => {
    if (this.suppressClick) {
      this.suppressClick = false;
      return;
    }
    const edgeTarget =
      event.target instanceof Element
        ? event.target.closest<SVGPathElement>("[data-edge-key]")
        : null;
    const edgeKey = edgeTarget?.dataset["edgeKey"];
    if (edgeKey !== undefined) {
      const edge = this.viewGraph?.edges.find((candidate) => candidate.key === edgeKey);
      if (edge !== undefined) this.emitEdgeClick(edge);
      return;
    }
    const fieldTarget =
      event.target instanceof Element ? event.target.closest<SVGGElement>(".field-row") : null;
    const target =
      event.target instanceof Element ? event.target.closest<SVGGElement>(".node") : null;
    const id = target?.dataset["nodeId"];
    const fieldId = fieldTarget?.dataset["fieldId"];
    if (id && fieldId && this.graph) {
      const match = this.findField({ nodeId: id, fieldId });
      if (!match) return;
      this.dispatchEvent(
        new CustomEvent<LineageFieldClickEventDetail>("lineage-field-click", {
          detail: {
            nodeId: id,
            fieldId,
            node: { ...match.node },
            field: { ...match.field },
          },
          bubbles: true,
          composed: true,
        }),
      );
      this.updateFieldSelection({ nodeId: id, fieldId }, "pointer");
      return;
    }
    if (id && this.graph) {
      const node = this.graph.nodeById.get(id);
      if (!node) return;
      this.dispatchEvent(
        new CustomEvent<LineageNodeClickEventDetail>("lineage-node-click", {
          detail: { nodeId: id, node: { ...node } },
          bubbles: true,
          composed: true,
        }),
      );
      this.updateSelection(id, "pointer");
    } else this.updateSelection(null, "pointer");
  };
  private emitEdgeClick(edge: NormalizedLineageGraph["edges"][number]): void {
    const sourceField = this.findField({
      nodeId: edge.source,
      fieldId: edge.sourceField ?? "",
    })?.field;
    const targetField = this.findField({
      nodeId: edge.target,
      fieldId: edge.targetField ?? "",
    })?.field;
    const detail: LineageEdgeClickEventDetail = {
      edgeKey: edge.key,
      edge: toPublicEdge(edge),
      source: {
        nodeId: edge.source,
        fieldId: edge.sourceField ?? null,
        label:
          edge.sourceField === undefined
            ? edge.source
            : `${edge.source}.${sourceField?.label ?? edge.sourceField}`,
      },
      target: {
        nodeId: edge.target,
        fieldId: edge.targetField ?? null,
        label:
          edge.targetField === undefined
            ? edge.target
            : `${edge.target}.${targetField?.label ?? edge.targetField}`,
      },
      transformType: edge.transformType ?? null,
      expression: edge.expression ?? null,
    };
    this.dispatchEvent(
      new CustomEvent<LineageEdgeClickEventDetail>("lineage-edge-click", {
        detail,
        bubbles: true,
        composed: true,
      }),
    );
  }
  private eventPoint(event: MouseEvent): { x: number; y: number } {
    const rect = this.renderer?.svg.getBoundingClientRect();
    const size = this.size();
    return rect && rect.width > 0 && rect.height > 0
      ? {
          x: ((event.clientX - rect.left) * size.width) / rect.width,
          y: ((event.clientY - rect.top) * size.height) / rect.height,
        }
      : { x: 0, y: 0 };
  }
  private size(): ViewportSize {
    const rect = this.renderer?.svg.getBoundingClientRect();
    return { width: rect?.width ?? 0, height: rect?.height ?? 0 };
  }
  private observe(): void {
    if (this.resizeObserver || typeof ResizeObserver === "undefined") {
      if (typeof ResizeObserver === "undefined") {
        this.hasObservedViewport = true;
        this.dispatchReadyIfPossible();
      }
      return;
    }
    this.resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry || this.state === "destroyed") return;
      const { width, height } = entry.contentRect;
      this.renderer?.setViewportSize(width, height);
      this.viewport?.resize({ width, height }, this.resolvedOptions.fitOnLoad);
      this.hasObservedViewport = width > 0 && height > 0;
      this.dispatchReadyIfPossible();
    });
    this.resizeObserver.observe(this);
  }
  private stopObserving(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
  }
  private dispatchReadyIfPossible(): void {
    if (
      this.readyDispatched ||
      !this.hasObservedViewport ||
      !this.isConnected ||
      (this.state !== "empty" && this.state !== "rendered")
    )
      return;
    this.readyDispatched = true;
    this.dispatchEvent(
      new CustomEvent<LineageReadyEventDetail>("lineage-ready", {
        detail: {
          nodeCount: this.graph?.nodes.length ?? 0,
          edgeCount: this.graph?.edges.length ?? 0,
          state: this.state,
        },
        bubbles: true,
        composed: true,
      }),
    );
  }
  private emitDiagnostics(): void {
    const errors = this.diagnostics.filter((item) => item.level === "error");
    const warnings = this.diagnostics.filter((item) => item.level === "warning");
    this.emit("lineage-error", errors, true);
    this.emit("lineage-warning", warnings, false);
  }
  private emit(
    name: "lineage-error" | "lineage-warning",
    diagnostics: readonly LineageDiagnostic[],
    hasErrors: boolean,
  ): void {
    if (diagnostics.length === 0) return;
    this.dispatchEvent(
      new CustomEvent<LineageDiagnosticEventDetail>(name, {
        detail: { diagnostics: diagnostics.map((item) => ({ ...item })), hasErrors },
        bubbles: true,
        composed: true,
      }),
    );
  }
}
function bounds(scene: RenderScene) {
  return { x: 0, y: 0, width: scene.width, height: scene.height };
}
function toPublicEdge(edge: NormalizedLineageGraph["edges"][number]): LineageEdge {
  return {
    source: edge.source,
    target: edge.target,
    ...(edge.id === undefined ? {} : { id: edge.id }),
    ...(edge.sourceField === undefined ? {} : { sourceField: edge.sourceField }),
    ...(edge.targetField === undefined ? {} : { targetField: edge.targetField }),
    ...(edge.label === "" ? {} : { label: edge.label }),
    ...(edge.type === "lineage" ? {} : { type: edge.type }),
    ...(edge.transformType === undefined ? {} : { transformType: edge.transformType }),
    ...(edge.expression === undefined ? {} : { expression: edge.expression }),
    ...(edge.metadata === undefined ? {} : { metadata: edge.metadata }),
  };
}
