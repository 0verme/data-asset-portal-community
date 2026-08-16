import "../../src/define.js";
import type { LineageViewerElement, LineageViewMode } from "../../src/index.js";

const viewer = document.querySelector("lineage-viewer") as LineageViewerElement;
const view = document.querySelector<HTMLSelectElement>('[data-action="view"]');
const query = document.querySelector<HTMLInputElement>('[data-action="query"]');
const dataType = document.querySelector<HTMLSelectElement>('[data-action="type"]');
const status = document.querySelector<HTMLElement>(".status");

viewer.options = { viewMode: "mixed", highlightMode: "both" };
viewer.data = {
  nodes: [
    {
      id: "ods_orders",
      label: "ODS_ORDERS",
      subtitle: "Source table",
      fields: [
        { id: "order_id", dataType: "bigint" },
        { id: "ordered_at", dataType: "timestamp" },
        { id: "amount", dataType: "decimal(18,2)" },
      ],
    },
    {
      id: "dwd_orders",
      label: "DWD_ORDERS",
      subtitle: "Detail model",
      fields: [
        { id: "order_key", dataType: "bigint" },
        { id: "ordered_at", dataType: "timestamp" },
        { id: "net_amount", dataType: "decimal(18,2)" },
      ],
    },
    {
      id: "dws_sales",
      label: "DWS_SALES",
      subtitle: "Aggregate model",
      fields: [{ id: "gross_sales", dataType: "decimal(18,2)" }],
    },
    { id: "quality_job", label: "ORDER_QUALITY_CHECK", type: "job" },
  ],
  edges: [
    { source: "ods_orders", target: "dwd_orders", label: "table dependency" },
    { source: "dwd_orders", target: "quality_job", type: "dependency" },
    {
      source: "ods_orders",
      target: "dwd_orders",
      sourceField: "order_id",
      targetField: "order_key",
      transformType: "rename",
    },
    {
      source: "ods_orders",
      target: "dwd_orders",
      sourceField: "ordered_at",
      targetField: "ordered_at",
      transformType: "passthrough",
    },
    {
      source: "ods_orders",
      target: "dwd_orders",
      sourceField: "amount",
      targetField: "net_amount",
      transformType: "transform",
      expression: "amount - discount",
    },
    {
      source: "dwd_orders",
      target: "dws_sales",
      sourceField: "net_amount",
      targetField: "gross_sales",
      transformType: "aggregate",
      expression: "SUM(net_amount)",
    },
  ],
};

view?.addEventListener("change", () => {
  const value = view.value;
  if (isViewMode(value)) viewer.options = { viewMode: value };
  updateStatus();
});
query?.addEventListener("input", applySearch);
dataType?.addEventListener("change", applySearch);
document
  .querySelector<HTMLButtonElement>('[data-action="clear"]')
  ?.addEventListener("click", () => {
    if (query) query.value = "";
    if (dataType) dataType.value = "";
    viewer.clearSearch();
    updateStatus();
  });

function applySearch(): void {
  viewer.search(query?.value ?? "", { dataType: dataType?.value ?? "" });
  updateStatus();
}

function updateStatus(): void {
  if (!status) return;
  const mode = viewer.options.viewMode;
  const count = viewer.searchResults.length;
  status.textContent = `${mode} view · ${count === 0 ? "no active matches" : `${count} matches`}`;
}

function isViewMode(value: string): value is LineageViewMode {
  return value === "table" || value === "column" || value === "mixed";
}
