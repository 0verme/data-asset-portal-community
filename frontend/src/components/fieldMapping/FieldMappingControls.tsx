import type { ChangeEventHandler, ReactNode } from "react";
import { useTranslation } from "react-i18next";

import type { FieldMappingStats } from "../../api/fieldMapping.ts";
import { Icon } from "../ui.tsx";
import { Button, Input, Tooltip } from "../../ui/index.ts";
import type { FieldMappingFilters } from "./fieldMappingUtils.ts";
import {
  fieldMappingStatDisplayValue,
  fieldMappingStatsDisplayHint,
  type FieldMappingStatsStatus,
} from "./fieldMappingStatsState.ts";

type FieldMappingStatHintKey = "sourceSystems" | "tables" | "fields" | "pending" | "emptyComments";

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
  const { t } = useTranslation("fieldMapping");
  const value = (count: number | undefined) =>
    fieldMappingStatDisplayValue(count, status);
  const hint = (key: FieldMappingStatHintKey) => status === "ready"
    ? fieldMappingStatsDisplayHint(status, t(`stats.hints.${key}`))
    : t(`stats.${status === "unknown" ? "waiting" : status}`);

  return (
    <div className="fm-stats">
      <StatCard
        label={t("stats.labels.sourceSystems")}
        value={value(stats?.sourceSystemCount)}
        hint={hint("sourceSystems")}
      />
      <StatCard
        label={t("stats.labels.tables")}
        value={value(stats?.sourceTableCount)}
        hint={hint("tables")}
      />
      <StatCard
        label={t("stats.labels.fields")}
        value={value(stats?.fieldCount)}
        hint={hint("fields")}
      />
      <StatCard
        label={t("stats.labels.mapped")}
        value={value(stats?.mappedFieldCount)}
        hint={stats ? t("stats.coverage", { value: stats.coverage }) : hint("fields")}
      />
      <StatCard
        label={t("stats.labels.pending")}
        value={value(stats?.unmappedFieldCount)}
        hint={hint("pending")}
      />
      <StatCard
        label={t("stats.labels.emptyComments")}
        value={value(stats?.emptyCommentCount)}
        hint={hint("emptyComments")}
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
  const { t } = useTranslation("fieldMapping");
  return (
    <section className="fm-card">
      <div className="fm-card-head">
        <div className="fm-card-title">
          <Icon name="filter" size={15} color="var(--ink-2)" />
          {t("filters.title")}
        </div>
        <button className="fm-toggle" type="button" onClick={onToggle}>
          {open ? t("filters.collapse") : t("filters.expand")}
          <Icon name="chevron" size={14} />
        </button>
      </div>

      {open ? (
        <>
          <div className="fm-filter-grid">
            <label className="fm-field">
              <span>{t("filters.sourceTable")}</span>
              <Input
                aria-label={t("filters.sourceTable")}
                className="inp mono"
                value={draftFilters.srcTable}
                onChange={onChange("srcTable")}
                placeholder={t("filters.sourceTablePlaceholder")}
              />
            </label>
            <label className="fm-field">
              <span>{t("filters.sourceField")}</span>
              <Input
                aria-label={t("filters.sourceField")}
                className="inp mono"
                value={draftFilters.srcField}
                onChange={onChange("srcField")}
                placeholder={t("filters.sourceFieldPlaceholder")}
              />
            </label>
            <label className="fm-field">
              <span>{t("filters.targetTable")}</span>
              <Input
                aria-label={t("filters.targetTable")}
                className="inp mono"
                value={draftFilters.targetTable}
                onChange={onChange("targetTable")}
                placeholder={t("filters.targetTablePlaceholder")}
              />
            </label>
            <label className="fm-field">
              <span>{t("filters.targetField")}</span>
              <Input
                aria-label={t("filters.targetField")}
                className="inp mono"
                value={draftFilters.targetField}
                onChange={onChange("targetField")}
                placeholder={t("filters.targetFieldPlaceholder")}
              />
            </label>
          </div>
          <div className="fm-actions">
            <label className="fm-field fm-optional-filter">
              <span>{t("filters.emptyComment")}</span>
              <select
                className="sel"
                value={draftFilters.emptyComment}
                onChange={onChange("emptyComment")}
              >
                <option value="">{t("filters.all")}</option>
                <option value="yes">{t("filters.commentEmpty")}</option>
                <option value="no">{t("filters.commentPresent")}</option>
              </select>
            </label>
            <Tooltip
              trigger={(
                <button className="fm-help-trigger" type="button" aria-label={t("filters.helpLabel")}>
                  <Icon name="info" size={15} />
                </button>
              )}
              content={t("filters.help")}
            />
            <Button className="btn" variant="secondary" type="button" onClick={onReset}>
              {t("filters.reset")}
            </Button>
            <Button className="btn primary" variant="primary" type="button" onClick={onApply}>
              <Icon name="search" size={15} color="#fff" />
              {t("filters.apply")}
            </Button>
          </div>
        </>
      ) : null}
    </section>
  );
}
