import type { LineageNode } from "../../api/lineage.ts";

export const UNCLASSIFIED_SCHEMA_KEY = "unclassified";
export const UNCLASSIFIED_SCHEMA_LABEL = "未分类";

export interface LineageSchemaGroup {
  key: string;
  schemaName: string | null;
  displayName: string;
  tables: LineageNode[];
}

/**
 * Resolve Schema only from explicit schema metadata on the current table node.
 * `namespace` can represent a source or processing layer, so it is never
 * promoted to Schema. Table-name prefixes are never parsed.
 */
export function resolveLineageNodeSchema(node: LineageNode): string | null {
  if (node.kind !== "table") return null;
  if (typeof node.schema === "string" && node.schema.trim()) return node.schema.trim();
  for (const key of ["schema", "schemaName", "schema_name"]) {
    const value = node.attributes?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export function buildLineageSchemaGroups(
  nodes: readonly LineageNode[],
  unclassifiedLabel = UNCLASSIFIED_SCHEMA_LABEL,
): LineageSchemaGroup[] {
  const candidates = nodes
    .filter((node) => node.kind === "table" && Boolean(node.id) && Boolean(node.name))
    .map((node) => ({ node, schemaName: resolveLineageNodeSchema(node) }))
    .sort((left, right) =>
      compareText(left.node.id, right.node.id)
      || compareText(left.schemaName || "", right.schemaName || "")
      || compareText(left.node.name, right.node.name)
      || compareText(left.node.displayName, right.node.displayName),
    );

  // Node IDs are the stable identity. Do not collapse same-name tables under
  // different schemas (or distinct IDs within one schema).
  const uniqueNodes = new Map<string, { node: LineageNode; schemaName: string | null }>();
  for (const candidate of candidates) {
    if (!uniqueNodes.has(candidate.node.id)) uniqueNodes.set(candidate.node.id, candidate);
  }

  const groups = new Map<string, LineageSchemaGroup>();
  for (const { node, schemaName } of uniqueNodes.values()) {
    const key = schemaName === null
      ? UNCLASSIFIED_SCHEMA_KEY
      : `schema:${schemaName.length}:${schemaName}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        schemaName,
        // Normalize presentation only; keep exact identity in schemaName and
        // the group key so case-sensitive schemas remain distinct.
        displayName: schemaName === null ? unclassifiedLabel : schemaName.toUpperCase(),
        tables: [],
      };
      groups.set(key, group);
    }
    group.tables.push(node);
  }

  const result = [...groups.values()];
  for (const group of result) group.tables.sort(compareNodes);
  result.sort((left, right) => {
    if (left.schemaName === null) return right.schemaName === null ? 0 : 1;
    if (right.schemaName === null) return -1;
    return compareText(left.displayName, right.displayName)
      || compareText(left.schemaName, right.schemaName);
  });
  return result;
}

export function filterLineageSchemaGroups(
  groups: readonly LineageSchemaGroup[],
  query: string,
): LineageSchemaGroup[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return [...groups];

  const filtered: LineageSchemaGroup[] = [];
  for (const group of groups) {
    const schemaMatches = [group.schemaName, group.displayName]
      .some((value) => value?.toLowerCase().includes(normalizedQuery) === true);
    const tables = schemaMatches
      ? group.tables
      : group.tables.filter((node) => node.name.toLowerCase().includes(normalizedQuery));
    if (tables.length) filtered.push({ ...group, tables });
  }
  return filtered;
}

export function toggleLineageSchemaExpansion(
  expandedKeys: ReadonlySet<string>,
  key: string,
): Set<string> {
  const next = new Set(expandedKeys);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

export function setAllLineageSchemasExpanded(
  groups: readonly LineageSchemaGroup[],
  expanded: boolean,
): Set<string> {
  return expanded ? new Set(groups.map((group) => group.key)) : new Set();
}

export function countLineageTables(groups: readonly LineageSchemaGroup[]): number {
  return groups.reduce((count, group) => count + group.tables.length, 0);
}

function compareNodes(left: LineageNode, right: LineageNode): number {
  return compareText(left.name, right.name) || compareText(left.id, right.id);
}

function compareText(left: string, right: string): number {
  const normalizedLeft = left.toLowerCase();
  const normalizedRight = right.toLowerCase();
  if (normalizedLeft < normalizedRight) return -1;
  if (normalizedLeft > normalizedRight) return 1;
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
