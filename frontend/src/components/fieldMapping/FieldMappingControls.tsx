import type { ChangeEventHandler, ReactNode } from "react";

import type { FieldMappingSourceSystemOption, FieldMappingStats } from "../../api/fieldMapping.ts";
import { Icon } from "../ui.tsx";
import {
  formatSystemLabel,
  getSourceSystemId,
  type FieldMappingFilters,
} from "./fieldMappingUtils.ts";

interface StatCardProps {
  label: string;
  value: ReactNode;
  hint: ReactNode;
}

function StatCard({ label, value, hint }: StatCardProps) {
  return (
    <div className="fm-stat-card">
      <div className="fm-stat-value">{value}</div>
      <div className="fm-stat-label">{label}</div>
      <div className="fm-stat-hint">{hint}</div>
    </div>
  );
}

export interface FieldMappingStatsProps {
  stats?: FieldMappingStats | null | undefined;
}

export function FieldMappingStats({ stats }: FieldMappingStatsProps) {
  return (
    <div className="fm-stats">
      <StatCard
        label="源系统"
        value={stats?.sourceSystemCount ?? "-"}
        hint="已纳管映射来源"
      />
      <StatCard
        label="表维度"
        value={stats?.sourceTableCount ?? "-"}
        hint="参与映射的全量表数"
      />
      <StatCard
        label="字段维度"
        value={stats?.fieldCount ?? "-"}
        hint="字段映射明细总数"
      />
      <StatCard
        label="已映射"
        value={stats?.mappedFieldCount ?? "-"}
        hint={`覆盖率 ${stats?.coverage ?? 0}%`}
      />
      <StatCard
        label="待补充"
        value={stats?.unmappedFieldCount ?? "-"}
        hint="目标字段尚未落位"
      />
      <StatCard
        label="空注释"
        value={stats?.emptyCommentCount ?? "-"}
        hint="源字段注释缺失"
      />
    </div>
  );
}

type FieldMappingFilterField = keyof FieldMappingFilters;
type FieldMappingChangeHandler = ChangeEventHandler<
  HTMLInputElement | HTMLSelectElement
>;

export interface FieldMappingFiltersProps {
  open: boolean;
  draftFilters: FieldMappingFilters;
  sourceSystems: readonly FieldMappingSourceSystemOption[];
  onToggle: () => void;
  onChange: (key: FieldMappingFilterField) => FieldMappingChangeHandler;
  onReset: () => void;
  onApply: () => void;
}

export function FieldMappingFilters({
  open,
  draftFilters,
  sourceSystems,
  onToggle,
  onChange,
  onReset,
  onApply,
}: FieldMappingFiltersProps) {
  return (
    <section className="fm-card">
      <div className="fm-card-head">
        <div className="fm-card-title">
          <Icon name="filter" size={15} color="var(--ink-2)" />
          查询条件
        </div>
        <button className="fm-toggle" type="button" onClick={onToggle}>
          {open ? "收起" : "展开"}
          <Icon name="chevron" size={14} />
        </button>
      </div>

      {open ? (
        <>
          <div className="fm-filter-grid">
            <label className="fm-field">
              <span>源系统</span>
              <select
                className="sel"
                value={draftFilters.sourceSystemId}
                onChange={onChange("sourceSystemId")}
              >
                <option value="">全部</option>
                {sourceSystems.map((item) => {
                  const sourceSystemId = getSourceSystemId(item);
                  return (
                    <option
                      key={String(sourceSystemId)}
                      value={String(sourceSystemId)}
                    >
                      {formatSystemLabel(item)}
                    </option>
                  );
                })}
              </select>
            </label>
            <label className="fm-field">
              <span>源系统表名</span>
              <input
                className="inp mono"
                value={draftFilters.srcTable}
                onChange={onChange("srcTable")}
                placeholder="例如：MEMBER_PROFILE"
              />
            </label>
            <label className="fm-field">
              <span>源字段名</span>
              <input
                className="inp mono"
                value={draftFilters.srcField}
                onChange={onChange("srcField")}
                placeholder="例如：ACCT_NO"
              />
            </label>
            <label className="fm-field">
              <span>注释是否为空</span>
              <select
                className="sel"
                value={draftFilters.emptyComment}
                onChange={onChange("emptyComment")}
              >
                <option value="">全部</option>
                <option value="yes">注释为空</option>
                <option value="no">注释不为空</option>
              </select>
            </label>
            <label className="fm-field">
              <span>DWF 表名</span>
              <input
                className="inp mono"
                value={draftFilters.targetTable}
                onChange={onChange("targetTable")}
                placeholder="例如：DWD_TRADE_ORDER"
              />
            </label>
            <label className="fm-field">
              <span>DWF 字段名</span>
              <input
                className="inp mono"
                value={draftFilters.targetField}
                onChange={onChange("targetField")}
                placeholder="例如：account_no"
              />
            </label>
          </div>
          <div className="fm-actions">
            <button className="btn" type="button" onClick={onReset}>
              重置
            </button>
            <button className="btn primary" type="button" onClick={onApply}>
              <Icon name="search" size={15} color="#fff" />
              查询
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}
