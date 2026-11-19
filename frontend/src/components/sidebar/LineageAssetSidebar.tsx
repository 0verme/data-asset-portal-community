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

import { describeLineageNode } from "../lineage/lineageNodePresentation.ts";
import { LineageSnapshotTime } from "../lineage/LineageSnapshotTime.tsx";

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
  const groups = React.useMemo(() => buildLineageSchemaGroups(nodes), [nodes]);
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
    ? t("persistent")
    : ["poc", "demo"].includes(snapshot?.mode || "")
      ? t("demoSource")
      : t("noSource");

  return (
    <section className="side-group lineage-asset-sidebar" aria-labelledby="lineage-asset-sidebar-title">
      <h2 id="lineage-asset-sidebar-title" className="lineage-asset-sidebar-title">
        <Icon name="layers" size={16} />
        <span>{t("sidebar.title")}</span>
      </h2>

      <Input
        aria-label={t("sidebar.searchLabel")}
        className="lineage-asset-search"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t("sidebar.searchPlaceholder")}
      />

      <div className="lineage-asset-toolbar">
        <span className="lineage-asset-count" aria-live="polite">
          {searchActive ? t("sidebar.filteredCount", { visible: visibleTableCount, total: tableCount }) : t("sidebar.tableCount", { count: tableCount })}
        </span>
        <div className="lineage-asset-actions" role="group" aria-label={t("sidebar.actions")}>
          <button
            type="button"
            onClick={() => setExpandedKeys(setAllLineageSchemasExpanded(groups, true))}
            disabled={groups.length === 0 || allExpanded}
          >
            {t("sidebar.expand")}
          </button>
          <button
            type="button"
            onClick={() => setExpandedKeys(setAllLineageSchemasExpanded(groups, false))}
            disabled={groups.length === 0 || allCollapsed}
          >
            {t("sidebar.collapse")}
          </button>
        </div>
      </div>

      {groups.length === 0 ? (
        <p className="lineage-asset-empty" role="status">{t("sidebar.noTables")}</p>
      ) : visibleGroups.length === 0 ? (
        <p className="lineage-asset-empty" role="status">{t("sidebar.noMatch")}</p>
      ) : (
        <ul className="lineage-schema-list" aria-label={t("sidebar.list")}>
          {visibleGroups.map((group) => {
            const groupLabel = group.schemaName ? group.displayName : t("sidebar.unclassified");
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
                  title={group.schemaName || groupLabel}
                  onClick={() => setExpandedKeys((current) => toggleLineageSchemaExpansion(current, group.key))}
                >
                  <Icon name="chevron" size={13} />
                  <span className="lineage-schema-label">{groupLabel}</span>
                  <span className="lineage-schema-count">{group.tables.length}</span>
                </button>
                <ul
                  id={groupListItemId}
                  className="lineage-table-list"
                  hidden={!tablesVisible}
                  aria-label={t("sidebar.groupList", { schema: groupLabel })}
                >
                  {group.tables.map((node) => {
                    const label = describeLineageNode(node);
                    return (
                      <li key={node.id}>
                        <button
                          type="button"
                          className="lineage-table-item side-item"
                          title={label.title}
                          aria-label={t("sidebar.tableLabel", { name: label.tableName, schema: groupLabel, id: node.id })}
                          aria-pressed={selectedNodeId === node.id}
                          onClick={() => onSelectNode(node.id)}
                        >
                          <span className="lineage-table-label">{label.tableName}</span>
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
        <summary>{t("sidebar.snapshotInfo")}</summary>
        <p className="lineage-snapshot-source">{snapshotSource}</p>
        <dl>
          <dt>{t("sidebar.snapshotId")}</dt><dd title={snapshot?.snapshotId || undefined}>{snapshot?.snapshotId || "—"}</dd>
          <dt>{t("sidebar.snapshotName")}</dt><dd>{snapshot?.snapshotName || "—"}</dd>
          <dt>{t("sidebar.snapshotAt")}</dt><dd><LineageSnapshotTime value={snapshot?.snapshotAt} /></dd>
          <dt>{t("sidebar.nodeCount")}</dt><dd>{snapshot?.nodeCount ?? "—"}</dd>
          <dt>{t("sidebar.edgeCount")}</dt><dd>{snapshot?.edgeCount ?? "—"}</dd>
        </dl>
      </details>
    </section>
  );
}
