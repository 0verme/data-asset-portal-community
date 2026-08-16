import { LineageViewerElement } from "./element/index.js";

export function defineLineageViewer(): typeof LineageViewerElement {
  if (typeof customElements !== "undefined" && !customElements.get("lineage-viewer")) {
    customElements.define("lineage-viewer", LineageViewerElement);
  }
  return LineageViewerElement;
}
