import type { CSSProperties } from "react";

import type { PublicPushJob, PublicPushSystem } from "../../api/push.ts";
import { getSystemBadgeText } from "../../utils/push.ts";
import { EmptyState, MetaItem, RowActions, StatusBadge, WideTableScroll } from "../common/index.ts";
import { Highlight, Icon } from "../ui.tsx";
import { Button } from "../../ui/index.ts";
import { ProtocolTag } from "./PushSystemList.tsx";
import { PUSH_JOB_TABLE_COLUMNS, type PushJobTableColumn, type PushJobTableColumnKey, type PushJobTableValues, getPushJobTableValues } from "./pushJobTable.ts";
import { isRenameJob } from "./pushUtils.ts";
import { useUiCopy } from "../../i18n/useUiTranslation.ts";

function renderPushJobCell(
  columnKey: PushJobTableColumnKey,
  job: PublicPushJob,
  values: PushJobTableValues,
  query: string,
  canEdit: boolean,
  onEditJob: (jobId: string) => void,
) {
  switch (columnKey) {
    case "job":
      return (
        <div className="job-row-name">
          <span className="jn"><Highlight text={values.job.name} q={query} /></span>
          <span className="jf">
            <Highlight text={values.job.sourceFileName} q={query} />
            {isRenameJob(job) ? ` → ${values.job.targetFileName}` : ""}
          </span>
        </div>
      );
    case "frequency":
      return <span className="freq-cell"><Icon name="clock" size={13} color="var(--ink-3)" />{values.frequency}</span>;
    case "status":
      return <StatusBadge on={job.enabled} />;
    case "action":
      return <RowActions onEdit={canEdit ? () => onEditJob(job.id) : undefined} />;
    default:
      return null;
  }
}

type TextAlign = NonNullable<CSSProperties["textAlign"]>;

function isTextAlign(value: string | undefined): value is TextAlign {
  return value === "left" || value === "right" || value === "center" || value === "justify";
}

function getColumnStyle(column: PushJobTableColumn): CSSProperties {
  const style: CSSProperties = {};
  if (column.width !== undefined) style.width = column.width;
  if (isTextAlign(column.align)) style.textAlign = column.align;
  return style;
}

export interface PushJobListProps {
  system: PublicPushSystem;
  query: string;
  onBack: () => void;
  onOpen: (jobId: string) => void;
  onEditSystem?: (() => void) | undefined;
  onNewJob?: (() => void) | undefined;
  onEditJob?: ((jobId: string) => void) | undefined;
  canEdit?: boolean | undefined;
}

export function PushJobList({
  system,
  query,
  onBack,
  onOpen,
  onEditSystem,
  onNewJob,
  onEditJob = () => undefined,
  canEdit = false,
}: PushJobListProps) {
  const tx = useUiCopy("integration");
  const badgeText = getSystemBadgeText(system.abbr);
  const normalizedQuery = (query || "").trim().toLowerCase();
  const jobs = system.jobs.filter((job) => {
    if (!normalizedQuery) return true;

    return (
      job.cn.toLowerCase().includes(normalizedQuery) ||
      job.sourceFileName.toLowerCase().includes(normalizedQuery) ||
      job.targetFileName.toLowerCase().includes(normalizedQuery)
    );
  });

  return (
    <div>
      <div className="crumb">
        <button type="button" className="crumb-link" onClick={onBack}>{tx("系统列表")}</button>
        <span className="sep"><Icon name="chevron" size={13} /></span>
        <span className="cur">{system.id}</span>
      </div>

      <div className="detail-head">
        <div className="dh-top">
          <div className="push-head-main">
            <div className="sys-logo xl" title={system.abbr || ""}>{badgeText}</div>
            <div>
              <div className="dh-title">
                <span className="push-title">{system.name}</span>
                <StatusBadge status={system.status} />
              </div>
              <div className="dh-desc" style={{ marginTop: 8 }}>{system.desc}</div>
            </div>
          </div>
          <div className="dh-actions">
            {canEdit && onEditSystem ? <Button className="btn" variant="secondary" type="button" onClick={onEditSystem}><Icon name="edit" size={15} />{tx("编辑系统")}</Button> : null}
          </div>
        </div>
        <div className="dh-meta">
          <MetaItem label={tx("连接协议")} value={<ProtocolTag protocol={system.protocol} />} />
          {getSystemText(system, "downstreamContact") ? <MetaItem label={tx("下游对接人")} value={getSystemText(system, "downstreamContact")} /> : null}
          {getSystemText(system, "dataDeveloperContact") ? <MetaItem label={tx("数据开发对接人")} value={getSystemText(system, "dataDeveloperContact")} /> : null}
          <MetaItem label={tx("业务部门")} value={system.dept} />
        </div>
      </div>

      <div className="page-head" style={{ marginBottom: 16 }}>
        <div className="page-title push-subtitle">
          <Icon name="upload" size={19} color="var(--ink-2)" />
          {tx("推送作业清单")}<span className="sub-count">{jobs.length} {tx("个")}</span>
        </div>
        {canEdit && onNewJob ? <Button className="btn primary" variant="primary" type="button" onClick={onNewJob}><Icon name="plus" size={15} />{tx("新增接口")}</Button> : null}
      </div>

      {!jobs.length ? (
        <EmptyState title={tx("暂无推送作业")} desc={tx("当前系统还没有配置推送文件。")} />
      ) : (
        <div className="tbl-wrap">
          <WideTableScroll ariaLabel={tx("推送作业列表")} className="push-jobs-wide-scroll">
            <table className="dt mobile-card-table push-job-table push-jobs-wide-table">
            <thead>
              <tr>
                {PUSH_JOB_TABLE_COLUMNS.map((column) => (
                  <th key={column.key} style={getColumnStyle(column)}>{tx(column.label)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => {
                const values = getPushJobTableValues(job, tx);
                return (
                  <tr key={job.id} onClick={() => onOpen(job.id)}>
                    {PUSH_JOB_TABLE_COLUMNS.map((column) => (
                      <td
                        key={`${job.id}-${column.key}`}
                        data-label={column.mobileLabel ? tx(column.mobileLabel) : ""}
                        className={column.className}
                        style={isTextAlign(column.align) ? { textAlign: column.align } : undefined}
                        onClick={column.key === "action" ? (event) => event.stopPropagation() : undefined}
                      >
                        {renderPushJobCell(column.key, job, values, query, canEdit, onEditJob)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
            </table>
          </WideTableScroll>
        </div>
      )}
    </div>
  );
}

function getSystemText(
  system: PublicPushSystem,
  key: "downstreamContact" | "dataDeveloperContact",
): string {
  return system[key] || "";
}
