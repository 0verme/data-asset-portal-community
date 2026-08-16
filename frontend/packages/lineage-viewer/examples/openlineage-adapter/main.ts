import "../../src/define.js";
import type { LineageGraphData, LineageViewerElement } from "../../src/index.js";

const viewer = document.querySelector("lineage-viewer") as LineageViewerElement;
const eventTarget = document.querySelector<HTMLElement>("[data-event]");
const status = document.querySelector<HTMLElement>(".status");

const [eventResponse, graphResponse] = await Promise.all([
  fetch("./event.json"),
  fetch("./graph.json"),
]);
if (!eventResponse.ok || !graphResponse.ok)
  throw new Error("Unable to load the OpenLineage demo files.");

const event: unknown = await eventResponse.json();
const graph = (await graphResponse.json()) as LineageGraphData;
if (eventTarget) eventTarget.textContent = JSON.stringify(event, null, 2);
viewer.options = {
  viewMode: "mixed",
  highlightMode: "both",
  showEdgeLabels: true,
};
viewer.data = graph;
if (status)
  status.textContent = `${graph.nodes.length} nodes and ${graph.edges.length} edges generated from one RunEvent.`;
