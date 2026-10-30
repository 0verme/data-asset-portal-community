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

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type Dispatch, type ReactNode, type SetStateAction } from "react";

import {
  FIELD_MAPPING_DEFAULT_PAGE_SIZE,
  FIELD_MAPPING_PAGE_SIZE_OPTIONS,
  getFieldMappingSourceSystems,
  getFieldMappingStats,
  getFieldMappings,
  exportFieldMappingCsv,
  getFieldMappingMockExportRows,
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
import type { FieldMappingStatsStatus } from "./fieldMapping/fieldMappingStatsState.ts";
import { Icon } from "./ui.tsx";
import { Button, Select } from "../ui/index.ts";

type MappingTab = "table" | "field";

type MappingRow = EnrichedFieldMappingRow | FieldMappingTableSummary;
type MappingCellValue = string | number | null | undefined;
type FieldColumnKey =
  | "srcSystem"
  | "srcTable"
  | "srcField"
  | "srcType"
  | "srcComment"
  | "__arrow"
  | "targetLayer"
  | "targetTable"
  | "loadMode"
  | "targetField"
  | "mappingRule";
type FieldBusinessColumnKey = Exclude<FieldColumnKey, "__arrow">;
type TableColumnKey =
  | "srcSystem"
  | "srcTable"
  | "srcTableCn"
  | "targetLayer"
  | "targetTable"
  | "loadMode"
  | "__actions"
  | "mappedCount"
  | "emptyCommentRate";
type MappingColumnKey = FieldColumnKey | TableColumnKey;
type FieldMappingSortState = Omit<FieldMappingSort, "key"> & { key: MappingColumnKey | "" };

interface MappingColumn {
  key: MappingColumnKey;
  label: string;
  align?: "right" | undefined;
  sortable?: boolean | undefined;
  width?: number | undefined;
}

interface FieldColumn extends MappingColumn {
  key: FieldColumnKey;
  group: "source" | "arrow" | "target";
  cellClassName?: string | undefined;
  title?: ((row: EnrichedFieldMappingRow) => string) | undefined;
}

interface TableColumn extends MappingColumn {
  key: TableColumnKey;
}

interface DimensionTab {
  key: MappingTab;
  label: string;
}

interface MappingTableHeaderProps {
  tab: MappingTab;
  fieldColumns: readonly FieldColumn[];
  orderedTableColumns: readonly TableColumn[];
  sort: FieldMappingSortState;
  onSort: (key: MappingColumnKey) => void;
}

function MappingTableHeader({
  tab,
  fieldColumns,
  orderedTableColumns,
  sort,
  onSort,
}: MappingTableHeaderProps) {
  const fieldGroups = fieldColumns.reduce<Array<{ group: FieldColumn["group"]; columns: FieldColumn[] }>>((groups, column) => {
    const currentGroup = groups.at(-1);
    if (currentGroup?.group === column.group) {
      currentGroup.columns.push(column);
    } else {
      groups.push({ group: column.group, columns: [column] });
    }
    return groups;
  }, []);
  return (
    <thead>
      {tab === "field" ? (
        <tr className="fm-group-head">
          {fieldGroups.map(({ group, columns }) => group === "arrow" ? columns.map((column) => (
            <th key={column.key} rowSpan={2} className="fm-arrow-col" aria-label={column.label || "映射方向"}></th>
          )) : (
            <th
              key={`${group}-${columns[0]?.key ?? "empty"}`}
              colSpan={columns.length}
              className={group === "source" ? "fm-group-source" : "fm-group-target"}
            >
              {group === "source" ? "源系统侧 / SOURCE" : "数据仓库 DWF 侧 / TARGET"}
            </th>
          ))}
        </tr>
      ) : null}
      <tr>
        {tab === "field" ? fieldColumns.filter((column) => column.group !== "arrow").map((column) => (
          <th
            key={column.key}
            onClick={column.sortable === false ? undefined : () => onSort(column.key)}
          >
            <span>{column.label}{column.sortable === false ? "" : sortMarker(sort, column.key)}</span>
          </th>
        )) : orderedTableColumns.map((column) => (
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

function renderFieldCell(row: EnrichedFieldMappingRow, key: FieldColumnKey): ReactNode {
  switch (key) {
    case "srcSystem": {
      const systemLabel = formatSystemLabel(row);
      return (
        <span className="fm-system" title={systemLabel}>
          <span className="fm-dot" aria-hidden="true"></span>
          <span className="fm-cell-ellipsis">{systemLabel}</span>
        </span>
      );
    }
    case "srcTable":
      return <MappingCellText value={String(row.srcTable || "")} className="mono" />;
    case "srcField":
      return <MappingCellText value={String(row.srcField || "")} className="mono" />;
    case "srcType":
      return <MappingCellText value={String(row.srcType || "")} className="mono" />;
    case "srcComment":
      return row.srcComment
        ? <MappingCellText value={row.srcComment} />
        : <span className="fm-empty">未填写</span>;
    case "__arrow":
      return (
        <span
          className={isTransformRule(row.mappingRule || "") ? "fm-arrow is-transform" : "fm-arrow"}
          title={isTransformRule(row.mappingRule || "") ? `需要转换：${row.mappingRule}` : "直接映射"}
        >
          →
        </span>
      );
    case "targetLayer":
      return <MappingCellText value={String(row.targetLayer || "-")} className="mono" />;
    case "targetTable":
      return <MappingCellText value={String(row.targetTable || "")} className="mono" />;
    case "loadMode": {
      const loadMode = LOAD_MODE_META[row.loadMode || ""];
      return loadMode ? (
        <span className={`tag ${loadMode.tone}`}>{loadMode.label}</span>
      ) : (
        <span className="fm-empty">未设置</span>
      );
    }
    case "targetField":
      return row.targetField
        ? <MappingCellText value={row.targetField} className="mono" />
        : <span className="fm-empty">待补充</span>;
    case "mappingRule":
      return (
        <span className={`tag ${RULE_TAGS[row.mappingRule || ""] || "tag-neutral"}`} title={row.mappingRule}>
          {row.mappingRule}
        </span>
      );
  }
  const exhaustive: never = key;
  return exhaustive;
}

const FIELD_COLUMNS: readonly FieldColumn[] = [
  { key: "srcSystem", label: "源系统", width: 260, group: "source" },
  { key: "srcTable", label: "源系统表", width: 240, group: "source", cellClassName: "mono fm-cell-ellipsis-cell", title: (row) => String(row.srcTable || "") },
  { key: "srcField", label: "源字段", width: 180, group: "source", cellClassName: "mono fm-cell-ellipsis-cell", title: (row) => String(row.srcField || "") },
  { key: "srcType", label: "字段类型", width: 120, group: "source", cellClassName: "fm-muted mono fm-cell-ellipsis-cell", title: (row) => String(row.srcType || "") },
  { key: "srcComment", label: "字段注释", width: 280, group: "source", cellClassName: "fm-cell-ellipsis-cell", title: (row) => row.srcComment || "未填写" },
  { key: "__arrow", label: "", width: 48, group: "arrow", sortable: false, cellClassName: "fm-arrow-cell" },
  { key: "targetLayer", label: "目标层", width: 90, group: "target", cellClassName: "mono fm-cell-ellipsis-cell", title: (row) => row.targetLayer || "-" },
  { key: "targetTable", label: "目标表名", width: 280, group: "target", cellClassName: "mono fm-cell-ellipsis-cell", title: (row) => String(row.targetTable || "") },
  { key: "loadMode", label: "入仓方式", width: 110, group: "target" },
  { key: "targetField", label: "目标字段", width: 180, group: "target", cellClassName: "mono fm-cell-ellipsis-cell", title: (row) => row.targetField || "待补充" },
  { key: "mappingRule", label: "映射规则", width: 180, group: "target" },
];

type FieldBusinessColumn = FieldColumn & { key: FieldBusinessColumnKey };

function isFieldBusinessColumn(column: FieldColumn): column is FieldBusinessColumn {
  return column.key !== "__arrow";
}

const FIELD_CSV_COLUMNS = FIELD_COLUMNS.filter(isFieldBusinessColumn);
const dimensionTabs = DIMENSION_TABS as readonly DimensionTab[];

function readMappingValue(row: MappingRow, key: MappingColumnKey): MappingCellValue {
  if (!Object.prototype.hasOwnProperty.call(row, key)) return undefined;
  // SAFETY: dynamic keys are restricted to MappingColumn values, and both row contracts expose string/number cells.
  return (row as unknown as Record<string, MappingCellValue>)[key];
}

function sortMappingRows<T extends MappingRow>(rows: readonly T[], sort: FieldMappingSortState): T[] {
  const nextRows = [...rows];
  const sortKey = sort.key;
  if (!sortKey) return nextRows;
  nextRows.sort((left, right) => {
    const result = compareValues(readMappingValue(left, sortKey), readMappingValue(right, sortKey));
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
  const routeFilters = useMemo(
    () => ({
      sourceSystemId: route.sourceSystemId,
      upstreamSystemId: route.upstreamSystemId,
      sourceTable: route.sourceTable,
      dwfTable: route.dwfTable,
      tablePk: route.tablePk,
    }),
    [route.sourceSystemId, route.upstreamSystemId, route.sourceTable, route.dwfTable, route.tablePk],
  );
  const tab: MappingTab = route.tab === "field" ? "field" : "table";
  const initialFilters = isLinkedRoute(routeFilters)
    ? buildLinkedFilters(routeFilters, "")
    : DEFAULT_FILTERS;
  const [filterOpen, setFilterOpen] = useState(true);
  const [draftFilters, setDraftFilters] = useState<FieldMappingFilterState>(initialFilters);
  const [filters, setFilters] = useState<FieldMappingFilterState>(initialFilters);
  const [pageSize, setPageSize] = useState(FIELD_MAPPING_DEFAULT_PAGE_SIZE);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<FieldMappingSortState>({ key: "", direction: "asc" });
  const [sourceSystems, setSourceSystems] = useState<FieldMappingSourceSystemOption[]>([]);
  const [sourceSystemsError, setSourceSystemsError] = useState("");
  const [sourceSystemsRetry, setSourceSystemsRetry] = useState(0);
  const [stats, setStats] = useState<FieldMappingStatsData | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState("");
  const [statsRetryVersion, setStatsRetryVersion] = useState(0);
  const [fieldRows, setFieldRows] = useState<EnrichedFieldMappingRow[]>([]);
  const [fieldTotal, setFieldTotal] = useState(0);
  const [tableRows, setTableRows] = useState<FieldMappingTableSummary[]>([]);
  const [tableTotal, setTableTotal] = useState(0);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState("");
  const [listRetryVersion, setListRetryVersion] = useState(0);
  const [exportError, setExportError] = useState("");
  const previousKeywordRef = useRef(keyword);
  const requestPage = previousKeywordRef.current === keyword ? page : 1;
  const requestFilters = useMemo(
    () => buildFieldMappingRequestFilters(filters, routeFilters),
    [filters, routeFilters],
  );
  const baseParams = useMemo<FieldMappingQueryParams>(
    () => ({
      ...requestFilters,
      sourceSystemId: requestFilters.sourceSystemId || "",
      keyword: keyword || "",
    }),
    [requestFilters, keyword],
  );
  const fieldSortKey = tab === "field" ? sort.key : "";
  const fieldSortDirection = tab === "field" ? sort.direction : "";
  const listParams = useMemo<FieldMappingQueryParams>(
    () => ({
      ...baseParams,
      page: requestPage,
      pageSize,
      ...(fieldSortKey ? { sortKey: fieldSortKey, sortDirection: fieldSortDirection } : {}),
    }),
    [baseParams, requestPage, pageSize, tab, fieldSortKey, fieldSortDirection],
  );

  useEffect(() => {
    let cancelled = false;

    async function loadOptions(): Promise<void> {
      setSourceSystemsError("");
      try {
        const mappingSystems = await getFieldMappingSourceSystems();
        if (cancelled) return;
        setSourceSystems(mappingSystems);
      } catch (error: unknown) {
        if (cancelled) return;
        setSourceSystems([]);
        setSourceSystemsError(error instanceof Error ? error.message : "来源系统加载失败");
      }
    }

    void loadOptions();
    return () => {
      cancelled = true;
    };
  }, [sourceSystemsRetry]);

  useEffect(() => {
    const nextFilters = isLinkedRoute(routeFilters)
      ? buildLinkedFilters(routeFilters)
      : DEFAULT_FILTERS;
    setDraftFilters((current) => (
      areFieldMappingFiltersEqual(current, nextFilters) ? current : nextFilters
    ));
    setFilters((current) => (
      areFieldMappingFiltersEqual(current, nextFilters) ? current : nextFilters
    ));
    setPage(1);
  }, [routeFilters]);

  useEffect(() => {
    let cancelled = false;
    setStats(null);
    setStatsLoading(true);
    setStatsError("");

    async function loadStats(): Promise<void> {
      try {
        const nextStats = await getFieldMappingStats(baseParams);
        if (cancelled) return;
        setStats(nextStats);
      } catch (loadError: unknown) {
        if (cancelled) return;
        setStats(null);
        setStatsError(loadError instanceof Error ? loadError.message : "字段映射统计加载失败");
      } finally {
        if (!cancelled) setStatsLoading(false);
      }
    }

    void loadStats();
    return () => {
      cancelled = true;
    };
  }, [baseParams, statsRetryVersion]);

  useEffect(() => {
    let cancelled = false;
    setListLoading(true);
    setListError("");
    if (tab === "field") {
      setFieldRows([]);
      setFieldTotal(0);
    } else {
      setTableRows([]);
      setTableTotal(0);
    }

    async function loadActiveList(): Promise<void> {
      try {
        if (tab === "field") {
          const nextRows = await getFieldMappings(listParams);
          if (cancelled) return;
          setFieldRows(nextRows.items);
          setFieldTotal(nextRows.total);
        } else {
          const nextRows = await getFieldMappingTables(listParams);
          if (cancelled) return;
          setTableRows(nextRows.items);
          setTableTotal(nextRows.total);
        }
      } catch (loadError: unknown) {
        if (cancelled) return;
        setListError(loadError instanceof Error ? loadError.message : "字段映射列表加载失败");
      } finally {
        if (!cancelled) setListLoading(false);
      }
    }

    void loadActiveList();
    return () => {
      cancelled = true;
    };
  }, [listParams, tab, listRetryVersion]);

  useEffect(() => {
    previousKeywordRef.current = keyword;
    setPage(1);
  }, [keyword]);

  const displayStatCount = (value: number | undefined): number | string => {
    if (typeof value === "number") return value;
    return statsLoading ? "…" : "—";
  };
  const dimensionTabCounts: Record<MappingTab, number | string> = {
    table: displayStatCount(stats?.sourceTableCount),
    field: displayStatCount(stats?.fieldCount),
  };
  const linkedView = isLinkedRoute(route);
  const currentSourceLabel = resolveSourceSystemLabel(route, sourceSystems);
  const statsStatus: FieldMappingStatsStatus = statsError
    ? "error"
    : statsLoading
      ? "loading"
      : stats
        ? "ready"
        : "unknown";

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

  const tableColumns: TableColumn[] = [
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
  const orderedTableColumnKeys: readonly TableColumnKey[] = [
    "srcSystem",
    "srcTable",
    "srcTableCn",
    "targetLayer",
    "targetTable",
    "loadMode",
    "__actions",
    "mappedCount",
    "emptyCommentRate",
  ];
  const orderedTableColumns = orderedTableColumnKeys.map((key) => tableColumns.find((column) => column.key === key))
    .filter((column): column is TableColumn => Boolean(column));

  const setDraftValue = (key: keyof FieldMappingFilterState) => (
    event: ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => {
    const value = event.target.value;
    setDraftFilters((current) => ({ ...current, [key]: value }));
  };

  const setDraftSourceSystem = (value: string | null) => {
    setDraftFilters((current) => ({ ...current, sourceSystemId: value ?? "" }));
  };

  const toggleSort = (key: MappingColumnKey) => {
    setPage(1);
    setSort((current) => {
      if (current.key !== key) return { key, direction: "asc" };
      if (current.direction === "asc") return { key, direction: "desc" };
      return { key: "", direction: "desc" };
    });
  };

  const handleTabChange = (nextTab: MappingTab) => {
    setPage(1);
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

  const renderTableCell = (row: FieldMappingTableSummary, column: TableColumn) => {
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
        <Button className="btn" variant="secondary" type="button" onClick={() => handleViewFieldMapping(row)}>
          <Icon name="link" size={14} />
          查看字段映射
        </Button>
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
  const fieldViewWidth = FIELD_COLUMNS.reduce(
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
          fieldColumns={FIELD_COLUMNS}
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
      const exportSortKey = tab === "field"
        ? sort.key
        : orderedTableColumns.some(
          (column) => column.sortable !== false && column.key === sort.key,
        )
          ? sort.key
          : "";
      const exportParams = {
        ...baseParams,
        ...(exportSortKey
          ? { sortKey: exportSortKey, sortDirection: sort.direction }
          : {}),
      };
      const csv = await exportFieldMappingCsv(tab, exportParams);
      if (csv !== null) {
        downloadCsvContent(
          tab === "field" ? "字段映射_字段视图.csv" : "字段映射_表视图.csv",
          csv,
        );
        return;
      }
      const exportRows = sortMappingRows(
        getFieldMappingMockExportRows(tab, exportParams),
        sort,
      );
      if (tab === "field") {
        downloadCsv("字段映射_字段视图.csv", [
          FIELD_CSV_COLUMNS.map((item) => item.label),
          ...exportRows.map((row) => FIELD_CSV_COLUMNS.map((item) => displayCellValue(row, item))),
        ]);
        return;
      }
      downloadCsv("字段映射_表视图.csv", [
        orderedTableColumns.filter((item) => item.key !== "__actions").map((item) => item.label),
        ...exportRows.map((row) => orderedTableColumns
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
            <Button className="btn" variant="secondary" type="button" onClick={onBackToUpstream}>
              <Icon name="chevron" size={14} />
              返回上游卸数
            </Button>
            <Button className="btn" variant="secondary" type="button" onClick={handleClearLinkedFilters}>
              <Icon name="close" size={14} />
              清除筛选
            </Button>
          </div>
        </section>
      ) : null}

      <div aria-busy={statsLoading}>
        <FieldMappingStats stats={stats} status={statsStatus} />
        {statsError ? (
          <div className="fm-stats-error">
            <ActionErrorBanner title="统计加载失败" message={statsError} />
            <Button
              className="btn"
              variant="secondary"
              type="button"
              onClick={() => setStatsRetryVersion((current) => current + 1)}
            >
              重试统计
            </Button>
          </div>
        ) : null}
      </div>

      {sourceSystemsError ? (
        <div>
          <ActionErrorBanner title="来源系统加载失败" message={sourceSystemsError} />
          <Button variant="secondary" type="button" onClick={() => setSourceSystemsRetry((value) => value + 1)}>
            重试来源系统
          </Button>
        </div>
      ) : null}
      <FieldMappingFilters
        open={filterOpen}
        draftFilters={draftFilters}
        sourceSystems={sourceSystems}
        onToggle={() => setFilterOpen((current) => !current)}
        onChange={setDraftValue}
        onSourceSystemChange={setDraftSourceSystem}
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
            {canExport ? <Button className="btn" variant="secondary" type="button" onClick={exportCurrentTab}>
              <Icon name="download" size={15} />
              导出 CSV
            </Button> : null}
          </div>
        </div>

        {listLoading ? (
          <div className="state-card" role="status" aria-live="polite">
            <div className="state-spinner" aria-hidden="true"></div>
            <h4>{tab === "field" ? "加载字段明细" : "加载表维度"}</h4>
            <p>正在根据当前筛选条件准备映射结果。</p>
          </div>
        ) : listError ? (
          <div className="state-card state-card-error" role="alert">
            <div className="ec"><Icon name="inbox" size={24} /></div>
            <h4>{tab === "field" ? "字段映射加载失败" : "表维度加载失败"}</h4>
            <p>{listError}</p>
            <Button
              className="btn"
              variant="secondary"
              type="button"
              onClick={() => setListRetryVersion((current) => current + 1)}
            >
              重试列表
            </Button>
          </div>
        ) : !(tab === "field" ? fieldPageRows : tablePageRows).length ? (
          <EmptyState title="暂无匹配记录" desc="可以调整查询条件，或者清空顶部搜索关键字后重试。" />
        ) : (
          <>
            <FieldMappingWideTable renderStickyHeader={renderStickyHeader}>
              <table
                id="field-mapping-results-table"
                className={`fm-table ${tableClassName}`}
                data-source-column-count={FIELD_COLUMNS.filter((column) => column.group === "source").length}
                style={{
                  width: tab === "table" ? tableViewWidth : fieldViewWidth,
                  tableLayout: "fixed",
                }}
              >
                <colgroup>
                  {(tab === "table" ? orderedTableColumns : FIELD_COLUMNS).map((column) => (
                    <col key={column.key} style={{ width: column.width, minWidth: column.width }} />
                  ))}
                </colgroup>
                <MappingTableHeader
                  tab={tab}
                  fieldColumns={FIELD_COLUMNS}
                  orderedTableColumns={orderedTableColumns}
                  sort={sort}
                  onSort={toggleSort}
                />
                <tbody>
                  {tab === "field" ? fieldPageRows.map((row) => (
                    <tr key={`${row.tablePk ?? fieldMappingTableIdentityKey(row)}-${row.srcField}-${row.targetField || ""}`}>
                      {FIELD_COLUMNS.map((column) => (
                        <td
                          key={column.key}
                          className={column.cellClassName ?? ""}
                          title={column.title?.(row)}
                        >
                          {renderFieldCell(row, column.key)}
                        </td>
                      ))}
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
                  <Select<string>
                    aria-label="每页条数"
                    className="sel fm-page-size"
                    items={FIELD_MAPPING_PAGE_SIZE_OPTIONS.map((item) => ({ label: String(item), value: String(item) }))}
                    value={String(pageSize)}
                    onValueChange={(value) => {
                      setPage(1);
                      setPageSize(Number(value));
                    }}
                  />
                  条
                </label>
                <Button className="btn" variant="secondary" type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={currentPage <= 1}>
                  上一页
                </Button>
                <span className="mono">{currentPage} / {pageCount}</span>
                <Button className="btn" variant="secondary" type="button" onClick={() => setPage((current) => Math.min(pageCount, current + 1))} disabled={currentPage >= pageCount}>
                  下一页
                </Button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
