import { Highlight, Icon } from "../ui.jsx";
import {
  EmptyState,
  MetaItem,
  RowActions,
  StatusBadge,
} from "../common/index.js";

import { getSystemBadgeText } from "../../utils/push.js";
import { ProtocolTag } from "./PushSystemList.jsx";
import { PUSH_JOB_TABLE_COLUMNS, getPushJobTableValues } from "./pushJobTable.js";
import { isRenameJob } from "./pushUtils.js";

function renderPushJobCell(columnKey, job, values, query, canEdit, onEditJob) {
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

export function PushJobList({
  system,
  query,
  onBack,
  onOpen,
  onEditSystem,
  onNewJob,
  onEditJob,
  canEdit = false,
}) {
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
        <a onClick={onBack}>系统列表</a>
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
            {canEdit ? <button className="btn" onClick={onEditSystem}><Icon name="edit" size={15} />编辑系统</button> : null}
          </div>
        </div>
        <div className="dh-meta">
          <MetaItem label="连接协议" value={<ProtocolTag protocol={system.protocol} />} />
          {system.downstreamContact ? <MetaItem label="下游对接人" value={system.downstreamContact} /> : null}
          {system.dataDeveloperContact ? <MetaItem label="数据开发对接人" value={system.dataDeveloperContact} /> : null}
          <MetaItem label="业务部门" value={system.dept} />
        </div>
      </div>

      <div className="page-head" style={{ marginBottom: 16 }}>
        <div className="page-title push-subtitle">
          <Icon name="upload" size={19} color="var(--ink-2)" />
          推送作业清单
          <span className="sub-count">{jobs.length} 个</span>
        </div>
        {canEdit ? <button className="btn primary" onClick={onNewJob}><Icon name="plus" size={15} />新增接口</button> : null}
      </div>

      {!jobs.length ? (
        <EmptyState title="暂无推送作业" desc="当前系统还没有配置推送文件。" />
      ) : (
        <div className="tbl-wrap">
          <table className="dt mobile-card-table push-job-table">
            <thead>
              <tr>
                {PUSH_JOB_TABLE_COLUMNS.map((column) => (
                  <th
                    key={column.key}
                    style={{
                      ...(column.width !== undefined ? { width: column.width } : {}),
                      ...(column.align ? { textAlign: column.align } : {}),
                    }}
                  >
                    {column.label}
                  </th>
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
                        style={column.align ? { textAlign: column.align } : undefined}
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
