import { useTranslation } from "react-i18next";

import type { EnrichedReportItem } from "../../hooks/useReportModule.ts";
import { CardGridView, EmptyState, GroupView, RowActions, StatusBadge, ViewModeSwitcher, WideTableScroll } from "../common/index.ts";
import type { ViewMode } from "../common/ViewModeSwitcher.tsx";
import { Highlight, Icon } from "../ui.tsx";
import { Button } from "../../ui/index.ts";

function ReportStatusBadge({ status }: { status: unknown }) {
  const { t } = useTranslation("report");
  return <StatusBadge status={status} metaMap={{
    enabled: { label: t("status.enabled"), className: "st-on" },
    disabled: { label: t("status.disabled"), className: "st-off" },
  }} />;
}

interface ReportCardLayoutProps {
  reports: readonly EnrichedReportItem[];
  query: string;
  onView: (code: string) => void;
  onEdit: (code: string) => void;
  canEdit: boolean;
}

function ReportCardLayout({ reports, query, onView, onEdit, canEdit }: ReportCardLayoutProps) {
  const { t } = useTranslation("report");
  return <CardGridView
    items={reports}
    getKey={(item) => item.code}
    onItemClick={(item) => onView(item.code)}
    renderBadges={(item) => <><span className="tag tag-neutral">{item.type || t("list.uncategorized")}</span><ReportStatusBadge status={item.status} /></>}
    renderTitle={(item) => <Highlight text={item.name} q={query} />}
    renderSubtitle={(item) => <Highlight text={item.code} q={query} />}
    renderDesc={(item) => item.purpose || t("list.noPurpose")}
    renderFootLeft={(item) => <span className="t-owner">{item.ownerDept || t("list.unassignedDepartment")}</span>}
    renderFootMeta={(item) => <><span className="m"><Icon name="table" size={13} />{t("list.tableCount", { count: item.relatedTableCount })}</span><span className="m"><Icon name="info" size={13} />{t("list.indicatorCount", { count: item.relatedIndicatorCount })}</span></>}
    renderFootActions={(item) => <RowActions onView={() => onView(item.code)} onEdit={canEdit ? () => onEdit(item.code) : undefined} />}
  />;
}

interface ReportGroupLayoutProps {
  reports: readonly EnrichedReportItem[];
  query: string;
  onView: (code: string) => void;
}

function ReportGroupLayout({ reports, query, onView }: ReportGroupLayoutProps) {
  const { t } = useTranslation("report");
  return <GroupView
    items={reports}
    getKey={(item) => item.code}
    onItemClick={(item) => onView(item.code)}
    groupBy={(item) => item.type || t("list.uncategorized")}
    renderGroupLabel={(type) => <span className="tag tag-neutral">{type}</span>}
    renderGroupCount={(count) => t("list.groupCount", { count })}
    renderCardName={(item) => <Highlight text={item.code} q={query} />}
    renderCardBody={(item) => <><span><Highlight text={item.name} q={query} /></span><span className="gc-owner">{item.ownerDept || t("list.unassignedDepartment")}</span></>}
  />;
}

export interface ReportListProps {
  reports: readonly EnrichedReportItem[];
  total?: number | undefined;
  query: string;
  view: ViewMode;
  onChangeView: (view: ViewMode) => void;
  onView: (code: string) => void;
  onEdit: (code: string) => void;
  onNew: () => void;
  canEdit?: boolean | undefined;
}

export function ReportList({ reports, total = reports.length, query, view, onChangeView, onView, onEdit, onNew, canEdit = false }: ReportListProps) {
  const { t } = useTranslation("report");
  return (
    <div className="indicator-page">
      <div className="page-head">
        <div>
          <div className="page-title"><span className="pt-code">{t("page.code")}</span>{t("page.title")}</div>
          <div className="page-sub">
            {t("page.summary", { count: total })}{query ? t("page.summaryQuery", { query }) : null}
          </div>
        </div>
        <div className="head-actions"><ViewModeSwitcher value={view} onChange={onChangeView} />{canEdit ? <Button className="btn primary" variant="primary" type="button" onClick={onNew}><Icon name="plus" size={15} />{t("page.create")}</Button> : null}</div>
      </div>

      {!reports.length ? <EmptyState title={query ? t("list.emptyQuery") : t("list.empty")} /> : view === "list" ? <div className="tbl-wrap indicator-tbl">
        <WideTableScroll ariaLabel={t("list.ariaLabel")} className="report-wide-scroll">
          <table className="dt mobile-card-table report-wide-table">
          <thead>
            <tr>
              <th style={{ width: 150 }}>{t("list.code")}</th>
              <th>{t("list.namePurpose")}</th>
              <th style={{ width: 120 }}>{t("list.type")}</th>
              <th style={{ width: 120 }}>{t("list.ownerDepartment")}</th>
              <th style={{ width: 92 }}>{t("list.status")}</th>
              <th style={{ width: 130 }}>{t("list.references")}</th>
              <th style={{ width: 190, textAlign: "right" }}>{t("list.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {reports.map((item) => (
              <tr key={item.code}>
                <td data-label={t("list.code")}>
                  <button className="indicator-summary-btn" type="button" onClick={() => onView(item.code)}>
                    <span className="indicator-id mono"><Highlight text={item.code} q={query} /></span>
                  </button>
                </td>
                <td data-label={t("list.namePurposeMobile")}>
                  <button className="indicator-summary-btn" type="button" onClick={() => onView(item.code)}>
                    <span className="indicator-name"><Highlight text={item.name} q={query} /></span>
                    <span className="indicator-meaning"><Highlight text={item.purpose || t("list.noPurpose")} q={query} /></span>
                  </button>
                </td>
                <td data-label={t("list.type")}>{item.type || t("list.uncategorized")}</td>
                <td data-label={t("list.ownerDepartment")}>{item.ownerDept || t("list.unassignedDepartment")}</td>
                <td data-label={t("list.status")}><ReportStatusBadge status={item.status} /></td>
                <td data-label={t("list.references")} className="mono indicator-date">{t("list.referenceCounts", { tables: item.relatedTableCount, indicators: item.relatedIndicatorCount })}</td>
                <td data-label={t("list.actions")} className="mobile-card-actions" style={{ textAlign: "right" }}>
                  <RowActions onView={() => onView(item.code)} onEdit={canEdit ? () => onEdit(item.code) : undefined} />
                </td>
              </tr>
            ))}
          </tbody>
          </table>
        </WideTableScroll>
      </div> : view === "card" ? <ReportCardLayout reports={reports} query={query} onView={onView} onEdit={onEdit} canEdit={canEdit} /> : <ReportGroupLayout reports={reports} query={query} onView={onView} />}
    </div>
  );
}
