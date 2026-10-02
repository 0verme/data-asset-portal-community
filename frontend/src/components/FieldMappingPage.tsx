// Copyright 2025 Jearhe
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type Dispatch, type SetStateAction } from "react";

import {
  FIELD_MAPPING_DEFAULT_PAGE_SIZE,
  FIELD_MAPPING_PAGE_SIZE_OPTIONS,
  getFieldMappingSourceSystems,
  getFieldMappingStats,
  getFieldMappings,
  exportFieldMappingCsv,
  getFieldMappingTables,
  fieldMappingTableIdentityKey,
  type EnrichedFieldMappingRow,
  type FieldMappingQueryParams,
  type FieldMappingSourceSystemOption,
  type FieldMappingStats as FieldMappingStatsData,
  type FieldMappingTableSummary,
} from "../api/fieldMapping.ts";
import { DEFAULT_MAPPING_ROUTE } from "../config/defaults.ts";
import type { MappingRoute } from "../routing/types.ts";
import { ActionErrorBanner, EmptyState } from "./common/index.ts";
import { FieldMappingFilters, FieldMappingStats } from "./fieldMapping/FieldMappingControls.tsx";
import {
  FieldMappingWideTable,
  type HeaderMeasurement,
} from "./fieldMapping/FieldMappingWideTable.tsx";
import {
  DEFAULT_FILTERS,
  DIMENSION_TABS,
  LOAD_MODE_META,
  RULE_TAGS,
  areFieldMappingFiltersEqual,
  buildFieldMappingRequestFilters,
  buildLinkedFilters,
  compareValues,
  downloadCsv,
  downloadCsvContent,
  isLinkedRoute,
  formatSystemLabel,
  getRouteSourceSystemId,
  isTransformRule,
  resolveSourceSystemLabel,
  sortMarker,
  type FieldMappingFilters as FieldMappingFilterState,
  type FieldMappingSort,
} from "./fieldMapping/fieldMappingUtils.ts";
import { Icon } from "./ui.tsx";

type MappingTab = "table" | "field";

type MappingRow = EnrichedFieldMappingRow | FieldMappingTableSummary;
type MappingCellValue = string | number | null | undefined;

interface MappingColumn {
  key: string;
  label: string;
  align?: "right" | undefined;
  sortable?: boolean | undefined;
  width?: number | undefined;
}

interface DimensionTab {
  key: MappingTab;
  label: string;
}

interface MappingTableHeaderProps {
  tab: MappingTab;
  sourceColumns: readonly MappingColumn[];
  targetColumns: readonly MappingColumn[];
  orderedTableColumns: readonly MappingColumn[];
  sort: FieldMappingSort;
  onSort: (key: string) => void;
}

function MappingTableHeader({
  tab,
  sourceColumns,
  targetColumns,
  orderedTableColumns,
  sort,
  onSort,
}: MappingTableHeaderProps) {
  return (
    <thead>
      {tab === "field" ? (
        <tr className="fm-group-head">
          <th colSpan={sourceColumns.length} className="fm-group-source">源系统侧 / SOURCE</th>
          <th rowSpan={2} className="fm-arrow-col" aria-label="映射方向"></th>
          <th colSpan={targetColumns.length} className="fm-group-target">数据仓库 DWF 侧 / TARGET</th>
        </tr>
      ) : null}
      <tr>
        {tab === "field" ? (
          <>
            {sourceColumns.map((column) => (
              <th key={column.key} onClick={() => onSort(column.key)}>
                <span>{column.label}{sortMarker(sort, column.key)}</span>
              </th>
            ))}
            {targetColumns.map((column) => (
              <th key={column.key} onClick={() => onSort(column.key)}>
                <span>{column.label}{sortMarker(sort, column.key)}</span>
              </th>
            ))}
          </>
        ) : orderedTableColumns.map((column) => (
          <th
            key={column.key}
            className={column.align === "right" ? "is-right" : ""}
            onClick={column.sortable === false ? undefined : () => onSort(column.key)}
          >
            <span>{column.label}{column.sortable === false ? "" : sortMarker(sort, column.key)}</span>
          </th>
        ))}
      </tr>
    </thead>
  );
}

function MappingCellText({ value, className = "" }: { value: string; className?: string }) {
  return (
    <span className={`fm-cell-ellipsis ${className}`.trim()} title={value}>
      {value}
    </span>
  );
}

const dimensionTabs = DIMENSION_TABS as readonly DimensionTab[];

function readMappingValue(row: MappingRow, key: string): MappingCellValue {
  if (!Object.prototype.hasOwnProperty.call(row, key)) return undefined;
  // SAFETY: dynamic keys are restricted to MappingColumn values, and both row contracts expose string/number cells.
  return (row as unknown as Record<string, MappingCellValue>)[key];
}

function sortMappingRows<T extends MappingRow>(rows: readonly T[], sort: FieldMappingSort): T[] {
  const nextRows = [...rows];
  if (!sort.key) return nextRows;
  nextRows.sort((left, right) => {
    const result = compareValues(readMappingValue(left, sort.key), readMappingValue(right, sort.key));
    return sort.direction === "asc" ? result : -result;
  });
  return nextRows;
}

export interface FieldMappingPageProps {
  keyword: string;
  route?: MappingRoute | undefined;
  setRoute: Dispatch<SetStateAction<MappingRoute>>;
  onBackToUpstream: () => void;
  canExport: boolean;
}

export function FieldMappingPage({
  keyword,
  route = DEFAULT_MAPPING_ROUTE,
  setRoute,
  onBackToUpstream,
  canExport,
}: FieldMappingPageProps) {
  const initialFilters = isLinkedRoute(route)
    ? buildLinkedFilters(route, "")
    : DEFAULT_FILTERS;
  const [filterOpen, setFilterOpen] = useState(true);
  const [draftFilters, setDraftFilters] = useState<FieldMappingFilterState>(initialFilters);
  const [filters, setFilters] = useState<FieldMappingFilterState>(initialFilters);
  const [tab, setTab] = useState<MappingTab>(route.tab === "field" ? "field" : "table");
  const [pageSize, setPageSize] = useState(FIELD_MAPPING_DEFAULT_PAGE_SIZE);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<FieldMappingSort>({ key: "", direction: "asc" });
  const [sourceSystems, setSourceSystems] = useState<FieldMappingSourceSystemOption[]>([]);
  const [stats, setStats] = useState<FieldMappingStatsData | null>(null);
  const [fieldRows, setFieldRows] = useState<EnrichedFieldMappingRow[]>([]);
  const [fieldTotal, setFieldTotal] = useState(0);
  const [tableRows, setTableRows] = useState<FieldMappingTableSummary[]>([]);
  const [tableTotal, setTableTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [exportError, setExportError] = useState("");
  const previousKeywordRef = useRef(keyword);
  const requestPage = previousKeywordRef.current === keyword ? page : 1;
  const requestFilters = useMemo(
    () => buildFieldMappingRequestFilters(filters, route),
    [filters, route],
  );

  useEffect(() => {
    let cancelled = false;

    async function loadOptions(): Promise<void> {
      try {
        const mappingSystems = await getFieldMappingSourceSystems();
        if (cancelled) return;
        setSourceSystems(mappingSystems);
      } catch {
        if (cancelled) return;
        setSourceSystems([]);
      }
    }

    void loadOptions();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const nextTab: MappingTab = route.tab === "field" ? "field" : "table";
    const linkedSourceSystem = resolveSourceSystemLabel(route, sourceSystems);
    const nextFilters = isLinkedRoute(route)
      ? buildLinkedFilters(route, linkedSourceSystem)
      : DEFAULT_FILTERS;
    setTab((current) => (current === nextTab ? current : nextTab));
    setDraftFilters((current) => (
      areFieldMappingFiltersEqual(current, nextFilters) ? current : nextFilters
    ));
    setFilters((current) => (
      areFieldMappingFiltersEqual(current, nextFilters) ? current : nextFilters
    ));
    setPage(1);
  }, [route, sourceSystems]);

  useEffect(() => {
    let cancelled = false;

    async function loadData(): Promise<void> {
      setLoading(true);
      setError("");
      try {
        const baseParams: FieldMappingQueryParams = {
          ...requestFilters,
          sourceSystemId: requestFilters.sourceSystemId || "",
          keyword: keyword || "",
        };

        if (tab === "field") {
          const [nextStats, nextRows] = await Promise.all([
            getFieldMappingStats(baseParams),
            getFieldMappings({
              ...baseParams,
              page: requestPage,
              pageSize,
              ...(sort.key ? { sortKey: sort.key, sortDirection: sort.direction } : {}),
            }),
          ]);
          if (cancelled) return;
          setStats(nextStats);
          setFieldRows(nextRows.items);
          setFieldTotal(nextRows.total);
        } else {
          const [nextStats, nextRows] = await Promise.all([
            getFieldMappingStats(baseParams),
            getFieldMappingTables({
              ...baseParams,
              page: requestPage,
              pageSize,
            }),
          ]);
          if (cancelled) return;
          setStats(nextStats);
          setTableRows(nextRows.items);
          setTableTotal(nextRows.total);
        }
      } catch (loadError: unknown) {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : "字段映射数据加载失败");
        setStats(null);
        setFieldRows([]);
        setFieldTotal(0);
        setTableRows([]);
        setTableTotal(0);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadData();
    return () => {
      cancelled = true;
    };
  }, [
    requestFilters.emptyComment,
    requestFilters.srcField,
    requestFilters.sourceSystemId,
    requestFilters.tablePk,
    requestFilters.srcTable,
    requestFilters.targetField,
    requestFilters.targetTable,
    keyword,
    pageSize,
    requestPage,
    sort.direction,
    sort.key,
    tab,
    requestFilters,
  ]);

  useEffect(() => {
    previousKeywordRef.current = keyword;
    setPage(1);
  }, [keyword]);

  const dimensionTabCounts: Record<MappingTab, number | string> = {
    table: stats?.sourceTableCount ?? "-",
    field: stats?.fieldCount ?? "-",
  };
  const linkedView = isLinkedRoute(route);
  const currentSourceLabel = resolveSourceSystemLabel(route, sourceSystems);

  const sortedFieldRows = useMemo(
    () => sortMappingRows(fieldRows, sort),
    [fieldRows, sort],
  );
  const sortedTableRows = useMemo(
    () => sortMappingRows(tableRows, sort),
    [sort, tableRows],
  );

  const totalRows = tab === "field" ? fieldTotal : tableTotal;
  const pageCount = Math.max(1, Math.ceil(totalRows / pageSize));
  const currentPage = Math.min(page, pageCount);
  const fieldPageRows = tab === "field" ? sortedFieldRows : [];
  const tablePageRows = tab === "table" ? sortedTableRows : [];

  const sourceColumns: MappingColumn[] = [
    { key: "srcSystem", label: "源系统", width: 260 },
    { key: "srcTable", label: "源系统表", width: 240 },
    { key: "srcField", label: "源字段", width: 180 },
    { key: "srcType", label: "字段类型", width: 120 },
    { key: "srcComment", label: "字段注释", width: 280 },
  ];
  const targetColumns: MappingColumn[] = [
    { key: "targetLayer", label: "目标层", width: 90 },
    { key: "targetTable", label: "目标表名", width: 280 },
    { key: "loadMode", label: "入仓方式", width: 110 },
    { key: "targetField", label: "目标字段", width: 180 },
    { key: "mappingRule", label: "映射规则", width: 180 },
  ];
  const fieldColumns = [...sourceColumns, ...targetColumns];
  const fieldLayoutColumns: MappingColumn[] = [
    ...sourceColumns,
    { key: "__arrow", label: "", sortable: false, width: 48 },
    ...targetColumns,
  ];
  const tableColumns: MappingColumn[] = [
    { key: "srcSystem", label: "源系统", width: 260 },
    { key: "srcTable", label: "源系统表", width: 240 },
    { key: "srcTableCn", label: "表中文名", width: 220 },
    { key: "targetLayer", label: "目标层", width: 90 },
    { key: "targetTable", label: "目标表名", width: 280 },
    { key: "mappedCount", label: "已映射", align: "right", width: 100 },
    { key: "loadMode", label: "入仓方式", width: 110 },
    { key: "emptyCommentRate", label: "空注释率", align: "right", width: 140 },
    { key: "__actions", label: "操作", align: "right", sortable: false, width: 150 },
  ];
  const orderedTableColumns = [
    "srcSystem",
    "srcTable",
    "srcTableCn",
    "targetLayer",
    "targetTable",
    "loadMode",
    "__actions",
    "mappedCount",
    "emptyCommentRate",
  ].map((key) => tableColumns.find((column) => column.key === key))
    .filter((column): column is MappingColumn => Boolean(column));

  const setDraftValue = (key: keyof FieldMappingFilterState) => (
    event: ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => {
    const value = event.target.value;
    setDraftFilters((current) => ({ ...current, [key]: value }));
  };

  const toggleSort = (key: string) => {
    setPage(1);
    setSort((current) => {
      if (current.key !== key) return { key, direction: "asc" };
      if (current.direction === "asc") return { key, direction: "desc" };
      return { key: "", direction: "desc" };
    });
  };

  const handleTabChange = (nextTab: MappingTab) => {
    setPage(1);
    setTab(nextTab);
    setRoute((current) => ({ ...current, tab: nextTab }));
  };

  const handleResetFilters = () => {
    const nextFilters = DEFAULT_FILTERS;
    setDraftFilters(nextFilters);
    setFilters(nextFilters);
    setPageSize(FIELD_MAPPING_DEFAULT_PAGE_SIZE);
    setPage(1);
    if (linkedView) {
      setRoute((current) => ({ ...DEFAULT_MAPPING_ROUTE, tab: current.tab || tab }));
    }
  };

  const handleClearLinkedFilters = () => {
    const nextFilters = DEFAULT_FILTERS;
    setDraftFilters(nextFilters);
    setFilters(nextFilters);
    setPageSize(FIELD_MAPPING_DEFAULT_PAGE_SIZE);
    setPage(1);
    setRoute((current) => ({ ...DEFAULT_MAPPING_ROUTE, tab: current.tab || tab }));
  };

  const handleViewFieldMapping = (row: FieldMappingTableSummary) => {
    setRoute({
      tab: "field",
      sourceSystemId: String(getRouteSourceSystemId(route) || row.sourceSystemId || row.upstreamSystemId || ""),
      sourceTable: row.srcTable || "",
      dwfTable: row.targetTable || "",
      tablePk: row.tablePk ?? "",
    });
  };

  const renderTableCell = (row: FieldMappingTableSummary, column: MappingColumn) => {
    if (column.key === "srcSystem") {
      const systemLabel = formatSystemLabel(row);
      return (
        <span className="fm-system" title={systemLabel}>
          <span className="fm-dot" aria-hidden="true"></span>
          <span className="fm-cell-ellipsis">{systemLabel}</span>
        </span>
      );
    }
    if (column.key === "srcTable") return <MappingCellText value={row.srcTable} className="mono" />;
    if (column.key === "srcTableCn") return <MappingCellText value={row.srcTableCn} />;
    if (column.key === "targetTable") return <MappingCellText value={row.targetTable} className="mono" />;
    if (column.key === "loadMode") {
      const loadMode = LOAD_MODE_META[row.loadMode];
      return loadMode ? (
        <span className={`tag ${loadMode.tone}`}>
          {loadMode.label}
        </span>
      ) : (
        <span className="fm-empty">未设置</span>
      );
    }
    if (column.key === "__actions") {
      return (
        <button className="btn" type="button" onClick={() => handleViewFieldMapping(row)}>
          <Icon name="link" size={14} />
          查看字段映射
        </button>
      );
    }
    if (column.key === "mappedCount") return row.mappedCount;
    if (column.key === "emptyCommentRate") {
      return (
        <div className="fm-coverage">
          <span className="mono">{row.emptyCommentRate}%</span>
          <div className="fm-coverage-bar"><i style={{ width: `${100 - row.emptyCommentRate}%` }} /></div>
        </div>
      );
    }
    return readMappingValue(row, column.key) ?? "";
  };

  const displayCellValue = (row: MappingRow, column: MappingColumn): MappingCellValue => {
    if (column.key === "srcSystem") return formatSystemLabel(row);
    if (column.key === "loadMode") {
      const loadMode = readMappingValue(row, "loadMode");
      return typeof loadMode === "string" ? LOAD_MODE_META[loadMode]?.label ?? "" : "";
    }
    return readMappingValue(row, column.key) ?? "";
  };

  const tableViewWidth = orderedTableColumns.reduce(
    (width, column) => width + (column.width ?? 160),
    0,
  );
  const fieldViewWidth = fieldLayoutColumns.reduce(
    (width, column) => width + (column.width ?? 160),
    0,
  );
  const tableClassName = tab === "table" ? "is-table-view" : "is-field-view";
  const renderStickyHeader = ({ contentWidth, columnWidths }: HeaderMeasurement) => {
    const measuredWidth = Math.max(contentWidth, columnWidths.reduce((width, value) => width + value, 0));
    return (
      <table
        className={`fm-table ${tableClassName}`}
        style={{ width: measuredWidth, tableLayout: "fixed" }}
      >
        <colgroup>
          {columnWidths.map((width, index) => <col key={index} style={{ width, minWidth: width }} />)}
        </colgroup>
        <MappingTableHeader
          tab={tab}
          sourceColumns={sourceColumns}
          targetColumns={targetColumns}
          orderedTableColumns={orderedTableColumns}
          sort={sort}
          onSort={toggleSort}
        />
      </table>
    );
  };

  const exportCurrentTab = async () => {
    setExportError("");
    try {
      const csv = await exportFieldMappingCsv(tab, {
        ...requestFilters,
        sourceSystemId: requestFilters.sourceSystemId || "",
        keyword: keyword || "",
        page: requestPage,
        pageSize,
        ...(tab === "field" && sort.key
          ? { sortKey: sort.key, sortDirection: sort.direction }
          : {}),
      });
      if (csv !== null) {
        downloadCsvContent(
          tab === "field" ? "字段映射_字段视图.csv" : "字段映射_表视图.csv",
          csv,
        );
        return;
      }
      if (tab === "field") {
        downloadCsv("字段映射_字段视图.csv", [
          fieldColumns.map((item) => item.label),
          ...fieldPageRows.map((row) => fieldColumns.map((item) => displayCellValue(row, item))),
        ]);
        return;
      }
      downloadCsv("字段映射_表视图.csv", [
        orderedTableColumns.filter((item) => item.key !== "__actions").map((item) => item.label),
        ...tablePageRows.map((row) => orderedTableColumns
          .filter((item) => item.key !== "__actions")
          .map((item) => displayCellValue(row, item))),
      ]);
    } catch (exportError: unknown) {
      setExportError(
        `导出失败：${exportError instanceof Error ? exportError.message : "请稍后重试。"}`,
      );
    }
  };

  return (
    <div className="fm-page">
      <div className="page-head">
        <div>
          <div className="page-title"><Icon name="link" size={20} color="var(--ink-2)" />字段映射查询</div>
          <div className="page-sub">查询源字段与目标字段之间的映射关系，支持字段维度和表维度查看。</div>
        </div>
      </div>
      {exportError ? (
        <ActionErrorBanner message={exportError} onClose={() => setExportError("")} />
      ) : null}

      {linkedView ? (
        <section className="fm-context-bar">
          <div className="fm-context-copy">
            <div className="fm-context-title">当前仅查看：{currentSourceLabel || "指定源系统"}</div>
            <div className="fm-context-sub">
              {tab === "table"
                ? "已按源系统跳转到表维度结果。"
                : "已按源系统及表范围跳转到字段维度结果。"}
            </div>
          </div>
          <div className="fm-context-actions">
            <button className="btn" type="button" onClick={onBackToUpstream}>
              <Icon name="chevron" size={14} />
              返回上游卸数
            </button>
            <button className="btn" type="button" onClick={handleClearLinkedFilters}>
              <Icon name="close" size={14} />
              清除筛选
            </button>
          </div>
        </section>
      ) : null}

      <FieldMappingStats stats={stats} />

      <FieldMappingFilters
        open={filterOpen}
        draftFilters={draftFilters}
        sourceSystems={sourceSystems}
        onToggle={() => setFilterOpen((current) => !current)}
        onChange={setDraftValue}
        onReset={handleResetFilters}
        onApply={() => {
          setPage(1);
          setFilters(draftFilters);
        }}
      />

      <section className="fm-card">
        <div className="fm-result-head">
          <div className="fm-tabs">
            {dimensionTabs.map((item) => (
              <button
                key={item.key}
                className={tab === item.key ? "active" : ""}
                type="button"
                onClick={() => handleTabChange(item.key)}
              >
                {item.label}
                <span>{dimensionTabCounts[item.key]}</span>
              </button>
            ))}
          </div>
          <div className="fm-result-tools">
            <span>共 <b>{totalRows}</b> 条</span>
            {canExport ? <button className="btn" type="button" onClick={exportCurrentTab}>
              <Icon name="download" size={15} />
              导出 CSV
            </button> : null}
          </div>
        </div>

        {loading ? (
          <div className="state-card" role="status" aria-live="polite">
            <div className="state-spinner" aria-hidden="true"></div>
            <h4>加载字段映射</h4>
            <p>正在根据当前筛选条件准备映射结果。</p>
          </div>
        ) : error ? (
          <div className="state-card state-card-error" role="alert">
            <div className="ec"><Icon name="inbox" size={24} /></div>
            <h4>字段映射加载失败</h4>
            <p>{error}</p>
          </div>
        ) : !(tab === "field" ? fieldPageRows : tablePageRows).length ? (
          <EmptyState title="暂无匹配记录" desc="可以调整查询条件，或者清空顶部搜索关键字后重试。" />
        ) : (
          <>
            <FieldMappingWideTable renderStickyHeader={renderStickyHeader}>
              <table
                id="field-mapping-results-table"
                className={`fm-table ${tableClassName}`}
                data-source-column-count={sourceColumns.length}
                style={{
                  width: tab === "table" ? tableViewWidth : fieldViewWidth,
                  tableLayout: "fixed",
                }}
              >
                <colgroup>
                  {(tab === "table" ? orderedTableColumns : fieldLayoutColumns).map((column) => (
                    <col key={column.key} style={{ width: column.width, minWidth: column.width }} />
                  ))}
                </colgroup>
                <MappingTableHeader
                  tab={tab}
                  sourceColumns={sourceColumns}
                  targetColumns={targetColumns}
                  orderedTableColumns={orderedTableColumns}
                  sort={sort}
                  onSort={toggleSort}
                />
                <tbody>
                  {tab === "field" ? fieldPageRows.map((row) => (
                    <tr key={`${row.tablePk ?? fieldMappingTableIdentityKey(row)}-${row.srcField}-${row.targetField || ""}`}>
                      <td>
                        <span className="fm-system" title={formatSystemLabel(row)}>
                          <span className="fm-dot" aria-hidden="true"></span>
                          <span className="fm-cell-ellipsis">{formatSystemLabel(row)}</span>
                        </span>
                      </td>
                      <td className="mono fm-cell-ellipsis-cell" title={row.srcTable}><MappingCellText value={String(row.srcTable || "")} className="mono" /></td>
                      <td className="mono fm-cell-ellipsis-cell" title={row.srcField}><MappingCellText value={String(row.srcField || "")} className="mono" /></td>
                      <td className="fm-muted mono fm-cell-ellipsis-cell" title={row.srcType}><MappingCellText value={String(row.srcType || "")} className="mono" /></td>
                      <td className="fm-cell-ellipsis-cell" title={row.srcComment || "未填写"}>
                        {row.srcComment ? <MappingCellText value={row.srcComment} /> : <span className="fm-empty">未填写</span>}
                      </td>
                      <td className="fm-arrow-cell">
                        <span
                          className={isTransformRule(row.mappingRule || "") ? "fm-arrow is-transform" : "fm-arrow"}
                          title={isTransformRule(row.mappingRule || "") ? `需要转换：${row.mappingRule}` : "直接映射"}
                        >
                          →
                        </span>
                      </td>
                      <td className="mono fm-cell-ellipsis-cell" title={row.targetTable}><MappingCellText value={String(row.targetTable || "")} className="mono" /></td>
                      <td className="mono fm-cell-ellipsis-cell" title={row.targetField || "待补充"}>
                        {row.targetField ? <MappingCellText value={row.targetField} className="mono" /> : <span className="fm-empty">待补充</span>}
                      </td>
                      <td><span className={`tag ${RULE_TAGS[row.mappingRule || ""] || "tag-neutral"}`} title={row.mappingRule}>{row.mappingRule}</span></td>
                    </tr>
                  )) : tablePageRows.map((row) => (
                    <tr key={row.tablePk ?? fieldMappingTableIdentityKey(row)}>
                      {orderedTableColumns.map((column) => (
                        <td
                          key={column.key}
                          className={[
                            column.key === "srcTable" || column.key === "targetTable" ? "mono" : "",
                            column.key === "mappedCount" ? "mono" : "",
                            column.align === "right" ? "is-right" : "",
                          ].filter(Boolean).join(" ")}
                        >
                          {renderTableCell(row, column)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </FieldMappingWideTable>

            <div className="fm-pagination">
              <div>第 {totalRows ? ((currentPage - 1) * pageSize + 1) : 0}-{Math.min(currentPage * pageSize, totalRows)} 条 / 共 {totalRows} 条</div>
              <div className="fm-pagination-tools">
                <label>
                  每页
                  <select
                    className="sel fm-page-size"
                    value={pageSize}
                    onChange={(event) => {
                      setPage(1);
                      setPageSize(Number(event.target.value));
                    }}
                  >
                    {FIELD_MAPPING_PAGE_SIZE_OPTIONS.map((item) => (
                      <option key={item} value={item}>{item}</option>
                    ))}
                  </select>
                  条
                </label>
                <button className="btn" type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={currentPage <= 1}>
                  上一页
                </button>
                <span className="mono">{currentPage} / {pageCount}</span>
                <button className="btn" type="button" onClick={() => setPage((current) => Math.min(pageCount, current + 1))} disabled={currentPage >= pageCount}>
                  下一页
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
