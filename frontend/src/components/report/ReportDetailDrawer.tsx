import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import type { MockReportItem, RelatedIndicatorSummary, RelatedTableSummary } from "../../data/reports.ts";
import { formatDate, formatDateTime } from "../../utils/date.ts";
import { RowActions, StatusBadge } from "../common/index.ts";
import { Icon } from "../ui.tsx";
import { Button } from "../../ui/index.ts";

interface MetaItemProps {
  label: string;
  value: ReactNode;
  mono?: boolean | undefined;
}

function MetaItem({ label, value, mono = false }: MetaItemProps) {
  return (
    <div className="indicator-detail-item">
      <div className="indicator-detail-label">{label}</div>
      <div className={`indicator-detail-value${mono ? " mono" : ""}`}>{value || "-"}</div>
    </div>
  );
}

function ReportStatusBadge({ status }: { status: unknown }) {
  const { t } = useTranslation("report");
  return <StatusBadge status={status} metaMap={{
    enabled: { label: t("status.enabled"), className: "st-on" },
    disabled: { label: t("status.disabled"), className: "st-off" },
  }} />;
}

function referenceText(value: unknown): string {
  return String(value ?? "");
}

interface ReferenceChipsProps<T extends Record<string, unknown>> {
  items: readonly T[];
  itemKey: keyof T;
  labelKey: keyof T;
  mono?: boolean | undefined;
  empty?: string | undefined;
  onRemove?: ((key: string) => void) | undefined;
}

function ReferenceChips<T extends Record<string, unknown>>({
  items,
  itemKey,
  labelKey,
  mono = false,
  empty,
  onRemove,
}: ReferenceChipsProps<T>) {
  const { t } = useTranslation("report");
  if (!items.length) {
    return <div className="report-ref-empty">{empty || t("detail.noReferences")}</div>;
  }

  return (
    <div className="report-ref-chip-list">
      {items.map((item) => {
        const key = referenceText(item[itemKey]);
        const label = referenceText(item[labelKey]);
        return (
          <span key={key} className={`tag tag-neutral${mono ? " mono" : ""}`}>
            <span className="report-ref-chip-text">{label}</span>
            {onRemove ? (
              <button
                type="button"
                className="report-ref-chip-remove"
                onClick={() => onRemove(key)}
                aria-label={t("detail.removeReference", { label })}
              >
                <Icon name="close" size={11} />
              </button>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}

export interface ReportDetailDrawerProps {
  report: MockReportItem | null;
  open: boolean;
  onClose: () => void;
  onEdit: (code: string) => void;
  onDelete: (code: string) => void | Promise<unknown>;
  canEdit?: boolean | undefined;
}

export function ReportDetailDrawer({ report, open, onClose, onEdit, onDelete, canEdit = false }: ReportDetailDrawerProps) {
  const { t } = useTranslation("report");
  if (!open || !report) return null;

  return (
    <div className="indicator-detail-shell" role="presentation" onMouseDown={onClose}>
      <aside
        className="indicator-detail-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-detail-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="indicator-detail-head">
          <div>
            <div className="editor-title">
              <Icon name="file" size={20} color="var(--ink-2)" />
              <h2 id="report-detail-title">{t("detail.title")}</h2>
            </div>
            <div className="editor-sub">{report.code}</div>
          </div>
          <Button className="btn" variant="secondary" type="button" onClick={onClose}>
            <Icon name="close" size={14} />{t("detail.close")}
          </Button>
        </div>

        <div className="indicator-detail-body">
          <div className="form-card">
            <h3><Icon name="info" size={14} />{t("detail.basicInfo")}</h3>
            <div className="indicator-detail-grid">
              <MetaItem label={t("detail.name")} value={report.name} />
              <MetaItem label={t("detail.alias")} value={report.alias} />
              <MetaItem label={t("detail.type")} value={report.type} />
              <MetaItem label={t("detail.period")} value={report.statPeriod || (report.legacyFreq ? t("detail.legacyPeriod", { value: report.legacyFreq }) : "")} />
              <MetaItem label={t("detail.domain")} value={report.domain} />
              <MetaItem label={t("detail.caliber")} value={report.statCaliber || report.dateCaliberOther || report.dateCaliber || report.legacyTimeCaliber} />
              <MetaItem label={t("detail.dataDelay")} value={report.dataDelay || report.dataTimelinessCustom || report.dataTimeliness || t("detail.notSet")} />
              <MetaItem label={t("detail.status")} value={<ReportStatusBadge status={report.status} />} />
              <MetaItem label={t("detail.effectiveDate")} value={formatDate(report.effectiveDate)} mono />
              <MetaItem label={t("detail.expireDate")} value={report.expireDate ? formatDate(report.expireDate) : t("detail.longTerm")} mono />
            </div>
          </div>

          <div className="form-card">
            <h3><Icon name="book" size={14} />{t("detail.caliberInfo")}</h3>
            <div className="indicator-detail-grid">
              <MetaItem label={t("detail.purpose")} value={report.purpose} />
              <MetaItem label={t("detail.statObject")} value={report.statObject} />
              <MetaItem label={t("detail.businessScopeTags")} value={report.businessScopeTags || report.statScope} />
              <MetaItem label={t("detail.filterCondition")} value={report.filterCondition} mono />
              <MetaItem label={t("detail.specialRule")} value={report.specialRule} />
            </div>
          </div>

          <div className="form-card">
            <h3><Icon name="link" size={14} />{t("detail.references")}</h3>
            <div className="report-detail-section">
              <div className="report-detail-subtitle">{t("detail.tables")}</div>
              <ReferenceChips<RelatedTableSummary>
                items={(report.relatedTables || []).map((item) => ({
                  ...item,
                  refKey: Number(item.assetId) > 0
                    ? `asset:${item.assetId}`
                    : `table:${String(item.tableName || "")}`,
                }))}
                itemKey="refKey"
                labelKey="tableName"
                mono
                empty={t("detail.noTables")}
              />
            </div>
            <div className="report-detail-section">
              <div className="report-detail-subtitle">{t("detail.indicators")}</div>
              <ReferenceChips<RelatedIndicatorSummary> items={report.relatedIndicators || []} itemKey="indicatorId" labelKey="indicatorId" mono empty={t("detail.noIndicators")} />
            </div>
          </div>

          <div className="form-card">
            <h3><Icon name="user" size={14} />{t("detail.ownership")}</h3>
            <div className="indicator-detail-grid">
              <MetaItem label={t("detail.ownerDepartment")} value={report.ownerDept} />
              <MetaItem label={t("detail.owner")} value={report.ownerName} />
              <MetaItem label={t("detail.maintainer")} value={report.maintainerName} />
              <MetaItem label={t("detail.remark")} value={report.remark} />
              <MetaItem label={t("detail.updatedBy")} value={report.updatedBy} />
              <MetaItem label={t("detail.updatedAt")} value={formatDateTime(report.updatedAt)} mono />
            </div>
          </div>
        </div>

        {canEdit ? <div className="indicator-detail-foot">
          <RowActions onEdit={() => onEdit(report.code)} />
          <Button className="btn ghost-danger" variant="danger" type="button" onClick={() => void onDelete(report.code)}>
            <Icon name="trash" size={14} />{t("detail.delete")}
          </Button>
        </div> : null}
      </aside>
    </div>
  );
}
