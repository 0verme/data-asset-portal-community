import type { LineageNode } from "../../api/lineage.ts";

export interface LineageSearchResolution {
  directMatch: LineageNode | null;
  candidates: LineageNode[];
}

function terminalTableName(value: string): string {
  const normalized = value.trim();
  return normalized.slice(normalized.lastIndexOf(".") + 1);
}

function matchesUnqualifiedTableName(node: LineageNode, tableName: string): boolean {
  const normalizedName = node.name.trim().toLowerCase();
  return normalizedName === tableName || terminalTableName(normalizedName) === tableName;
}

/** Prefer a unique exact table even when the server also returned fuzzy jobs. */
export function resolveLineageSearchMatches(
  query: string,
  matches: LineageNode[],
): LineageSearchResolution {
  const normalized = query.trim().toLowerCase();
  const separator = normalized.indexOf(".");
  const qualified = separator >= 0;
  const namespace = qualified ? normalized.slice(0, separator).trim() : "";
  const tableName = qualified ? normalized.slice(separator + 1).trim() : normalized;

  if (qualified && namespace && tableName) {
    const exactTables = matches.filter((node) => {
      if (node.kind !== "table") return false;
      const nodeNamespace = String(node.namespace || "").trim().toLowerCase();
      const nodeName = node.name.trim().toLowerCase();
      return nodeNamespace === namespace &&
        (nodeName === tableName || nodeName === `${namespace}.${tableName}`);
    });
    if (exactTables.length === 1) {
      return { directMatch: exactTables[0] || null, candidates: [] };
    }
    if (exactTables.length > 1) return { directMatch: null, candidates: exactTables };
    return matches.length === 1
      ? { directMatch: matches[0] || null, candidates: [] }
      : { directMatch: null, candidates: matches };
  }

  const exactTables = matches.filter(
    (node) => node.kind === "table" && matchesUnqualifiedTableName(node, normalized),
  );
  if (exactTables.length) {
    return exactTables.length === 1
      ? { directMatch: exactTables[0] || null, candidates: [] }
      : { directMatch: null, candidates: exactTables };
  }

  const exactTasks = matches.filter(
    (node) => node.kind === "task" && node.name.trim().toLowerCase() === normalized,
  );
  if (exactTasks.length) {
    return exactTasks.length === 1
      ? { directMatch: exactTasks[0] || null, candidates: [] }
      : { directMatch: null, candidates: exactTasks };
  }

  return matches.length === 1
    ? { directMatch: matches[0] || null, candidates: [] }
    : { directMatch: null, candidates: matches };
}

export function lineageSearchQueryForCandidate(node: LineageNode): string {
  if (node.kind !== "table") return node.name;
  const tableName = terminalTableName(node.name);
  const namespace = String(node.namespace || "").trim();
  return namespace ? `${namespace}.${tableName}` : tableName;
}

export function describeLineageSearchCandidate(node: LineageNode): {
  kindLabel: string;
  namespaceLabel: string;
  nameLabel: string;
} {
  const isTable = node.kind === "table";
  const namespace = String(node.namespace || "").trim() || "未提供";
  return {
    kindLabel: isTable ? "表节点" : "作业节点",
    namespaceLabel: `${isTable ? "业务 Schema / namespace_name" : "命名空间"}：${namespace}`,
    nameLabel: `${isTable ? "表名" : "作业名"}：${isTable ? terminalTableName(node.name) : node.name}`,
  };
}
