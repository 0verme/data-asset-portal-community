export function toViewerGraph(graph, options = {}) {
    assertDomainGraph(graph);
    const nodeLabel = options.nodeLabel ?? ((node) => node.name);
    const nodeSubtitle = options.nodeSubtitle ?? ((node) => node.displayName);
    const edgeLabel = options.edgeLabel ?? ((edge) => edge.kind.replaceAll("_", " "));
    const maxLabelLength = normalizeMaximum(options.maxLabelLength, 28);
    const maxSubtitleLength = normalizeMaximum(options.maxSubtitleLength, 28);
    return {
        schemaVersion: "1.0",
        nodes: graph.nodes.map((node) => {
            const fullLabel = String(nodeLabel(node));
            const fullSubtitle = nodeSubtitle(node);
            const type = resolveMapping(options.nodeTypes, node);
            return {
                id: node.id,
                label: shorten(fullLabel, maxLabelLength),
                ...(fullSubtitle === undefined
                    ? {}
                    : { subtitle: shorten(String(fullSubtitle), maxSubtitleLength) }),
                ...(type === undefined ? {} : { type }),
                ...(node.namespace === undefined ? {} : { layer: node.namespace }),
                ...(node.status === undefined ? {} : { status: node.status }),
                ...(node.fields === undefined
                    ? {}
                    : { fields: node.fields.map((field) => ({ ...field })) }),
                metadata: {
                    kind: node.kind,
                    fullLabel,
                    ...(fullSubtitle === undefined ? {} : { fullSubtitle: String(fullSubtitle) }),
                    ...(node.attributes === undefined ? {} : { attributes: node.attributes }),
                },
            };
        }),
        edges: graph.edges.map((edge) => {
            const type = resolveMapping(options.edgeTypes, edge);
            const label = edgeLabel(edge);
            const viewerEdge = {
                ...(edge.id === undefined ? {} : { id: edge.id }),
                source: edge.sourceId,
                target: edge.targetId,
                ...(edge.sourceField === undefined ? {} : { sourceField: edge.sourceField }),
                ...(edge.targetField === undefined ? {} : { targetField: edge.targetField }),
                ...(label === undefined ? {} : { label }),
                ...(type === undefined ? {} : { type }),
                metadata: {
                    kind: edge.kind,
                    ...(edge.evidence === undefined ? {} : { evidence: edge.evidence }),
                    ...(edge.confidence === undefined ? {} : { confidence: edge.confidence }),
                    ...(edge.attributes === undefined ? {} : { attributes: edge.attributes }),
                },
            };
            return viewerEdge;
        }),
    };
}
export function getRootNeighborhoodNodeIds(graph) {
    if (!graph?.rootId)
        return [];
    const nodeIds = new Set([graph.rootId]);
    for (const edge of graph.edges) {
        if (edge.sourceId === graph.rootId)
            nodeIds.add(edge.targetId);
        if (edge.targetId === graph.rootId)
            nodeIds.add(edge.sourceId);
    }
    return [...nodeIds];
}
function assertDomainGraph(graph) {
    if (graph === null ||
        typeof graph !== "object" ||
        !Array.isArray(graph.nodes) ||
        !Array.isArray(graph.edges)) {
        throw new TypeError("Domain lineage graph must contain nodes and edges arrays.");
    }
}
function normalizeMaximum(value, fallback) {
    if (value === null)
        return null;
    if (value === undefined)
        return fallback;
    if (!Number.isInteger(value) || value < 2) {
        throw new TypeError("Label length limits must be null or integers greater than one.");
    }
    return value;
}
function shorten(value, maximum) {
    if (maximum === null || value.length <= maximum)
        return value;
    return `${value.slice(0, maximum - 1)}…`;
}
function resolveMapping(mapping, item) {
    return typeof mapping === "function" ? mapping(item) : mapping?.[item.kind];
}
//# sourceMappingURL=index.js.map