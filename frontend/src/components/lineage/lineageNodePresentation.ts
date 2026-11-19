import type { LineageNode } from "../../api/lineage.ts";
import { resolveLineageNodeSchema } from "./lineageAssetNavigation.ts";

type NodeLabelMetadata = Pick<LineageNode, "kind" | "name" | "schema"> & {
  attributes?: LineageNode["attributes"] | undefined;
  namespace?: string | undefined;
  displayName?: string | undefined;
};

export function describeLineageNode(node: NodeLabelMetadata) {
  const name = node.name.trim();
  const schema = resolveLineageNodeSchema(node);
  const tableName = schema && name.toLowerCase().startsWith(`${schema.toLowerCase()}.`)
    ? name.slice(schema.length + 1)
    : name;
  const title = schema && !name.includes(".") ? `${schema}.${name}` : name;
  const displayName = node.displayName?.trim();
  const subtitle = displayName && ![name, title, tableName].includes(displayName)
    ? displayName
    : undefined;
  const namespace = node.namespace?.trim();
  const showNamespace = namespace && !title.toLowerCase().startsWith(`${namespace.toLowerCase()}.`);

  return { title, subtitle, tableName, namespace: showNamespace ? namespace : undefined };
}

export function lineageNodeKindKey(kind: string) {
  switch (kind) {
    case "table": return "kind.table";
    case "task": return "kind.task";
    case "push_job": return "kind.pushJob";
    case "indicator": return "kind.indicator";
    case "report": return "kind.report";
    default: return "kind.other";
  }
}
