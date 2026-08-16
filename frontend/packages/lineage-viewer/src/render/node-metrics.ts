import type { NormalizedLineageNode } from "../graph/types.js";

const titleOnlyHeaderHeight = 48;
const subtitleHeaderHeight = 68;
export const fieldRowHeight = 28;

export function measureNodeHeight(node: NormalizedLineageNode, minimumHeight: number): number {
  if (!hasVisibleFields(node)) return minimumHeight;
  return Math.max(minimumHeight, nodeHeaderHeight(node) + node.fields.length * fieldRowHeight);
}

export function fieldRowCenter(node: NormalizedLineageNode, fieldId: string): number | null {
  const index = node.fields?.findIndex((field) => field.id === fieldId) ?? -1;
  return index < 0 ? null : nodeHeaderHeight(node) + index * fieldRowHeight + fieldRowHeight / 2;
}

export function nodeHeaderHeight(node: NormalizedLineageNode): number {
  return node.subtitle === undefined ? titleOnlyHeaderHeight : subtitleHeaderHeight;
}

function hasVisibleFields(node: NormalizedLineageNode): node is NormalizedLineageNode & {
  fields: NonNullable<NormalizedLineageNode["fields"]>;
} {
  return node.fields !== undefined && node.fields.length > 0;
}
