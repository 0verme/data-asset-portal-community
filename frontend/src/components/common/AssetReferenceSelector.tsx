import React, { type ReactNode } from "react";

import { getAssetTables } from "../../api/assets.ts";
import { getIndicatorList } from "../../api/indicator.ts";
import { Icon } from "../ui.tsx";

type ReferenceRecord = Record<string, unknown>;

export interface TableReference extends ReferenceRecord {
  tableName: string;
  tableCn: string;
  domain: string;
  layer: string;
}

export interface IndicatorReference extends ReferenceRecord {
  indicatorId: string;
  indicatorName: string;
  dimension: string;
  path: string;
}

function uniqueBy<T extends ReferenceRecord>(
  items: readonly (T | null | undefined)[],
  key: keyof T,
): T[] {
  const values = new Map<unknown, T>();
  items.forEach((item) => {
    if (item) values.set(item[key], item);
  });
  return [...values.values()];
}

function isReferenceRecord(item: unknown): item is ReferenceRecord {
  return item !== null && typeof item === "object" && !Array.isArray(item);
}

function asRecord(item: unknown): ReferenceRecord {
  return isReferenceRecord(item) ? item : {};
}

function normalizeTable(item: unknown): TableReference | null {
  const record = asRecord(item);
  const tableName = String(record["tableName"] || record["targetCode"] || record["name"] || "").trim();
  return tableName
    ? {
        tableName,
        tableCn: String(record["tableCn"] || record["targetName"] || record["labelCn"] || record["cnName"] || record["description"] || ""),
        domain: String(record["domain"] || ""),
        layer: String(record["layer"] || record["dataLayer"] || record["schemaLayer"] || ""),
      }
    : null;
}

function normalizeIndicator(item: unknown): IndicatorReference | null {
  const record = asRecord(item);
  const indicatorId = String(record["indicatorId"] || record["targetCode"] || record["id"] || "").trim();
  return indicatorId
    ? {
        indicatorId,
        indicatorName: String(record["indicatorName"] || record["targetName"] || record["name"] || ""),
        dimension: String(record["dimension"] || ""),
        path: String(record["path"] || ""),
      }
    : null;
}

function itemValue<T extends ReferenceRecord>(item: T, key: keyof T): string {
  return String(item[key] ?? "");
}

interface ChipsProps<T extends ReferenceRecord> {
  items: readonly T[];
  itemKey: keyof T;
  labelKey: keyof T;
  onRemove: (key: string) => void;
  disabled: boolean;
  empty: ReactNode;
}

function Chips<T extends ReferenceRecord>({
  items,
  itemKey,
  labelKey,
  onRemove,
  disabled,
  empty,
}: ChipsProps<T>) {
  if (!items.length) return <div className="report-ref-empty">{empty}</div>;
  return (
    <div className="report-ref-chip-list">
      {items.map((item) => {
        const key = itemValue(item, itemKey);
        const label = itemValue(item, labelKey);
        return (
          <span key={key} className="tag tag-neutral mono">
            <span className="report-ref-chip-text">{label}</span>
            {!disabled && <button type="button" className="report-ref-chip-remove" onClick={() => onRemove(key)} aria-label={`移除 ${label}`}><Icon name="close" size={11} /></button>}
          </span>
        );
      })}
    </div>
  );
}

interface PickerProps<T extends ReferenceRecord> {
  title: string;
  items: readonly T[];
  candidates: readonly T[];
  itemKey: keyof T;
  labelKey: keyof T;
  subtitle: (item: T) => string;
  onChange: (items: T[]) => void;
  disabled: boolean;
  emptyText: string;
  searchValue?: string | undefined;
  onSearchChange?: ((value: string) => void) | undefined;
}

function Picker<T extends ReferenceRecord>({
  title,
  items,
  candidates,
  itemKey,
  labelKey,
  subtitle,
  onChange,
  disabled,
  emptyText,
  searchValue,
  onSearchChange,
}: PickerProps<T>) {
  const [localSearch, setLocalSearch] = React.useState("");
  const search = searchValue ?? localSearch;
  const setSearch = onSearchChange || setLocalSearch;
  const selected = new Set(items.map((item) => itemValue(item, itemKey)));
  const keyword = search.trim().toLowerCase();
  const filtered = candidates.filter((item) => !keyword || [itemValue(item, itemKey), itemValue(item, labelKey), subtitle(item)].some((value) => value.toLowerCase().includes(keyword)));
  const add = (item: T) => {
    if (!selected.has(itemValue(item, itemKey))) onChange([...items, item]);
  };
  const remove = (key: string) => onChange(items.filter((item) => itemValue(item, itemKey) !== key));

  return (
    <div className="report-picker">
      <div className="report-picker-head"><div className="report-picker-title">{title}</div><div className="report-picker-meta">已选 {items.length}</div></div>
      <Chips items={items} itemKey={itemKey} labelKey={labelKey} onRemove={remove} disabled={disabled} empty={`暂无${title}`} />
      <div className="report-picker-search"><Icon name="search" size={14} /><input value={search} disabled={disabled} onChange={(event) => setSearch(event.target.value)} aria-label={`搜索${title}`} placeholder={`搜索${title}`} /></div>
      <div className="report-picker-list">{filtered.length ? filtered.map((item) => {
        const key = itemValue(item, itemKey);
        return (
          <button key={key} type="button" disabled={disabled} className={`report-picker-item${selected.has(key) ? " selected" : ""}`} onClick={() => add(item)}>
            <span className="report-picker-item-title">{key}</span><span className="report-picker-item-sub">{subtitle(item) || "-"}</span>
          </button>
        );
      }) : <div className="report-ref-empty">{emptyText}</div>}</div>
    </div>
  );
}

export interface AssetReferencePickerProps<T extends ReferenceRecord> {
  title: string;
  searchValue?: string | undefined;
  onSearchChange?: ((value: string) => void) | undefined;
  candidates: readonly T[];
  selectedItems: readonly T[];
  itemKey: keyof T;
  titleKey: keyof T;
  subtitleBuilder: (item: T) => string;
  onAdd: (item: T) => void;
  onRemove: (key: string) => void;
  emptyText: string;
  disabled?: boolean | undefined;
}

export function AssetReferencePicker<T extends ReferenceRecord>({
  title,
  searchValue,
  onSearchChange,
  candidates,
  selectedItems,
  itemKey,
  titleKey,
  subtitleBuilder,
  onAdd,
  onRemove,
  emptyText,
  disabled = false,
}: AssetReferencePickerProps<T>) {
  return (
    <Picker
      title={title}
      items={selectedItems}
      candidates={candidates}
      itemKey={itemKey}
      labelKey={titleKey}
      subtitle={subtitleBuilder}
      disabled={disabled}
      emptyText={emptyText}
      searchValue={searchValue}
      onSearchChange={onSearchChange}
      onChange={(nextItems) => {
        const previous = new Set(selectedItems.map((item) => itemValue(item, itemKey)));
        const next = new Set(nextItems.map((item) => itemValue(item, itemKey)));
        const removed = selectedItems.find((item) => !next.has(itemValue(item, itemKey)));
        const added = nextItems.find((item) => !previous.has(itemValue(item, itemKey)));
        if (removed) onRemove(itemValue(removed, itemKey));
        else if (added) onAdd(added);
      }}
    />
  );
}

export interface AssetReferenceSelectorProps {
  selectedTables?: readonly ReferenceRecord[] | undefined;
  selectedIndicators?: readonly ReferenceRecord[] | undefined;
  onTablesChange: (items: TableReference[]) => void;
  onIndicatorsChange: (items: IndicatorReference[]) => void;
  disabled?: boolean | undefined;
  tableOptions?: readonly ReferenceRecord[] | undefined;
  indicatorOptions?: readonly ReferenceRecord[] | undefined;
  loading?: boolean | undefined;
  readonly?: boolean | undefined;
}

export function AssetReferenceSelector({
  selectedTables = [],
  selectedIndicators = [],
  onTablesChange,
  onIndicatorsChange,
  disabled = false,
  tableOptions,
  indicatorOptions,
  loading = false,
  readonly = false,
}: AssetReferenceSelectorProps) {
  const [options, setOptions] = React.useState<{
    tables: TableReference[];
    indicators: IndicatorReference[];
  }>({ tables: [], indicators: [] });
  const [error, setError] = React.useState("");
  const externalOptions = Array.isArray(tableOptions) || Array.isArray(indicatorOptions);

  React.useEffect(() => {
    if (externalOptions) return undefined;
    let cancelled = false;
    Promise.all([getAssetTables(), getIndicatorList()]).then(([tables, indicators]) => {
      if (!cancelled) {
        setOptions({
          tables: uniqueBy(tables.map(normalizeTable), "tableName"),
          indicators: uniqueBy(indicators.map(normalizeIndicator), "indicatorId"),
        });
      }
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : "关联资产加载失败。 ");
    });
    return () => { cancelled = true; };
  }, [externalOptions]);

  const tableCandidates = uniqueBy((Array.isArray(tableOptions) ? tableOptions : options.tables).map(normalizeTable), "tableName");
  const indicatorCandidates = uniqueBy((Array.isArray(indicatorOptions) ? indicatorOptions : options.indicators).map(normalizeIndicator), "indicatorId");
  const tables = uniqueBy(selectedTables.map(normalizeTable), "tableName").map((item) => {
    const match = tableCandidates.find((candidate) => candidate.tableName === item.tableName);
    return match ? { ...match, ...Object.fromEntries(Object.entries(item).filter(([, value]) => value)) } : item;
  });
  const indicators = uniqueBy(selectedIndicators.map(normalizeIndicator), "indicatorId").map((item) => {
    const match = indicatorCandidates.find((candidate) => candidate.indicatorId === item.indicatorId);
    return match ? { ...match, ...Object.fromEntries(Object.entries(item).filter(([, value]) => value)) } : item;
  });
  const locked = disabled || readonly;

  return (
    <>
      {error && <div className="match-hint" style={{ color: "var(--danger)" }}>{error}</div>}
      {loading && <div className="match-hint">正在加载可关联资产…</div>}
      <div className="report-picker-grid">
        <Picker title="关联表" items={tables} candidates={tableCandidates} itemKey="tableName" labelKey="tableName" subtitle={(item) => [item.layer, item.domain, item.tableCn].filter(Boolean).join(" / ")} onChange={onTablesChange} disabled={locked} emptyText="未找到关联表" />
        <Picker title="关联指标" items={indicators} candidates={indicatorCandidates} itemKey="indicatorId" labelKey="indicatorId" subtitle={(item) => [item.indicatorName, item.path].filter(Boolean).join(" / ")} onChange={onIndicatorsChange} disabled={locked} emptyText="未找到关联指标" />
      </div>
    </>
  );
}
