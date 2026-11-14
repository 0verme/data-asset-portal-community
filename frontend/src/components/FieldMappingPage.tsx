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
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

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
import { Button, TablePagination } from "../ui/index.ts";

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
type FieldMappingT = TFunction<"fieldMapping">;
type FieldMappingColumnLabelKey =
  | "columns.sourceSystem"
  | "columns.sourceTable"
  | "columns.sourceTableChineseName"
  | "columns.sourceField"
  | "columns.fieldType"
  | "columns.fieldComment"
  | "columns.targetLayer"
  | "columns.targetTable"
  | "columns.loadMode"
  | "columns.targetField"
  | "columns.mappingRule"
  | "columns.mappedCount"
  | "columns.emptyCommentRate"
  | "columns.actions";
type FieldMappingLoadModeKey = "loadModes.full" | "loadModes.incr" | "loadModes.incr_zip" | "loadModes.full_zip";

const COLUMN_LABEL_KEYS: Record<Exclude<MappingColumnKey, "__arrow">, FieldMappingColumnLabelKey> = {
  srcSystem: "columns.sourceSystem",
  srcTable: "columns.sourceTable",
  srcTableCn: "columns.sourceTableChineseName",
  srcField: "columns.sourceField",
  srcType: "columns.fieldType",
  srcComment: "columns.fieldComment",
  targetLayer: "columns.targetLayer",
  targetTable: "columns.targetTable",
  loadMode: "columns.loadMode",
  targetField: "columns.targetField",
  mappingRule: "columns.mappingRule",
  mappedCount: "columns.mappedCount",
  emptyCommentRate: "columns.emptyCommentRate",
  __actions: "columns.actions",
};

const LOAD_MODE_LABEL_KEYS: Record<string, FieldMappingLoadModeKey> = {
  full: "loadModes.full",
  incr: "loadModes.incr",
  incr_zip: "loadModes.incr_zip",
  full_zip: "loadModes.full_zip",
};

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
  title?: ((row: EnrichedFieldMappingRow, t: FieldMappingT) => string) | undefined;
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
  const { t } = useTranslation("fieldMapping");
  const labelForColumn = (column: MappingColumn) => column.key === "__arrow"
    ? t("cells.mappingDirection")
    : t(COLUMN_LABEL_KEYS[column.key]);
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
            <th key={column.key} rowSpan={2} className="fm-arrow-col" aria-label={labelForColumn(column)}></th>
          )) : (
            <th
              key={`${group}-${columns[0]?.key ?? "empty"}`}
              colSpan={columns.length}
              className={group === "source" ? "fm-group-source" : "fm-group-target"}
            >
              {group === "source" ? t("groups.source") : t("groups.target")}
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
            <span>{labelForColumn(column)}{column.sortable === false ? "" : sortMarker(sort, column.key)}</span>
          </th>
        )) : orderedTableColumns.map((column) => (
          <th
            key={column.key}
            className={column.align === "right" ? "is-right" : ""}
            onClick={column.sortable === false ? undefined : () => onSort(column.key)}
          >
            <span>{labelForColumn(column)}{column.sortable === false ? "" : sortMarker(sort, column.key)}</span>
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

function renderFieldCell(row: EnrichedFieldMappingRow, key: FieldColumnKey, t: FieldMappingT): ReactNode {
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
        : <span className="fm-empty">{t("cells.notFilled")}</span>;
    case "__arrow":
      return (
        <span
          className={isTransformRule(row.mappingRule || "") ? "fm-arrow is-transform" : "fm-arrow"}
          title={isTransformRule(row.mappingRule || "") ? t("cells.transformRequired", { rule: row.mappingRule }) : t("cells.directMapping")}
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
      const loadModeKey = LOAD_MODE_LABEL_KEYS[row.loadMode || ""];
      return loadMode ? (
        <span className={`tag ${loadMode.tone}`}>{loadModeKey ? t(loadModeKey) : loadMode.label}</span>
      ) : (
        <span className="fm-empty">{t("cells.notSet")}</span>
      );
    }
    case "targetField":
      return row.targetField
        ? <MappingCellText value={row.targetField} className="mono" />
        : <span className="fm-empty">{t("cells.pending")}</span>;
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
  { key: "srcSystem", label: "columns.sourceSystem", width: 260, group: "source" },
  { key: "srcTable", label: "columns.sourceTable", width: 240, group: "source", cellClassName: "mono fm-cell-ellipsis-cell", title: (row) => String(row.srcTable || "") },
  { key: "srcField", label: "columns.sourceField", width: 180, group: "source", cellClassName: "mono fm-cell-ellipsis-cell", title: (row) => String(row.srcField || "") },
  { key: "srcType", label: "columns.fieldType", width: 120, group: "source", cellClassName: "fm-muted mono fm-cell-ellipsis-cell", title: (row) => String(row.srcType || "") },
  { key: "srcComment", label: "columns.fieldComment", width: 280, group: "source", cellClassName: "fm-cell-ellipsis-cell", title: (row, t) => row.srcComment || t("cells.notFilled") },
  { key: "__arrow", label: "", width: 48, group: "arrow", sortable: false, cellClassName: "fm-arrow-cell" },
  { key: "targetLayer", label: "columns.targetLayer", width: 90, group: "target", cellClassName: "mono fm-cell-ellipsis-cell", title: (row) => row.targetLayer || "-" },
  { key: "targetTable", label: "columns.targetTable", width: 280, group: "target", cellClassName: "mono fm-cell-ellipsis-cell", title: (row) => String(row.targetTable || "") },
  { key: "loadMode", label: "columns.loadMode", width: 110, group: "target" },
  { key: "targetField", label: "columns.targetField", width: 180, group: "target", cellClassName: "mono fm-cell-ellipsis-cell", title: (row, t) => row.targetField || t("cells.pending") },
  { key: "mappingRule", label: "columns.mappingRule", width: 180, group: "target" },
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
  const { t } = useTranslation("fieldMapping");
  const tRef = useRef(t);
  tRef.current = t;
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
  const [stats, setStats] = useState<FieldMappingStatsData | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsRequestKey, setStatsRequestKey] = useState("");
  const [statsError, setStatsError] = useState("");
  const [statsRetryVersion, setStatsRetryVersion] = useState(0);
  const [fieldRows, setFieldRows] = useState<EnrichedFieldMappingRow[]>([]);
  const [fieldTotal, setFieldTotal] = useState(0);
  const [tableRows, setTableRows] = useState<FieldMappingTableSummary[]>([]);
  const [tableTotal, setTableTotal] = useState(0);
  const [listLoading, setListLoading] = useState(false);
  const [listRequestKey, setListRequestKey] = useState("");
  const [listError, setListError] = useState("");
  const [listRetryVersion, setListRetryVersion] = useState(0);
  const [exportError, setExportError] = useState("");
  const previousKeywordRef = useRef(keyword);
  const routeSourceSystemId = String(getRouteSourceSystemId(routeFilters) || "");
  const needsSourceLabel = Boolean(routeFilters.sourceTable || routeFilters.dwfTable || routeFilters.tablePk);
  const previousSourceSystemRef = useRef(routeSourceSystemId);
  const sourceSystemChanged = previousSourceSystemRef.current !== routeSourceSystemId;
  const requestPage = previousKeywordRef.current === keyword && !sourceSystemChanged ? page : 1;
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
  const statsQueryKey = JSON.stringify(baseParams);
  const listQueryKey = JSON.stringify([tab, listParams]);

  useEffect(() => {
    let cancelled = false;
    if (!needsSourceLabel) {
      setSourceSystems([]);
      return () => {
        cancelled = true;
      };
    }

    async function loadOptions(): Promise<void> {
      try {
        const mappingSystems = await getFieldMappingSourceSystems();
        if (cancelled) return;
        setSourceSystems(mappingSystems);
      } catch {
        if (!cancelled) setSourceSystems([]);
      }
    }

    void loadOptions();
    return () => {
      cancelled = true;
    };
  }, [needsSourceLabel]);

  useEffect(() => {
    const nextFilters = buildLinkedFilters(routeFilters);
    const mergeRouteFilters = (current: FieldMappingFilterState) => {
      const merged = {
        ...current,
        sourceSystemId: nextFilters.sourceSystemId,
        tablePk: nextFilters.tablePk,
        ...(nextFilters.srcTable ? { srcTable: nextFilters.srcTable } : {}),
        ...(nextFilters.targetTable ? { targetTable: nextFilters.targetTable } : {}),
      };
      return areFieldMappingFiltersEqual(current, merged) ? current : merged;
    };
    setDraftFilters(mergeRouteFilters);
    setFilters(mergeRouteFilters);
    setPage(1);
  }, [routeFilters]);

  useEffect(() => {
    let cancelled = false;
    setStatsRequestKey(statsQueryKey);
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
        setStatsError(loadError instanceof Error ? loadError.message : tRef.current("results.statsError"));
      } finally {
        if (!cancelled) setStatsLoading(false);
      }
    }

    void loadStats();
    return () => {
      cancelled = true;
    };
  }, [baseParams, statsQueryKey, statsRetryVersion]);

  useEffect(() => {
    let cancelled = false;
    setListRequestKey(listQueryKey);
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
          if (nextRows.pageSize !== pageSize) setPageSize(nextRows.pageSize);
          const lastPage = Math.max(1, Math.ceil(nextRows.total / nextRows.pageSize));
          const normalizedPage = Math.min(nextRows.page, lastPage);
          if (normalizedPage !== requestPage) setPage(normalizedPage);
        } else {
          const nextRows = await getFieldMappingTables(listParams);
          if (cancelled) return;
          setTableRows(nextRows.items);
          setTableTotal(nextRows.total);
          if (nextRows.pageSize !== pageSize) setPageSize(nextRows.pageSize);
          const lastPage = Math.max(1, Math.ceil(nextRows.total / nextRows.pageSize));
          const normalizedPage = Math.min(nextRows.page, lastPage);
          if (normalizedPage !== requestPage) setPage(normalizedPage);
        }
      } catch (loadError: unknown) {
        if (cancelled) return;
        setListError(loadError instanceof Error ? loadError.message : tRef.current(tab === "field" ? "results.fieldError" : "results.tableError"));
      } finally {
        if (!cancelled) setListLoading(false);
      }
    }

    void loadActiveList();
    return () => {
      cancelled = true;
    };
  }, [listParams, listQueryKey, pageSize, requestPage, tab, listRetryVersion]);

  useEffect(() => {
    previousKeywordRef.current = keyword;
    previousSourceSystemRef.current = routeSourceSystemId;
    setPage(1);
  }, [keyword, routeSourceSystemId]);

  const linkedView = Boolean(route.sourceTable || route.dwfTable || route.tablePk);
  const currentSourceLabel = resolveSourceSystemLabel(route, sourceSystems);
  const currentStats = statsRequestKey === statsQueryKey ? stats : null;
  const currentStatsError = statsRequestKey === statsQueryKey ? statsError : "";
  const currentStatsLoading = statsLoading || statsRequestKey !== statsQueryKey;
  const displayStatCount = (value: number | undefined): number | string => {
    if (typeof value === "number") return value;
    return currentStatsLoading ? "…" : "—";
  };
  const dimensionTabCounts: Record<MappingTab, number | string> = {
    table: displayStatCount(currentStats?.sourceTableCount),
    field: displayStatCount(currentStats?.fieldCount),
  };
  const statsStatus: FieldMappingStatsStatus = currentStatsError
    ? "error"
    : currentStatsLoading
      ? "loading"
      : currentStats
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

  const listIsCurrent = listRequestKey === listQueryKey;
  const currentListLoading = listLoading || !listIsCurrent;
  const currentListError = listIsCurrent ? listError : "";
  const totalRows = listIsCurrent ? (tab === "field" ? fieldTotal : tableTotal) : 0;
  const fieldPageRows = tab === "field" && listIsCurrent ? sortedFieldRows : [];
  const tablePageRows = tab === "table" && listIsCurrent ? sortedTableRows : [];

  const tableColumns: TableColumn[] = [
    { key: "srcSystem", label: "columns.sourceSystem", width: 260 },
    { key: "srcTable", label: "columns.sourceTable", width: 240 },
    { key: "srcTableCn", label: "columns.sourceTableChineseName", width: 220 },
    { key: "targetLayer", label: "columns.targetLayer", width: 90 },
    { key: "targetTable", label: "columns.targetTable", width: 370 },
    { key: "mappedCount", label: "columns.mappedCount", align: "right", width: 100 },
    { key: "loadMode", label: "columns.loadMode", width: 110 },
    { key: "emptyCommentRate", label: "columns.emptyCommentRate", align: "right", width: 140 },
    { key: "__actions", label: "columns.actions", align: "right", sortable: false, width: 150 },
  ];
  // Keep complete CSV columns even when a redundant column is hidden in the table UI.
  const tableCsvColumns = tableColumns.filter((column) => column.key !== "__actions");
  const orderedTableColumnKeys: readonly TableColumnKey[] = [
    "srcSystem",
    "srcTable",
    "srcTableCn",
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
    if (isLinkedRoute(route)) {
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
      const loadModeKey = LOAD_MODE_LABEL_KEYS[row.loadMode];
      return loadMode ? (
        <span className={`tag ${loadMode.tone}`}>
          {loadModeKey ? t(loadModeKey) : loadMode.label}
        </span>
      ) : (
        <span className="fm-empty">{t("cells.notSet")}</span>
      );
    }
    if (column.key === "__actions") {
      return (
        <Button className="btn" variant="secondary" type="button" onClick={() => handleViewFieldMapping(row)}>
          <Icon name="link" size={14} />
          {t("results.viewFieldMapping")}
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
      const loadModeKey = typeof loadMode === "string" ? LOAD_MODE_LABEL_KEYS[loadMode] : undefined;
      return loadModeKey ? t(loadModeKey) : typeof loadMode === "string" ? LOAD_MODE_META[loadMode]?.label ?? "" : "";
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
          tab === "field" ? t("export.fieldFilename") : t("export.tableFilename"),
          csv,
        );
        return;
      }
      const exportRows = sortMappingRows(
        getFieldMappingMockExportRows(tab, exportParams),
        sort,
      );
      if (tab === "field") {
        downloadCsv(t("export.fieldFilename"), [
          FIELD_CSV_COLUMNS.map((item) => t(COLUMN_LABEL_KEYS[item.key])),
          ...exportRows.map((row) => FIELD_CSV_COLUMNS.map((item) => displayCellValue(row, item))),
        ]);
        return;
      }
      downloadCsv(t("export.tableFilename"), [
        tableCsvColumns.map((item) => t(COLUMN_LABEL_KEYS[item.key])),
        ...exportRows.map((row) => tableCsvColumns.map((item) => displayCellValue(row, item))),
      ]);
    } catch (exportError: unknown) {
      setExportError(
        t("exportError.prefix", { message: exportError instanceof Error ? exportError.message : t("exportError.retry") }),
      );
    }
  };

  return (
    <div className="fm-page">
      <div className="page-head">
        <div>
          <div className="page-title"><Icon name="link" size={20} color="var(--ink-2)" />{t("page.title")}</div>
          <div className="page-sub">{t("page.subtitle")}</div>
        </div>
      </div>
      {exportError ? (
        <ActionErrorBanner message={exportError} onClose={() => setExportError("")} />
      ) : null}

      {linkedView ? (
        <section className="fm-context-bar">
          <div className="fm-context-copy">
            <div className="fm-context-title">{t("context.currentOnly", { source: currentSourceLabel || t("context.defaultSource") })}</div>
            <div className="fm-context-sub">
              {tab === "table"
                ? t("context.tableRedirect")
                : t("context.fieldRedirect")}
            </div>
          </div>
          <div className="fm-context-actions">
            <Button className="btn" variant="secondary" type="button" onClick={onBackToUpstream}>
              <Icon name="chevron" size={14} />
              {t("context.back")}
            </Button>
            <Button className="btn" variant="secondary" type="button" onClick={handleClearLinkedFilters}>
              <Icon name="close" size={14} />
              {t("context.clear")}
            </Button>
          </div>
        </section>
      ) : null}

      <div aria-busy={currentStatsLoading}>
        <FieldMappingStats stats={currentStats} status={statsStatus} />
        {currentStatsError ? (
          <div className="fm-stats-error">
            <ActionErrorBanner title={t("results.statsError")} message={currentStatsError} />
            <Button
              className="btn"
              variant="secondary"
              type="button"
              onClick={() => setStatsRetryVersion((current) => current + 1)}
            >
              {t("results.retryStats")}
            </Button>
          </div>
        ) : null}
      </div>

      <FieldMappingFilters
        open={filterOpen}
        draftFilters={draftFilters}
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
                {t(item.key === "table" ? "tabs.table" : "tabs.field")}
                <span>{dimensionTabCounts[item.key]}</span>
              </button>
            ))}
          </div>
          <div className="fm-result-tools">
            <span>{t("results.count", { count: totalRows })}</span>
            {canExport ? <Button className="btn" variant="secondary" type="button" onClick={exportCurrentTab}>
              <Icon name="download" size={15} />
              {t("results.export")}
            </Button> : null}
          </div>
        </div>

        {currentListLoading ? (
          <div className="state-card" role="status" aria-live="polite">
            <div className="state-spinner" aria-hidden="true"></div>
            <h4>{tab === "field" ? t("results.loadingFields") : t("results.loadingTables")}</h4>
            <p>{t("results.loadingDescription")}</p>
          </div>
        ) : currentListError ? (
          <div className="state-card state-card-error" role="alert">
            <div className="ec"><Icon name="inbox" size={24} /></div>
            <h4>{tab === "field" ? t("results.fieldError") : t("results.tableError")}</h4>
            <p>{currentListError}</p>
            <Button
              className="btn"
              variant="secondary"
              type="button"
              onClick={() => setListRetryVersion((current) => current + 1)}
            >
              {t("results.retryList")}
            </Button>
          </div>
        ) : !(tab === "field" ? fieldPageRows : tablePageRows).length ? (
          <EmptyState title={t("results.emptyTitle")} desc={t("results.emptyDescription")} />
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
                          title={column.title?.(row, t)}
                        >
                          {renderFieldCell(row, column.key, t)}
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

          </>
        )}
        <TablePagination
          ariaLabel={t("results.paginationLabel")}
          page={page}
          pageSize={pageSize}
          total={totalRows}
          pageSizeOptions={FIELD_MAPPING_PAGE_SIZE_OPTIONS}
          loading={currentListLoading}
          disabled={Boolean(currentListError) || !listIsCurrent}
          onPageChange={setPage}
          onPageSizeChange={(nextPageSize) => {
            setPage(1);
            setPageSize(nextPageSize);
          }}
        />
      </section>
    </div>
  );
}
