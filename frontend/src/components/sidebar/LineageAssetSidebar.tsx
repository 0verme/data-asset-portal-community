import React from "react";
import { useTranslation } from "react-i18next";

import type { LineageBootstrap, LineageNode } from "../../api/lineage.ts";
import { Icon } from "../ui.tsx";
import { Input } from "../../ui/index.ts";
import {
  buildLineageSchemaGroups,
  countLineageTables,
  filterLineageSchemaGroups,
  setAllLineageSchemasExpanded,
  toggleLineageSchemaExpansion,
} from "../lineage/lineageAssetNavigation.ts";

export interface LineageAssetSidebarProps {
  nodes: readonly LineageNode[];
  selectedNodeId: string | null;
  selectionSequence: number;
  snapshot: LineageBootstrap | null;
  onSelectNode: (nodeId: string) => void;
}

export function LineageAssetSidebar({
  nodes,
  selectedNodeId,
  selectionSequence,
  snapshot,
  onSelectNode,
}: LineageAssetSidebarProps) {
  const { t } = useTranslation("lineage");
  const [query, setQuery] = React.useState("");
  const [expandedKeys, setExpandedKeys] = React.useState<Set<string>>(() => new Set());
  const groupListId = React.useId();
  const groups = React.useMemo(
    () => buildLineageSchemaGroups(nodes, t("assetNavigation.unclassified")),
    [nodes, t],
  );
  const visibleGroups = React.useMemo(
    () => filterLineageSchemaGroups(groups, query),
    [groups, query],
  );
  const searchActive = query.trim().length > 0;
  const selectedGroupKey = selectedNodeId
    ? groups.find((group) => group.tables.some((node) => node.id === selectedNodeId))?.key
    : undefined;
  const tableCount = countLineageTables(groups);
  const visibleTableCount = countLineageTables(visibleGroups);
  const allExpanded = groups.length > 0 && groups.every((group) => expandedKeys.has(group.key));
  const allCollapsed = groups.every((group) => !expandedKeys.has(group.key));

  React.useEffect(() => {
    setExpandedKeys((current) => {
      const availableKeys = new Set(groups.map((group) => group.key));
      const next = new Set([...current].filter((key) => availableKeys.has(key)));
      if (selectedGroupKey) next.add(selectedGroupKey);
      return next;
    });
  }, [groups, selectedGroupKey, selectedNodeId, selectionSequence]);

  const snapshotSource = snapshot?.mode === "persistent"
    ? t("assetNavigation.snapshotSource.persistent")
    : ["poc", "demo"].includes(snapshot?.mode || "")
      ? t("assetNavigation.snapshotSource.demo")
      : t("assetNavigation.snapshotSource.notConfigured");

  return (
    <section className="side-group lineage-asset-sidebar" aria-labelledby="lineage-asset-sidebar-title">
      <h2 id="lineage-asset-sidebar-title" className="lineage-asset-sidebar-title">
        <Icon name="layers" size={16} />
        <span>{t("assetNavigation.title")}</span>
      </h2>

      <Input
        aria-label={t("assetNavigation.searchLabel")}
        className="lineage-asset-search"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t("assetNavigation.searchPlaceholder")}
      />

      <div className="lineage-asset-toolbar">
        <span className="lineage-asset-count" aria-live="polite">
          {searchActive
            ? t(tableCount === 1 ? "assetNavigation.tableCountFilteredSingular" : "assetNavigation.tableCountFiltered", { visible: visibleTableCount, total: tableCount })
            : tableCount === 1
              ? t("assetNavigation.tableCountSingular")
              : t("assetNavigation.tableCount", { total: tableCount })}
        </span>
        <div className="lineage-asset-actions" role="group" aria-label={t("assetNavigation.expansionActions")}>
          <button
            type="button"
            onClick={() => setExpandedKeys(setAllLineageSchemasExpanded(groups, true))}
            disabled={groups.length === 0 || allExpanded}
          >
            {t("assetNavigation.expandAll")}
          </button>
          <button
            type="button"
            onClick={() => setExpandedKeys(setAllLineageSchemasExpanded(groups, false))}
            disabled={groups.length === 0 || allCollapsed}
          >
            {t("assetNavigation.collapseAll")}
          </button>
        </div>
      </div>

      {groups.length === 0 ? (
        <p className="lineage-asset-empty" role="status">{t("assetNavigation.noTableNodes")}</p>
      ) : visibleGroups.length === 0 ? (
        <p className="lineage-asset-empty" role="status">{t("assetNavigation.noMatches")}</p>
      ) : (
        <ul className="lineage-schema-list" aria-label={t("assetNavigation.currentTableNodes")}>
          {visibleGroups.map((group) => {
            const originalGroupIndex = groups.findIndex((candidate) => candidate.key === group.key);
            const tablesVisible = searchActive || expandedKeys.has(group.key);
            const groupListItemId = `${groupListId}-schema-${originalGroupIndex}`;
            return (
              <li className="lineage-schema-group" key={group.key}>
                <button
                  type="button"
                  className="lineage-schema-heading"
                  aria-expanded={tablesVisible}
                  aria-controls={groupListItemId}
                  title={group.schemaName || t("assetNavigation.unclassified")}
                  onClick={() => setExpandedKeys((current) => toggleLineageSchemaExpansion(current, group.key))}
                >
                  <Icon name="chevron" size={13} />
                  <span className="lineage-schema-label">{group.displayName}</span>
                  <span className="lineage-schema-count">{group.tables.length}</span>
                </button>
                <ul
                  id={groupListItemId}
                  className="lineage-table-list"
                  hidden={!tablesVisible}
                  aria-label={t("assetNavigation.tablesInSchema", { schema: group.displayName })}
                >
                  {group.tables.map((node) => {
                    const qualifiedName = group.schemaName
                      ? `${group.schemaName}.${node.name}`
                      : node.name;
                    return (
                      <li key={node.id}>
                        <button
                          type="button"
                          className="lineage-table-item side-item"
                          title={qualifiedName}
                          aria-label={t("assetNavigation.tableNodeLabel", { table: node.name, schema: group.displayName, id: node.id })}
                          aria-pressed={selectedNodeId === node.id}
                          onClick={() => onSelectNode(node.id)}
                        >
                          <span className="lineage-table-label">{node.name}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ul>
      )}

      <details className="lineage-snapshot-info">
        <summary>{t("assetNavigation.snapshotInfo")}</summary>
        <p className="lineage-snapshot-source">{snapshotSource}</p>
        <dl>
          <dt>{t("assetNavigation.snapshotId")}</dt><dd title={snapshot?.snapshotId || undefined}>{snapshot?.snapshotId || "—"}</dd>
          <dt>{t("assetNavigation.snapshotName")}</dt><dd>{snapshot?.snapshotName || "—"}</dd>
          <dt>{t("assetNavigation.updatedAt")}</dt><dd>{snapshot?.snapshotAt || "—"}</dd>
          <dt>{t("assetNavigation.nodeCount")}</dt><dd>{snapshot?.nodeCount ?? "—"}</dd>
          <dt>{t("assetNavigation.edgeCount")}</dt><dd>{snapshot?.edgeCount ?? "—"}</dd>
        </dl>
      </details>
    </section>
  );
}
