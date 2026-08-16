import type { RenderNode } from "./types.js";
import { FieldRenderer } from "./field-renderer.js";
import { createSvgElement } from "./svg-dom.js";

export class NodeRenderer {
  private readonly fieldRenderer = new FieldRenderer();

  constructor(private readonly idPrefix: string) {}

  render(item: RenderNode, index: number): SVGGElement {
    const group = createSvgElement("g");
    group.setAttribute("class", "node");
    group.setAttribute("transform", `translate(${item.x} ${item.y})`);
    group.setAttribute("data-node-id", item.id);
    if (item.rank !== undefined) group.setAttribute("data-node-layer", String(item.rank));
    if (item.node.type) group.setAttribute("data-node-type", item.node.type);
    if (item.node.status) group.setAttribute("data-node-status", item.node.status);
    const rect = createSvgElement("rect");
    rect.setAttribute("class", "node-surface");
    rect.setAttribute("width", String(item.width));
    rect.setAttribute("height", String(item.height));
    rect.setAttribute("rx", "8");
    const clipId = `${this.idPrefix}-node-text-${index}`;
    const clipPath = createSvgElement("clipPath");
    clipPath.setAttribute("id", clipId);
    const clipRect = createSvgElement("rect");
    clipRect.setAttribute("x", "16");
    clipRect.setAttribute("width", String(Math.max(0, item.width - 32)));
    clipRect.setAttribute("height", String(item.height));
    clipPath.append(clipRect);
    const tooltip = createSvgElement("title");
    const fullLabel = metadataString(item.node.metadata, "fullLabel") ?? item.node.label;
    const fullSubtitle = metadataString(item.node.metadata, "fullSubtitle") ?? item.node.subtitle;
    tooltip.textContent = fullSubtitle ? `${fullLabel}\n${fullSubtitle}` : fullLabel;
    const title = createSvgElement("text");
    title.setAttribute("class", "node-title");
    title.setAttribute("x", "16");
    title.setAttribute("y", "30");
    title.setAttribute("clip-path", `url(#${clipId})`);
    title.textContent = item.node.label;
    group.append(clipPath, tooltip, rect, title);
    if (item.node.subtitle) {
      const subtitle = createSvgElement("text");
      subtitle.setAttribute("class", "node-subtitle");
      subtitle.setAttribute("x", "16");
      subtitle.setAttribute("y", "52");
      subtitle.setAttribute("clip-path", `url(#${clipId})`);
      subtitle.textContent = item.node.subtitle;
      group.append(subtitle);
    }
    this.fieldRenderer.render(group, item, `${this.idPrefix}-node-${index}`);
    return group;
  }
}

function metadataString(
  metadata: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" ? value : undefined;
}
