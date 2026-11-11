import React from "react";

import type { LineageBootstrap, LineageNode } from "../../api/lineage.ts";
import { Icon } from "../ui.tsx";
import { Input } from "../../ui/index.ts";
import {
  buildLineageSchemaGroups,
  countLineageTables,
  filterLineageSchemaGroups,
  setAllLineageSchemasExpanded,
  toggleLineageSchemaExpansion,
  UNCLASSIFIED_SCHEMA_LABEL,
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
    ? "持久化血缘快照"
    : ["poc", "demo"].includes(snapshot?.mode || "")
      ? "演示血缘数据（非数据库真实血缘）"
      : "血缘数据源尚未配置";

  return (
    <section className="side-group lineage-asset-sidebar" aria-labelledby="lineage-asset-sidebar-title">
      <h2 id="lineage-asset-sidebar-title" className="lineage-asset-sidebar-title">
        <Icon name="layers" size={16} />
        <span>血缘资产导航</span>
      </h2>

      <Input
        aria-label="Schema 名和表名搜索"
        className="lineage-asset-search"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="搜索 Schema 或表名"
      />

      <div className="lineage-asset-toolbar">
        <span className="lineage-asset-count" aria-live="polite">
          {searchActive ? `${visibleTableCount} / ${tableCount} 张表` : `${tableCount} 张表`}
        </span>
        <div className="lineage-asset-actions" role="group" aria-label="Schema 展开操作">
          <button
            type="button"
            onClick={() => setExpandedKeys(setAllLineageSchemasExpanded(groups, true))}
            disabled={groups.length === 0 || allExpanded}
          >
            全部展开
          </button>
          <button
            type="button"
            onClick={() => setExpandedKeys(setAllLineageSchemasExpanded(groups, false))}
            disabled={groups.length === 0 || allCollapsed}
          >
            全部折叠
          </button>
        </div>
      </div>

      {groups.length === 0 ? (
        <p className="lineage-asset-empty" role="status">当前血缘查询结果暂无表节点。</p>
      ) : visibleGroups.length === 0 ? (
        <p className="lineage-asset-empty" role="status">没有匹配的 Schema 或表名。</p>
      ) : (
        <ul className="lineage-schema-list" aria-label="当前血缘查询结果中的表节点">
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
                  title={group.schemaName || UNCLASSIFIED_SCHEMA_LABEL}
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
                  aria-label={`${group.displayName} 表列表`}
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
                          aria-label={`${node.name}，${group.displayName}，节点 ID ${node.id}`}
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
        <summary>快照信息</summary>
        <p className="lineage-snapshot-source">{snapshotSource}</p>
        <dl>
          <dt>快照标识</dt><dd title={snapshot?.snapshotId || undefined}>{snapshot?.snapshotId || "—"}</dd>
          <dt>快照名称</dt><dd>{snapshot?.snapshotName || "—"}</dd>
          <dt>更新时间</dt><dd>{snapshot?.snapshotAt || "—"}</dd>
          <dt>节点数量</dt><dd>{snapshot?.nodeCount ?? "—"}</dd>
          <dt>关系数量</dt><dd>{snapshot?.edgeCount ?? "—"}</dd>
        </dl>
      </details>
    </section>
  );
}
