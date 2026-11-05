import type { LineageNode } from "../../api/lineage.ts";

export interface LineageSearchResolution {
  directMatch: LineageNode | null;
  candidates: LineageNode[];
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
    const exactTables = matches.filter(
      (node) =>
        node.kind === "table" &&
        String(node.namespace || "").trim().toLowerCase() === namespace &&
        node.name.trim().toLowerCase() === tableName,
    );
    if (exactTables.length === 1) {
      return { directMatch: exactTables[0] || null, candidates: [] };
    }
    if (exactTables.length > 1) return { directMatch: null, candidates: exactTables };
    return matches.length === 1
      ? { directMatch: matches[0] || null, candidates: [] }
      : { directMatch: null, candidates: matches };
  }

  const exactTables = matches.filter(
    (node) => node.kind === "table" && node.name.trim().toLowerCase() === normalized,
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
    nameLabel: `${isTable ? "表名" : "作业名"}：${node.name}`,
  };
}
