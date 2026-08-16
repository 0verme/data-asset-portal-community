import "../../src/define.js";
import type { LineageViewerElement } from "../../src/index.js";

const viewer = document.querySelector("lineage-viewer") as LineageViewerElement;
const status = document.querySelector<HTMLElement>(".status");

viewer.options = { viewMode: "column", highlightMode: "both" };
viewer.data = {
  nodes: [
    {
      id: "raw_orders",
      label: "RAW_ORDERS",
      subtitle: "Source",
      fields: [
        { id: "order_id", dataType: "bigint" },
        { id: "customer_id", dataType: "bigint" },
        { id: "created_at", dataType: "timestamp" },
      ],
    },
    {
      id: "stg_orders",
      label: "STG_ORDERS",
      subtitle: "Staging",
      fields: [
        { id: "order_id", dataType: "bigint" },
        { id: "customer_id", dataType: "bigint" },
        { id: "created_at", dataType: "timestamp" },
      ],
    },
    {
      id: "fct_orders",
      label: "FCT_ORDERS",
      subtitle: "Warehouse",
      fields: [
        { id: "order_key", dataType: "bigint" },
        { id: "customer_key", dataType: "bigint" },
        { id: "ordered_at", dataType: "timestamp" },
      ],
    },
  ],
  edges: [
    {
      source: "raw_orders",
      target: "stg_orders",
      sourceField: "order_id",
      targetField: "order_id",
    },
    {
      source: "raw_orders",
      target: "stg_orders",
      sourceField: "customer_id",
      targetField: "customer_id",
    },
    {
      source: "raw_orders",
      target: "stg_orders",
      sourceField: "created_at",
      targetField: "created_at",
    },
    {
      source: "stg_orders",
      target: "fct_orders",
      sourceField: "order_id",
      targetField: "order_key",
      transformType: "rename",
    },
    {
      source: "stg_orders",
      target: "fct_orders",
      sourceField: "customer_id",
      targetField: "customer_key",
      transformType: "rename",
    },
    {
      source: "stg_orders",
      target: "fct_orders",
      sourceField: "created_at",
      targetField: "ordered_at",
      transformType: "rename",
    },
  ],
};

viewer.addEventListener("lineage-field-click", (event) => {
  const detail = (event as CustomEvent<{ nodeId: string; fieldId: string }>).detail;
  if (status) status.textContent = `Selected ${detail.nodeId}.${detail.fieldId}`;
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
