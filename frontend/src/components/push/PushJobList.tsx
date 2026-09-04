import type { CSSProperties } from "react";

import type { PublicPushJob, PublicPushSystem } from "../../api/push.ts";
import { getSystemBadgeText } from "../../utils/push.ts";
import { EmptyState, MetaItem, RowActions, StatusBadge } from "../common/index.ts";
import { Highlight, Icon } from "../ui.tsx";
import { ProtocolTag } from "./PushSystemList.tsx";
import { PUSH_JOB_TABLE_COLUMNS, type PushJobTableColumn, type PushJobTableColumnKey, type PushJobTableValues, getPushJobTableValues } from "./pushJobTable.ts";
import { isRenameJob } from "./pushUtils.ts";

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
    case "sourcePath":
    case "targetPath":
      return <span className="path-txt push-job-path" title={values[columnKey]}>{values[columnKey]}</span>;
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
        <button type="button" className="crumb-link" onClick={onBack}>系统列表</button>
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
            {canEdit && onEditSystem ? <button className="btn" type="button" onClick={onEditSystem}><Icon name="edit" size={15} />编辑系统</button> : null}
          </div>
        </div>
        <div className="dh-meta">
          <MetaItem label="连接协议" value={<ProtocolTag protocol={system.protocol} />} />
          {getSystemText(system, "downstreamContact") ? <MetaItem label="下游对接人" value={getSystemText(system, "downstreamContact")} /> : null}
          {getSystemText(system, "dataDeveloperContact") ? <MetaItem label="数据开发对接人" value={getSystemText(system, "dataDeveloperContact")} /> : null}
          <MetaItem label="业务部门" value={system.dept} />
        </div>
      </div>

      <div className="page-head" style={{ marginBottom: 16 }}>
        <div className="page-title push-subtitle">
          <Icon name="upload" size={19} color="var(--ink-2)" />
          推送作业清单
          <span className="sub-count">{jobs.length} 个</span>
        </div>
        {canEdit && onNewJob ? <button className="btn primary" type="button" onClick={onNewJob}><Icon name="plus" size={15} />新增接口</button> : null}
      </div>

      {!jobs.length ? (
        <EmptyState title="暂无推送作业" desc="当前系统还没有配置推送文件。" />
      ) : (
        <div className="tbl-wrap">
          <table className="dt mobile-card-table push-job-table">
            <thead>
              <tr>
                {PUSH_JOB_TABLE_COLUMNS.map((column) => (
                  <th key={column.key} style={getColumnStyle(column)}>{column.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => {
                const values = getPushJobTableValues(job);
                return (
                  <tr key={job.id} onClick={() => onOpen(job.id)}>
                    {PUSH_JOB_TABLE_COLUMNS.map((column) => (
                      <td
                        key={`${job.id}-${column.key}`}
                        data-label={column.mobileLabel}
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
        </div>
      )}
    </div>
  );
}

function getSystemText(system: PublicPushSystem, key: string): string {
  const value = system[key];
  return typeof value === "string" ? value : "";
}
