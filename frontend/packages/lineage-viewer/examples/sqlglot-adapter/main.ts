import "../../src/define.js";
import type { LineageGraphData, LineageViewerElement } from "../../src/index.js";

const viewer = document.querySelector("lineage-viewer") as LineageViewerElement;
const sqlTarget = document.querySelector<HTMLElement>("[data-sql]");
const status = document.querySelector<HTMLElement>(".status");

const [sqlResponse, graphResponse] = await Promise.all([
  fetch("./query.sql"),
  fetch("./graph.json"),
]);
if (!sqlResponse.ok || !graphResponse.ok) throw new Error("Unable to load the SQLGlot demo files.");

const sql = await sqlResponse.text();
const graph = (await graphResponse.json()) as LineageGraphData;
if (sqlTarget) sqlTarget.textContent = sql.trim();
viewer.options = {
  viewMode: "column",
  highlightMode: "both",
  showEdgeLabels: true,
};
viewer.data = graph;
if (status)
  status.textContent = `${graph.nodes.length} nodes and ${graph.edges.length} field mappings generated from SQL.`;
