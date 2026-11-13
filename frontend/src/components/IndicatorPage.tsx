import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import type { IndicatorDimensionOption, MockIndicatorItem } from "../data/indicators.ts";
import {
  findIndicatorDimensionOption,
  indicatorDimensionCodeLabel,
  indicatorDimensionLabel,
} from "../data/indicatorDimensions.ts";
import type { IndicatorFilter } from "../routing/types.ts";
import { formatDate, formatDateTime } from "../utils/date.ts";
import { ActionErrorBanner, CardGridView, EmptyState, GroupView, RowActions, StatusBadge, ViewModeSwitcher, WideTableScroll } from "./common/index.ts";
import type { ViewMode } from "./common/ViewModeSwitcher.tsx";
import { Highlight, Icon, initial } from "./ui.tsx";
import { Button } from "../ui/index.ts";

type IndicatorT = TFunction<"indicator">;

function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function displayValue(value: unknown): string {
  return isPresent(value) ? String(value) : "-";
}

function DimensionBadge({
  dimension,
  dimensionOptions,
}: {
  dimension: string;
  dimensionOptions: readonly IndicatorDimensionOption[];
}) {
  const option = findIndicatorDimensionOption(dimensionOptions, dimension);
  // Unknown codes fall back to their own code instead of being hidden as "-".
  const label = option?.label || indicatorDimensionLabel(dimension);
  const code = option?.code || indicatorDimensionCodeLabel(dimension);
  return (
    <span className="tag tag-neutral">
      <span className="indicator-dim-code">{code}</span>
      {label}
    </span>
  );
}

function IndicatorStatusBadge({ status }: { status: unknown }) {
  const { t } = useTranslation("indicator");
  return (
    <StatusBadge
      status={status}
      metaMap={{
        enabled: { label: t("status.enabled"), className: "st-on" },
        disabled: { label: t("status.disabled"), className: "st-off" },
      }}
    />
  );
}

interface DetailItemProps {
  label: string;
  value?: unknown;
  type?: "text" | "mono";
  full?: boolean;
  fallback?: boolean;
}

function DetailItem({ label, value, type = "text", full = false, fallback = false }: DetailItemProps) {
  if (!fallback && !isPresent(value)) return null;
  return (
    <div className={`indicator-detail-item${full ? " full" : ""}`}>
      <div className="indicator-detail-label">{label}</div>
      <div className={`indicator-detail-value${type === "mono" ? " mono" : ""}`}>{displayValue(value)}</div>
    </div>
  );
}

interface AdditionalField {
  key: string;
  label: string;
  value: string;
}

function getAdditionalFields(indicator: MockIndicatorItem, t: IndicatorT): AdditionalField[] {
  const knownKeys = new Set([
    "id",
    "name",
    "meaning",
    "resultTableName",
    "resultFieldName",
    "sourceAssetId",
    "sourceAssetName",
    "sourceAssetQualifiedName",
    "resultFieldId",
    "aggregation",
    "semanticState",
    "dimension",
    "caliber",
    "path",
    "status",
    "registrar",
    "registeredAt",
  ]);
  const labelMap: Record<string, string> = {
    englishName: t("detail.metaLabels.englishName"),
    enName: t("detail.metaLabels.enName"),
    tags: t("detail.metaLabels.tags"),
    tag: t("detail.metaLabels.tag"),
    source: t("detail.metaLabels.source"),
    sourceSystem: t("detail.metaLabels.sourceSystem"),
    remark: t("detail.metaLabels.remark"),
    remarks: t("detail.metaLabels.remarks"),
    createdAt: t("detail.metaLabels.createdAt"),
    updatedAt: t("detail.metaLabels.updatedAt"),
  };

  return Object.entries(indicator)
    .filter(([key, value]) => !knownKeys.has(key) && isPresent(value))
    .map(([key, value]) => ({
      key,
      label: labelMap[key] || key,
      value: Array.isArray(value)
        ? value.join("、")
        : key === "createdAt" || key === "updatedAt"
          ? formatDateTime(value)
          : String(value),
    }));
}

export interface MetricDetailDrawerProps {
  indicator: MockIndicatorItem | null;
  open: boolean;
  onClose: () => void;
  dimensionOptions: readonly IndicatorDimensionOption[];
}

export function MetricDetailDrawer({ indicator, open, onClose, dimensionOptions }: MetricDetailDrawerProps) {
  const { t } = useTranslation("indicator");
  if (!open || !indicator) return null;
  const additionalFields = getAdditionalFields(indicator, t);

  return (
    <div className="indicator-detail-shell" role="presentation" onMouseDown={onClose}>
      <aside
        className="indicator-detail-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="indicator-detail-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="indicator-detail-head">
          <div>
            <div className="editor-title">
              <Icon name="eye" size={20} color="var(--ink-2)" />
              <h2 id="indicator-detail-title">{t("detail.title")}</h2>
            </div>
            <div className="editor-sub">{t("detail.subtitle")}</div>
          </div>
          <Button className="btn" variant="secondary" type="button" onClick={onClose} aria-label={t("detail.close")}>
            <Icon name="close" size={14} />{t("detail.closeButton")}
          </Button>
        </div>

        <div className="indicator-detail-body">
          <div className="form-card">
            <h3><Icon name="hash" size={14} />{t("detail.basicInfo")}</h3>
            <div className="indicator-detail-grid">
              <DetailItem label={t("detail.id")} value={indicator.id} type="mono" />
              <DetailItem label={t("detail.name")} value={indicator.name} />
              <DetailItem label={t("detail.registrar")} value={indicator.registrar} />
              <DetailItem label={t("detail.registeredAt")} value={formatDate(indicator.registeredAt)} type="mono" />
            </div>
          </div>

          <div className="form-card">
            <h3><Icon name="layers" size={14} />{t("detail.dimensionStatus")}</h3>
            <div className="indicator-detail-grid">
              <div className="indicator-detail-item">
                <div className="indicator-detail-label">{t("detail.dimension")}</div>
                <div className="indicator-detail-value"><DimensionBadge dimension={indicator.dimension} dimensionOptions={dimensionOptions} /></div>
              </div>
              <div className="indicator-detail-item">
                <div className="indicator-detail-label">{t("detail.status")}</div>
                <div className="indicator-detail-value"><IndicatorStatusBadge status={indicator.status} /></div>
              </div>
              <DetailItem label={t("detail.semanticState")} value={indicator.semanticState} />
            </div>
          </div>

          <div className="form-card">
            <h3><Icon name="info" size={14} />{t("detail.caliberInfo")}</h3>
            <div className="indicator-detail-grid">
              <DetailItem label={t("detail.meaning")} value={indicator.meaning} full fallback />
              <DetailItem label={t("detail.sourceAsset")} value={indicator.sourceAssetName || indicator.sourceAssetQualifiedName} fallback />
              <DetailItem label={t("detail.resultTableSnapshot")} value={indicator.resultTableName} type="mono" fallback />
              <DetailItem label={t("detail.resultField")} value={indicator.resultFieldName} type="mono" fallback />
              <DetailItem label={t("detail.aggregation")} value={indicator.aggregation} type="mono" fallback />
              <DetailItem label={t("detail.caliber")} value={indicator.caliber} fallback />
              <DetailItem label={t("detail.path")} value={indicator.path} type="mono" full fallback />
            </div>
          </div>

          {additionalFields.length ? (
            <div className="form-card">
              <h3><Icon name="book" size={14} />{t("detail.extendedInfo")}</h3>
              <div className="indicator-detail-grid">
                {additionalFields.map((field) => (
                  <DetailItem
                    key={field.key}
                    label={field.label}
                    value={field.value}
                    full={field.value.length > 42}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div className="indicator-detail-foot">
          <Button className="btn" variant="secondary" type="button" onClick={onClose}>
            <Icon name="close" size={14} />{t("detail.closeButton")}
          </Button>
        </div>
      </aside>
    </div>
  );
}

interface IndicatorFilterChip {
  key: "dimension" | "status" | "query";
  label: string;
}

function buildFilterChips(
  filter: IndicatorFilter,
  query: string,
  dimensionOptions: readonly IndicatorDimensionOption[],
  t: IndicatorT,
): IndicatorFilterChip[] {
  const chips: IndicatorFilterChip[] = [];
  const dimensionMeta = findIndicatorDimensionOption(dimensionOptions, filter.dimension);

  if (filter.dimension && filter.dimension !== "all" && dimensionMeta) {
    chips.push({ key: "dimension", label: t("filters.dimension", { dimension: dimensionMeta.label }) });
  }
  if (filter.status && filter.status !== "all") {
    chips.push({ key: "status", label: t("filters.status", { status: t(filter.status === "enabled" ? "status.enabled" : "status.disabled") }) });
  }
  if (query) {
    chips.push({ key: "query", label: t("filters.query", { query }) });
  }
  return chips;
}

interface IndicatorFilterBarProps {
  filter: IndicatorFilter;
  query: string;
  dimensionOptions: readonly IndicatorDimensionOption[];
  onClearDimension: () => void;
  onClearStatus: () => void;
  onClearQuery: () => void;
  onReset: () => void;
}

function IndicatorFilterBar({ filter, query, dimensionOptions, onClearDimension, onClearStatus, onClearQuery, onReset }: IndicatorFilterBarProps) {
  const { t } = useTranslation("indicator");
  const chips = buildFilterChips(filter, query, dimensionOptions, t);

  if (!chips.length) return null;

  return (
    <div className="filter-bar">
      <span className="fb-label">{t("filters.label")}</span>
      {chips.map((item) => (
        <span key={item.key} className="chip-active">
          {item.label}
          <button
            type="button"
            onClick={
              item.key === "dimension"
                ? onClearDimension
                : item.key === "status"
                  ? onClearStatus
                  : onClearQuery
            }
          >
            <Icon name="close" size={12} />
          </button>
        </span>
      ))}
      <button className="clear-all" type="button" onClick={onReset}>{t("filters.clearAll")}</button>
    </div>
  );
}

interface IndicatorTableProps {
  indicators: readonly MockIndicatorItem[];
  query: string;
  dimensionOptions: readonly IndicatorDimensionOption[];
  pendingIds?: readonly string[] | undefined;
  canEdit: boolean;
  onView: (indicatorId: string) => void;
  onEdit: (indicatorId: string) => void;
  onToggleStatus: (indicator: MockIndicatorItem) => void | Promise<unknown>;
}

function IndicatorTable({ indicators, query, dimensionOptions, pendingIds = [], canEdit, onView, onEdit, onToggleStatus }: IndicatorTableProps) {
  const { t } = useTranslation("indicator");
  if (!indicators.length) return <EmptyState title={t("table.emptyTitle")} desc={t("table.emptyDescription")} />;

  return (
    <div className="tbl-wrap indicator-tbl">
      <WideTableScroll ariaLabel={t("table.ariaLabel")} className="indicator-wide-scroll">
        <table className="dt mobile-card-table indicator-wide-table">
        <thead>
          <tr>
            <th style={{ width: 148 }}>{t("table.id")}</th>
            <th>{t("table.nameMeaning")}</th>
            <th style={{ width: 140 }}>{t("table.dimension")}</th>
            <th style={{ width: 250 }}>{t("table.caliberPath")}</th>
            <th style={{ width: 96 }}>{t("table.status")}</th>
            <th style={{ width: 96 }}>{t("table.registrar")}</th>
            <th style={{ width: 118 }}>{t("table.registeredAt")}</th>
            <th style={{ width: 220, textAlign: "right" }}>{t("table.actions")}</th>
          </tr>
        </thead>
        <tbody>
          {indicators.map((item) => {
            const pending = pendingIds.includes(item.id);
            return (
              <tr key={item.id}>
                <td data-label={t("table.id")}>
                  <div className="indicator-id-cell">
                    <Icon name="hash" size={14} color="var(--ink-3)" />
                    <span className="indicator-id mono"><Highlight text={item.id} q={query} /></span>
                  </div>
                </td>
                <td data-label={t("table.meaning")}>
                  <button className="indicator-summary-btn" type="button" onClick={() => onView(item.id)}>
                    <span className="indicator-name"><Highlight text={item.name} q={query} /></span>
                    <span className="indicator-meaning"><Highlight text={item.meaning} q={query} /></span>
                  </button>
                </td>
                <td data-label={t("table.dimension")}><DimensionBadge dimension={item.dimension} dimensionOptions={dimensionOptions} /></td>
                <td data-label={t("table.caliberPathMobile")}>
                  <div className="indicator-caliber"><Highlight text={displayValue(item.caliber)} q={query} /></div>
                  <div className="indicator-path mono"><Highlight text={displayValue(item.path)} q={query} /></div>
                </td>
                <td data-label={t("table.status")}><IndicatorStatusBadge status={item.status} /></td>
                <td data-label={t("table.registrar")}>{item.registrar}</td>
                <td data-label={t("table.registeredAt")} className="mono indicator-date">{formatDate(item.registeredAt)}</td>
                <td data-label={t("table.actions")} className="mobile-card-actions" style={{ textAlign: "right" }}>
                  <RowActions
                    disabled={pending}
                    onView={() => onView(item.id)}
                    onEdit={canEdit ? () => onEdit(item.id) : undefined}
                    toggle={canEdit ? {
                      enabled: item.status === "enabled",
                      label: item.id,
                      onToggle: () => onToggleStatus(item),
                    } : undefined}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
        </table>
      </WideTableScroll>
    </div>
  );
}

interface IndicatorCardLayoutProps {
  indicators: readonly MockIndicatorItem[];
  query: string;
  dimensionOptions: readonly IndicatorDimensionOption[];
  onView: (indicatorId: string) => void;
}

function IndicatorCardLayout({ indicators, query, dimensionOptions, onView }: IndicatorCardLayoutProps) {
  return (
    <CardGridView
      items={indicators}
      getKey={(item) => item.id}
      onItemClick={(item) => onView(item.id)}
      renderBadges={(item) => (
        <>
          <DimensionBadge dimension={item.dimension} dimensionOptions={dimensionOptions} />
          <IndicatorStatusBadge status={item.status} />
        </>
      )}
      renderTitle={(item) => <Highlight text={item.name} q={query} />}
      renderSubtitle={(item) => <Highlight text={item.id} q={query} />}
      renderDesc={(item) => item.meaning}
      renderFootLeft={(item) => (
        <div className="t-owner" style={{ fontSize: 12.5 }}>
          <span className="mini-av" style={{ width: 22, height: 22 }}>{initial(item.registrar)}</span>
          <span style={{ color: "var(--ink-2)" }}>{item.registrar}</span>
        </div>
      )}
      renderFootMeta={(item) => (
        <span className="m"><Icon name="info" size={13} />{displayValue(item.caliber)}</span>
      )}
    />
  );
}

interface IndicatorGroupLayoutProps {
  indicators: readonly MockIndicatorItem[];
  query: string;
  dimensionOptions: readonly IndicatorDimensionOption[];
  onView: (indicatorId: string) => void;
}

function IndicatorGroupLayout({ indicators, query, dimensionOptions, onView }: IndicatorGroupLayoutProps) {
  const { t } = useTranslation("indicator");
  return (
    <GroupView
      items={indicators}
      getKey={(item) => item.id}
      onItemClick={(item) => onView(item.id)}
      groupBy={(item) => item.dimension}
      groupOrder={dimensionOptions.map((item) => item.value)}
      renderGroupLabel={(dimension) => (
        <DimensionBadge dimension={dimension} dimensionOptions={dimensionOptions} />
      )}
      renderGroupCount={(count) => t("table.groupCount", { count })}
      renderCardName={(item) => <Highlight text={item.id} q={query} />}
      renderCardBody={(item) => (
        <>
          <span><Highlight text={item.name} q={query} /></span>
          <span className="gc-owner">{item.registrar} · {displayValue(item.caliber)}</span>
        </>
      )}
    />
  );
}

export interface IndicatorPageProps {
  indicators: readonly MockIndicatorItem[];
  allIndicators: readonly MockIndicatorItem[];
  total?: number | undefined;
  overallCount?: number | undefined;
  query: string;
  actionError: string;
  filter: IndicatorFilter;
  view: ViewMode;
  pendingIds: readonly string[];
  dimensionOptions: readonly IndicatorDimensionOption[];
  canEdit?: boolean | undefined;
  detailIndicator: MockIndicatorItem | null;
  onChangeView: (view: ViewMode) => void;
  onNew: () => void;
  onView: (indicatorId: string) => void;
  onCloseDetail: () => void;
  onEdit: (indicatorId: string) => void;
  onToggleStatus: (indicator: MockIndicatorItem) => void | Promise<unknown>;
  onClearActionError: () => void;
  onClearDimension: () => void;
  onClearStatus: () => void;
  onClearQuery: () => void;
  onResetFilters: () => void;
}

export function IndicatorPage({
  indicators,
  allIndicators,
  total = indicators.length,
  overallCount = allIndicators.length,
  query,
  actionError,
  filter,
  view,
  pendingIds,
  dimensionOptions,
  canEdit = false,
  detailIndicator,
  onChangeView,
  onNew,
  onView,
  onCloseDetail,
  onEdit,
  onToggleStatus,
  onClearActionError,
  onClearDimension,
  onClearStatus,
  onClearQuery,
  onResetFilters,
}: IndicatorPageProps) {
  const { t } = useTranslation("indicator");
  const activeDimension = findIndicatorDimensionOption(dimensionOptions, filter.dimension);
  const hasActiveDimension = Boolean(activeDimension && activeDimension.value !== "all");

  return (
    <div className="indicator-page">
      <div className="page-head">
        <div>
          <div className="page-title"><span className="pt-code">{t("page.code")}</span>{t("page.title")}</div>
          <div className="page-sub">
            {t("page.summaryTotal", { count: total })}
            {dimensionOptions.length ? t("page.coverage", { count: dimensionOptions.length }) : null}
            {hasActiveDimension && activeDimension ? t("page.currentDimension", { dimension: activeDimension.label }) : null}
            {overallCount !== total ? t("page.overallCount", { count: overallCount }) : null}
          </div>
        </div>
        <div className="head-actions">
          <ViewModeSwitcher value={view} onChange={onChangeView} />
          {canEdit ? <Button className="btn primary" variant="primary" type="button" onClick={onNew}>
            <Icon name="plus" size={15} />{t("page.create")}
          </Button> : null}
        </div>
      </div>

      <IndicatorFilterBar
        filter={filter}
        query={query}
        dimensionOptions={dimensionOptions}
        onClearDimension={onClearDimension}
        onClearStatus={onClearStatus}
        onClearQuery={onClearQuery}
        onReset={onResetFilters}
      />

      <ActionErrorBanner message={actionError} onClose={onClearActionError} />

      {view === "list" ? (
        <IndicatorTable
          indicators={indicators}
          query={query}
          dimensionOptions={dimensionOptions}
          pendingIds={pendingIds}
          canEdit={canEdit}
          onView={onView}
          onEdit={onEdit}
          onToggleStatus={onToggleStatus}
        />
      ) : !indicators.length ? (
        <EmptyState title={t("table.emptyTitle")} desc={t("table.emptyDescription")} />
      ) : view === "card" ? (
        <IndicatorCardLayout
          indicators={indicators}
          query={query}
          dimensionOptions={dimensionOptions}
          onView={onView}
        />
      ) : (
        <IndicatorGroupLayout
          indicators={indicators}
          query={query}
          dimensionOptions={dimensionOptions}
          onView={onView}
        />
      )}

      <MetricDetailDrawer
        open={Boolean(detailIndicator)}
        indicator={detailIndicator}
        dimensionOptions={dimensionOptions}
        onClose={onCloseDetail}
      />
    </div>
  );
}
