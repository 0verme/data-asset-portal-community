import React from "react";

import { getAssetTables } from "../../api/assets.js";
import { getIndicatorList } from "../../api/indicator.js";
import { Icon } from "../ui.jsx";

const uniqueBy = (items, key) => [...new Map(items.filter(Boolean).map((item) => [item[key], item])).values()];

function normalizeTable(item) {
  const tableName = String(item?.tableName || item?.targetCode || item?.name || "").trim();
  return tableName ? {
    tableName,
    tableCn: item?.tableCn || item?.targetName || item?.labelCn || item?.cnName || item?.description || "",
    domain: item?.domain || "",
    layer: item?.layer || item?.dataLayer || item?.schemaLayer || "",
  } : null;
}

function normalizeIndicator(item) {
  const indicatorId = String(item?.indicatorId || item?.targetCode || item?.id || "").trim();
  return indicatorId ? {
    indicatorId,
    indicatorName: item?.indicatorName || item?.targetName || item?.name || "",
    dimension: item?.dimension || "",
    path: item?.path || "",
  } : null;
}

function Chips({ items, itemKey, labelKey, onRemove, disabled, empty }) {
  if (!items.length) return <div className="report-ref-empty">{empty}</div>;
  return <div className="report-ref-chip-list">{items.map((item) => (
    <span key={item[itemKey]} className="tag tag-neutral mono">
      <span className="report-ref-chip-text">{item[labelKey]}</span>
      {!disabled && <button type="button" className="report-ref-chip-remove" onClick={() => onRemove(item[itemKey])} aria-label={`移除 ${item[labelKey]}`}><Icon name="close" size={11} /></button>}
    </span>
  ))}</div>;
}

function Picker({ title, items, candidates, itemKey, labelKey, subtitle, onChange, disabled, emptyText, searchValue, onSearchChange }) {
  const [localSearch, setLocalSearch] = React.useState("");
  const search = searchValue ?? localSearch;
  const setSearch = onSearchChange || setLocalSearch;
  const selected = new Set(items.map((item) => item[itemKey]));
  const keyword = search.trim().toLowerCase();
  const filtered = candidates.filter((item) => !keyword || [item[itemKey], item[labelKey], subtitle(item)].some((value) => String(value || "").toLowerCase().includes(keyword)));
  const add = (item) => { if (!selected.has(item[itemKey])) onChange([...items, item]); };
  const remove = (key) => onChange(items.filter((item) => item[itemKey] !== key));
  return <div className="report-picker">
    <div className="report-picker-head"><div className="report-picker-title">{title}</div><div className="report-picker-meta">已选 {items.length}</div></div>
    <Chips items={items} itemKey={itemKey} labelKey={labelKey} onRemove={remove} disabled={disabled} empty={`暂无${title}`} />
    <div className="report-picker-search"><Icon name="search" size={14} /><input value={search} disabled={disabled} onChange={(event) => setSearch(event.target.value)} placeholder={`搜索${title}`} /></div>
    <div className="report-picker-list">{filtered.length ? filtered.map((item) => <button key={item[itemKey]} type="button" disabled={disabled} className={`report-picker-item${selected.has(item[itemKey]) ? " selected" : ""}`} onClick={() => add(item)}>
      <span className="report-picker-item-title">{item[itemKey]}</span><span className="report-picker-item-sub">{subtitle(item) || "-"}</span>
    </button>) : <div className="report-ref-empty">{emptyText}</div>}</div>
  </div>;
}

export function AssetReferencePicker({ title, searchValue, onSearchChange, candidates, selectedItems, itemKey, titleKey, subtitleBuilder, onAdd, onRemove, emptyText, disabled = false }) {
  return <Picker title={title} items={selectedItems} candidates={candidates} itemKey={itemKey} labelKey={titleKey} subtitle={subtitleBuilder} disabled={disabled} emptyText={emptyText} searchValue={searchValue} onSearchChange={onSearchChange} onChange={(nextItems) => {
    const previous = new Set(selectedItems.map((item) => item[itemKey]));
    const next = new Set(nextItems.map((item) => item[itemKey]));
    const removed = selectedItems.find((item) => !next.has(item[itemKey]));
    const added = nextItems.find((item) => !previous.has(item[itemKey]));
    if (removed) onRemove(removed[itemKey]);
    else if (added) onAdd(added);
  }} />;
}

export function AssetReferenceSelector({ selectedTables, selectedIndicators, onTablesChange, onIndicatorsChange, disabled = false, tableOptions, indicatorOptions, loading = false, readonly = false }) {
  const [options, setOptions] = React.useState({ tables: [], indicators: [] });
  const [error, setError] = React.useState("");
  const externalOptions = Array.isArray(tableOptions) || Array.isArray(indicatorOptions);
  React.useEffect(() => {
    if (externalOptions) return undefined;
    let cancelled = false;
    Promise.all([getAssetTables(), getIndicatorList()]).then(([tables, indicators]) => {
      if (!cancelled) setOptions({ tables: uniqueBy(tables.map(normalizeTable), "tableName"), indicators: uniqueBy(indicators.map(normalizeIndicator), "indicatorId") });
    }).catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "关联资产加载失败。 "); });
    return () => { cancelled = true; };
  }, [externalOptions]);
  const tableCandidates = uniqueBy((Array.isArray(tableOptions) ? tableOptions : options.tables).map(normalizeTable), "tableName");
  const indicatorCandidates = uniqueBy((Array.isArray(indicatorOptions) ? indicatorOptions : options.indicators).map(normalizeIndicator), "indicatorId");
  const tables = uniqueBy((selectedTables || []).map(normalizeTable), "tableName").map((item) => {
    const match = tableCandidates.find((candidate) => candidate.tableName === item.tableName);
    return match ? { ...match, ...Object.fromEntries(Object.entries(item).filter(([, value]) => value)) } : item;
  });
  const indicators = uniqueBy((selectedIndicators || []).map(normalizeIndicator), "indicatorId").map((item) => {
    const match = indicatorCandidates.find((candidate) => candidate.indicatorId === item.indicatorId);
    return match ? { ...match, ...Object.fromEntries(Object.entries(item).filter(([, value]) => value)) } : item;
  });
  const locked = disabled || readonly;
  return <>
    {error && <div className="match-hint" style={{ color: "var(--danger)" }}>{error}</div>}
    {loading && <div className="match-hint">正在加载可关联资产…</div>}
    <div className="report-picker-grid">
      <Picker title="关联表" items={tables} candidates={tableCandidates} itemKey="tableName" labelKey="tableName" subtitle={(item) => [item.layer, item.domain, item.tableCn].filter(Boolean).join(" / ")} onChange={onTablesChange} disabled={locked} emptyText="未找到关联表" />
      <Picker title="关联指标" items={indicators} candidates={indicatorCandidates} itemKey="indicatorId" labelKey="indicatorId" subtitle={(item) => [item.indicatorName, item.path].filter(Boolean).join(" / ")} onChange={onIndicatorsChange} disabled={locked} emptyText="未找到关联指标" />
    </div>
  </>;
}
