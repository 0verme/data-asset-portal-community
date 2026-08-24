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

import { useEffect, useMemo, useRef, useState } from "react";

import {
  FIELD_MAPPING_DEFAULT_PAGE_SIZE,
  FIELD_MAPPING_PAGE_SIZE_OPTIONS,
  getFieldMappingSourceSystems,
  getFieldMappingStats,
  getFieldMappings,
  getFieldMappingTables,
} from "../api/fieldMapping.js";
import { DEFAULT_MAPPING_ROUTE } from "../config/defaults.js";
import { EmptyState } from "./common/index.js";
import { FieldMappingFilters, FieldMappingStats } from "./fieldMapping/FieldMappingControls.jsx";
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
  isLinkedRoute,
  isTransformRule,
  resolveSourceSystemName,
  sortMarker,
} from "./fieldMapping/fieldMappingUtils.js";
import { Icon } from "./ui.jsx";

export function FieldMappingPage({ keyword, route = DEFAULT_MAPPING_ROUTE, setRoute, onBackToUpstream }) {
  const initialFilters = isLinkedRoute(route)
    ? buildLinkedFilters(route, "")
    : DEFAULT_FILTERS;
  const [filterOpen, setFilterOpen] = useState(true);
  const [draftFilters, setDraftFilters] = useState(initialFilters);
  const [filters, setFilters] = useState(initialFilters);
  const [tab, setTab] = useState(route.tab || "table");
  const [pageSize, setPageSize] = useState(FIELD_MAPPING_DEFAULT_PAGE_SIZE);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState({ key: "", direction: "asc" });
  const [sourceSystems, setSourceSystems] = useState([]);
  const [stats, setStats] = useState(null);
  const [fieldRows, setFieldRows] = useState([]);
  const [fieldTotal, setFieldTotal] = useState(0);
  const [tableRows, setTableRows] = useState([]);
  const [tableTotal, setTableTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const previousKeywordRef = useRef(keyword);
  const requestPage = previousKeywordRef.current === keyword ? page : 1;
  const requestFilters = useMemo(
    () => buildFieldMappingRequestFilters(filters, route),
    [filters, route],
  );

  useEffect(() => {
    let cancelled = false;

    async function loadOptions() {
      try {
        const mappingSystems = await getFieldMappingSourceSystems();
        if (cancelled) return;
        setSourceSystems(mappingSystems);
      } catch {
        if (cancelled) return;
        setSourceSystems([]);
      }
    }

    loadOptions();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const nextTab = route.tab === "field" ? "field" : "table";
    const linkedSourceSystem = resolveSourceSystemName(route, sourceSystems);
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

    async function loadData() {
      setLoading(true);
      setError("");
      try {
        const baseParams = {
          ...requestFilters,
          upstreamSystemId: route.upstreamSystemId || "",
          keyword: keyword || "",
        };
        const requests = [getFieldMappingStats(baseParams)];
        if (tab === "field") {
          requests.push(getFieldMappings({
            ...baseParams,
            page: requestPage,
            pageSize,
            ...(sort.key ? { sortKey: sort.key, sortDirection: sort.direction } : {}),
          }));
        } else {
          requests.push(getFieldMappingTables({
            ...baseParams,
            page: requestPage,
            pageSize,
          }));
        }

        const [nextStats, nextRows] = await Promise.all(requests);
        if (cancelled) return;
        setStats(nextStats);
        if (tab === "field") {
          setFieldRows(nextRows.items);
          setFieldTotal(nextRows.total);
        } else {
          setTableRows(nextRows.items);
          setTableTotal(nextRows.total);
        }
      } catch (loadError) {
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

    loadData();
    return () => {
      cancelled = true;
    };
  }, [
    requestFilters.emptyComment,
    requestFilters.srcField,
    requestFilters.srcSystem,
    requestFilters.srcTable,
    requestFilters.targetField,
    requestFilters.targetTable,
    keyword,
    pageSize,
    requestPage,
    route.upstreamSystemId,
    sort.direction,
    sort.key,
    tab,
    requestFilters,
  ]);

  useEffect(() => {
    previousKeywordRef.current = keyword;
    setPage(1);
  }, [keyword]);

  const dimensionTabCounts = {
    table: stats?.sourceTableCount ?? "-",
    field: stats?.fieldCount ?? "-",
  };
  const linkedView = isLinkedRoute(route);
  const currentSourceLabel = filters.srcSystem || resolveSourceSystemName(route, sourceSystems);

  const sortedRows = useMemo(() => {
    if (tab === "field") return fieldRows;
    const nextRows = [...tableRows];
    if (!sort.key) return nextRows;
    nextRows.sort((left, right) => {
      const result = compareValues(left[sort.key], right[sort.key]);
      return sort.direction === "asc" ? result : -result;
    });
    return nextRows;
  }, [fieldRows, sort, tab, tableRows]);

  const totalRows = tab === "field" ? fieldTotal : tableTotal;
  const pageCount = Math.max(1, Math.ceil(totalRows / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageRows = tab === "field"
    ? sortedRows
    : sortedRows;

  const sourceColumns = [
    { key: "srcSystem", label: "源系统" },
    { key: "srcTable", label: "源系统表" },
    { key: "srcField", label: "源字段" },
    { key: "srcType", label: "字段类型" },
    { key: "srcComment", label: "字段注释" },
  ];
  const targetColumns = [
    { key: "targetTable", label: "DWF 表名" },
    { key: "targetField", label: "DWF 字段" },
    { key: "mappingRule", label: "映射规则" },
  ];
  const fieldColumns = [...sourceColumns, ...targetColumns];
  const tableColumns = [
    { key: "srcSystem", label: "源系统" },
    { key: "srcTable", label: "源系统表" },
    { key: "srcTableCn", label: "表中文名" },
    { key: "targetTable", label: "DWF 表名" },
    { key: "mappedCount", label: "已映射", align: "right" },
    { key: "loadMode", label: "入仓方式" },
    { key: "emptyCommentRate", label: "空注释率", align: "right" },
    { key: "__actions", label: "操作", align: "right", sortable: false },
  ];
  const orderedTableColumns = [
    "srcSystem",
    "srcTable",
    "srcTableCn",
    "targetTable",
    "loadMode",
    "__actions",
    "mappedCount",
    "emptyCommentRate",
  ].map((key) => tableColumns.find((column) => column.key === key)).filter(Boolean);
  const columns = tab === "field" ? fieldColumns : orderedTableColumns;

  const setDraftValue = (key) => (event) => {
    const value = event.target.value;
    setDraftFilters((current) => ({ ...current, [key]: value }));
  };

  const toggleSort = (key) => {
    setPage(1);
    setSort((current) => {
      if (current.key !== key) return { key, direction: "asc" };
      if (current.direction === "asc") return { key, direction: "desc" };
      return { key: "", direction: "desc" };
    });
  };

  const handleTabChange = (nextTab) => {
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
      setRoute((current) => ({ ...DEFAULT_MAPPING_ROUTE, tab: current?.tab || tab }));
    }
  };

  const handleClearLinkedFilters = () => {
    const nextFilters = DEFAULT_FILTERS;
    setDraftFilters(nextFilters);
    setFilters(nextFilters);
    setPageSize(FIELD_MAPPING_DEFAULT_PAGE_SIZE);
    setPage(1);
    setRoute((current) => ({ ...DEFAULT_MAPPING_ROUTE, tab: current?.tab || tab }));
  };

  const handleViewFieldMapping = (row) => {
    setRoute({
      tab: "field",
      upstreamSystemId: route.upstreamSystemId || String(row.upstreamSystemId || ""),
      sourceTable: row.srcTable || "",
      dwfTable: row.targetTable || "",
    });
  };

  const renderTableCell = (row, column) => {
    if (column.key === "srcSystem") {
      return <span className="fm-system"><span className="fm-dot"></span>{row.srcSystem}</span>;
    }
    if (column.key === "srcTable") return row.srcTable;
    if (column.key === "srcTableCn") return row.srcTableCn;
    if (column.key === "targetTable") return row.targetTable;
    if (column.key === "loadMode") {
      return LOAD_MODE_META[row.loadMode] ? (
        <span className={`tag ${LOAD_MODE_META[row.loadMode].tone}`}>
          {LOAD_MODE_META[row.loadMode].label}
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
    return row[column.key] ?? "";
  };

  const exportCurrentTab = () => {
    if (tab === "field") {
      downloadCsv("字段映射_字段视图.csv", [
        fieldColumns.map((item) => item.label),
        ...pageRows.map((row) => fieldColumns.map((item) => row[item.key] || "")),
      ]);
      return;
    }

    downloadCsv("字段映射_表视图.csv", [
      orderedTableColumns.filter((item) => item.key !== "__actions").map((item) => item.label),
      ...sortedRows.map((row) => orderedTableColumns
        .filter((item) => item.key !== "__actions")
        .map((item) => (item.key === "loadMode"
          ? LOAD_MODE_META[row.loadMode]?.label ?? ""
          : row[item.key] ?? ""))),
    ]);
  };

  return (
    <div className="fm-page">
      <div className="page-head">
        <div>
          <div className="page-title"><Icon name="link" size={20} color="var(--ink-2)" />字段映射查询</div>
          <div className="page-sub">查询源字段与 DWF 字段之间的映射关系，支持字段维度和表维度查看。</div>
        </div>
      </div>

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
            {DIMENSION_TABS.map((item) => (
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
            <button className="btn" type="button" onClick={exportCurrentTab}>
              <Icon name="download" size={15} />
              导出 CSV
            </button>
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
        ) : !pageRows.length ? (
          <EmptyState title="暂无匹配记录" desc="可以调整查询条件，或者清空顶部搜索关键字后重试。" />
        ) : (
          <>
            <div className="fm-table-wrap">
              <table className="fm-table">
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
                          <th key={column.key} onClick={() => toggleSort(column.key)}>
                            <span>{column.label}{sortMarker(sort, column.key)}</span>
                          </th>
                        ))}
                        {targetColumns.map((column) => (
                          <th key={column.key} onClick={() => toggleSort(column.key)}>
                            <span>{column.label}{sortMarker(sort, column.key)}</span>
                          </th>
                        ))}
                      </>
                    ) : columns.map((column) => (
                      <th
                        key={column.key}
                        className={column.align === "right" ? "is-right" : ""}
                        onClick={column.sortable === false ? undefined : () => toggleSort(column.key)}
                      >
                        <span>{column.label}{column.sortable === false ? "" : sortMarker(sort, column.key)}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tab === "field" ? pageRows.map((row) => (
                    <tr key={`${row.srcSystem}-${row.srcTable}-${row.srcField}-${row.targetField}`}>
                      <td><span className="fm-system"><span className="fm-dot"></span>{row.srcSystem}</span></td>
                      <td className="mono">{row.srcTable}</td>
                      <td className="mono">{row.srcField}</td>
                      <td className="fm-muted mono">{row.srcType}</td>
                      <td>{row.srcComment ? row.srcComment : <span className="fm-empty">未填写</span>}</td>
                      <td className="fm-arrow-cell">
                        <span
                          className={isTransformRule(row.mappingRule) ? "fm-arrow is-transform" : "fm-arrow"}
                          title={isTransformRule(row.mappingRule) ? `需要转换：${row.mappingRule}` : "直接映射"}
                        >
                          →
                        </span>
                      </td>
                      <td className="mono">{row.targetTable}</td>
                      <td className="mono">{row.targetField || <span className="fm-empty">待补充</span>}</td>
                      <td><span className={`tag ${RULE_TAGS[row.mappingRule] || "tag-neutral"}`}>{row.mappingRule}</span></td>
                    </tr>
                  )) : pageRows.map((row) => (
                    <tr key={`${row.srcSystem}-${row.srcTable}`}>
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
            </div>

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
