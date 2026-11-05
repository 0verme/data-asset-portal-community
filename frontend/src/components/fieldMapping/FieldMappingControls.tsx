import type { ChangeEventHandler, ReactNode } from "react";

import type { FieldMappingStats } from "../../api/fieldMapping.ts";
import { Icon } from "../ui.tsx";
import { Button, Input, Tooltip } from "../../ui/index.ts";
import type { FieldMappingFilters } from "./fieldMappingUtils.ts";
import {
  fieldMappingStatDisplayValue,
  fieldMappingStatsDisplayHint,
  type FieldMappingStatsStatus,
} from "./fieldMappingStatsState.ts";

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
  status?: FieldMappingStatsStatus | undefined;
}

export function FieldMappingStats({
  stats,
  status = stats ? "ready" : "unknown",
}: FieldMappingStatsProps) {
  const value = (count: number | undefined) =>
    fieldMappingStatDisplayValue(count, status);
  const hint = (readyHint: string) =>
    fieldMappingStatsDisplayHint(status, readyHint);

  return (
    <div className="fm-stats">
      <StatCard
        label="源系统"
        value={value(stats?.sourceSystemCount)}
        hint={hint("已纳管映射来源")}
      />
      <StatCard
        label="表维度"
        value={value(stats?.sourceTableCount)}
        hint={hint("参与映射的全量表数")}
      />
      <StatCard
        label="字段维度"
        value={value(stats?.fieldCount)}
        hint={hint("字段映射明细总数")}
      />
      <StatCard
        label="已映射"
        value={value(stats?.mappedFieldCount)}
        hint={stats ? `覆盖率 ${stats.coverage}%` : hint("")}
      />
      <StatCard
        label="待补充"
        value={value(stats?.unmappedFieldCount)}
        hint={hint("目标字段尚未落位")}
      />
      <StatCard
        label="空注释"
        value={value(stats?.emptyCommentCount)}
        hint={hint("源字段注释缺失")}
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
  onToggle: () => void;
  onChange: (key: FieldMappingFilterField) => FieldMappingChangeHandler;
  onReset: () => void;
  onApply: () => void;
}

export function FieldMappingFilters({
  open,
  draftFilters,
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
              <span>源系统表名</span>
              <Input
                aria-label="源系统表名"
                className="inp mono"
                value={draftFilters.srcTable}
                onChange={onChange("srcTable")}
                placeholder="例如：MEMBER_PROFILE"
              />
            </label>
            <label className="fm-field">
              <span>源字段名</span>
              <Input
                aria-label="源字段名"
                className="inp mono"
                value={draftFilters.srcField}
                onChange={onChange("srcField")}
                placeholder="例如：ACCT_NO"
              />
            </label>
            <label className="fm-field">
              <span>DWF 表名</span>
              <Input
                aria-label="DWF 表名"
                className="inp mono"
                value={draftFilters.targetTable}
                onChange={onChange("targetTable")}
                placeholder="例如：DWD_TRADE_ORDER"
              />
            </label>
            <label className="fm-field">
              <span>DWF 字段名</span>
              <Input
                aria-label="DWF 字段名"
                className="inp mono"
                value={draftFilters.targetField}
                onChange={onChange("targetField")}
                placeholder="例如：account_no"
              />
            </label>
          </div>
          <div className="fm-actions">
            <label className="fm-field fm-optional-filter">
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
            <Tooltip
              trigger={(
                <button className="fm-help-trigger" type="button" aria-label="查询帮助">
                  <Icon name="info" size={15} />
                </button>
              )}
              content="输入源系统表名、源字段名、DWF 表名或 DWF 字段名后点击查询；也可在左侧选择源系统即时筛选。注释条件用于定位源字段注释为空或不为空的记录。重置会清空查询条件并恢复全部源系统。"
            />
            <Button className="btn" variant="secondary" type="button" onClick={onReset}>
              重置
            </Button>
            <Button className="btn primary" variant="primary" type="button" onClick={onApply}>
              <Icon name="search" size={15} color="#fff" />
              查询
            </Button>
          </div>
        </>
      ) : null}
    </section>
  );
}
