import "../../src/define.js";
import type {
  LineageEdge,
  LineageEdgeClickEventDetail,
  LineageViewerElement,
} from "../../src/index.js";

const viewer = document.querySelector("lineage-viewer") as LineageViewerElement;
const status = document.querySelector<HTMLElement>(".status");

viewer.options = {
  viewMode: "column",
  highlightMode: "both",
  showEdgeLabels: true,
};
viewer.data = {
  nodes: [
    {
      id: "raw_payments",
      label: "RAW_PAYMENTS",
      fields: [
        { id: "payment_id", dataType: "string" },
        { id: "amount_cents", dataType: "bigint" },
        { id: "currency", dataType: "string" },
      ],
    },
    {
      id: "fct_payments",
      label: "FCT_PAYMENTS",
      fields: [
        { id: "payment_key", dataType: "string" },
        { id: "amount_usd", dataType: "decimal(18,2)" },
      ],
    },
    {
      id: "daily_revenue",
      label: "DAILY_REVENUE",
      fields: [{ id: "gross_revenue_usd", dataType: "decimal(18,2)" }],
    },
  ],
  edges: [
    {
      source: "raw_payments",
      target: "fct_payments",
      sourceField: "payment_id",
      targetField: "payment_key",
      label: "rename",
      transformType: "rename",
      expression: "payment_id",
    },
    {
      source: "raw_payments",
      target: "fct_payments",
      sourceField: "amount_cents",
      targetField: "amount_usd",
      label: "convert",
      transformType: "transform",
      expression: "amount_cents / 100.0",
    },
    {
      source: "fct_payments",
      target: "daily_revenue",
      sourceField: "amount_usd",
      targetField: "gross_revenue_usd",
      label: "sum",
      transformType: "aggregate",
      expression: "SUM(amount_usd)",
    },
  ],
};

viewer.addEventListener("lineage-field-click", (event) => {
  const { nodeId, fieldId } = (event as CustomEvent<{ nodeId: string; fieldId: string }>).detail;
  const mappings = (viewer.data?.edges ?? []).filter(
    (edge) =>
      (edge.source === nodeId && edge.sourceField === fieldId) ||
      (edge.target === nodeId && edge.targetField === fieldId),
  );
  if (status) status.textContent = describeMappings(nodeId, fieldId, mappings);
});
viewer.addEventListener("lineage-edge-click", (event) => {
  const detail = (event as CustomEvent<LineageEdgeClickEventDetail>).detail;
  if (status)
    status.textContent = `${detail.source.label} → ${detail.target.label} | ${
      detail.transformType ?? "unknown"
    }: ${detail.expression ?? "no expression"}`;
});
document
  .querySelector<HTMLButtonElement>('[data-action="fit"]')
  ?.addEventListener("click", () => viewer.fitView());
document
  .querySelector<HTMLButtonElement>('[data-action="clear"]')
  ?.addEventListener("click", () => {
    viewer.clearSelection();
    if (status) status.textContent = "Selection cleared.";
  });

function describeMappings(
  nodeId: string,
  fieldId: string,
  mappings: readonly LineageEdge[],
): string {
  const details = mappings.map(
    (edge) => `${edge.transformType ?? "unknown"}: ${edge.expression ?? "no expression"}`,
  );
  return `${nodeId}.${fieldId} — ${details.join(" | ") || "no mapped transformation"}`;
}
