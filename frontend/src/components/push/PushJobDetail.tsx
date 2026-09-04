import type { PushJobField } from "../../data/pushSystems.ts";
import { formatFreq, formatRenameHint, isRenameJob, type PushJobLike } from "./pushUtils.ts";
import { FREQ_PARAM_CONFIG } from "./pushConstants.ts";
import { StatusBadge } from "../common/index.ts";
import { Icon } from "../ui.tsx";

interface PushJobDisplay extends PushJobLike {
  id: string;
  cn: string;
  sourcePath: string;
  sourceFileName: string;
  targetPath: string;
  targetFileName: string;
  freqType: string;
  enabled: boolean;
  desc: string;
  fields?: readonly PushJobField[] | undefined;
  rowCnt?: string | undefined;
  delimiter?: string | undefined;
  encoding?: string | undefined;
}

interface PushSystemDisplay {
  id: string;
  name: string;
  abbr: string;
  desc: string;
  protocol: string;
  dept: string;
  status: string;
  jobs: readonly PushJobDisplay[];
  host?: string | undefined;
  port?: number | undefined;
  downstreamContact?: string | undefined;
  dataDeveloperContact?: string | undefined;
}

function isDetailedJob(job: PushJobDisplay): job is PushJobDisplay & { fields: readonly PushJobField[] } {
  return Array.isArray(job.fields);
}

export interface PushJobDetailProps {
  system: PushSystemDisplay;
  job: PushJobDisplay;
  showDetails?: boolean | undefined;
  onBackSystems: () => void;
  onBackJobs: () => void;
  onEdit?: (() => void) | undefined;
}

export function PushJobDetail({ system, job, showDetails = false, onBackSystems, onBackJobs, onEdit }: PushJobDetailProps) {
  return (
    <div>
      <div className="crumb"><button type="button" className="crumb-link" onClick={onBackSystems}>系统列表</button><span className="sep"><Icon name="chevron" size={13} /></span><button type="button" className="crumb-link" onClick={onBackJobs}>{system.id}</button><span className="sep"><Icon name="chevron" size={13} /></span><span className="cur">{job.id}</span></div>
      <div className="detail-head"><div className="dh-top"><div><div className="dh-title"><Icon name="file" size={21} color="var(--ink-2)" /><span className="push-title">{job.cn}</span><StatusBadge on={job.enabled} /></div><div className="dh-cn mono">{job.targetFileName}</div></div>{onEdit ? <div className="dh-actions"><button className="btn primary" type="button" onClick={onEdit}><Icon name="edit" size={15} />编辑接口</button></div> : null}</div></div>
      <div className="file-head-card"><h3 className="file-head-title"><Icon name="info" size={14} />作业摘要</h3><div className="fh-grid"><div className="fh-item"><div className="k">推送频率</div><div className="v">{job.freqType}{FREQ_PARAM_CONFIG[job.freqType] ? ` / ${formatFreq(job)}` : ""}</div></div><div className="fh-item fh-full"><div className="k">业务逻辑说明</div><div className="v file-desc">{job.desc}</div></div></div></div>
      {showDetails && isDetailedJob(job) ? <PushJobDetails system={system} job={job} /> : null}
    </div>
  );
}

interface PushJobDetailsProps {
  system: PushSystemDisplay;
  job: PushJobDisplay & { fields: readonly PushJobField[] };
}

function PushJobDetails({ system, job }: PushJobDetailsProps) {
  return (
    <div>
      <div className="file-head-card">
        <h3 className="file-head-title"><Icon name="info" size={14} />文件头信息</h3>
        <div className="fh-grid">
          <div className="fh-item fh-full"><div className="k">湖仓来源信息</div><div className="v"></div></div>
          <div className="fh-item"><div className="k">湖仓来源路径</div><div className="v mono">{job.sourcePath}</div></div>
          <div className="fh-item"><div className="k">湖仓来源文件名</div><div className="v mono">{job.sourceFileName}</div></div>
          <div className="fh-item fh-full"><div className="k">目标推送信息</div><div className="v"></div></div>
          <div className="fh-item"><div className="k">目标推送路径</div><div className="v mono">{system.protocol} {"->"} {system.host || ""}{system.port ? `:${system.port}` : ""}{job.targetPath}</div></div>
          <div className="fh-item"><div className="k">目标推送文件名</div><div className="v mono">{job.targetFileName}</div></div>
          {isRenameJob(job) ? <div className="fh-item fh-full"><div className="k">提示</div><div className="v mono">推送时重命名 {formatRenameHint(job)}</div></div> : null}
          <div className="fh-item"><div className="k">字段分隔符</div><div className="v mono">{job.delimiter === "\\t" ? "\\t (Tab)" : job.delimiter || "-"}</div></div>
          <div className="fh-item"><div className="k">文件编码</div><div className="v mono">{job.encoding || "-"}</div></div>
          <div className="fh-item"><div className="k">推送频率</div><div className="v">{job.freqType}{FREQ_PARAM_CONFIG[job.freqType] ? ` · ${formatFreq(job)}` : ""}</div></div>
          <div className="fh-item"><div className="k">预估行数</div><div className="v mono">{job.rowCnt || "-"}</div></div>
          <div className="fh-item fh-full"><div className="k">业务逻辑说明</div><div className="v file-desc">{job.desc}</div></div>
        </div>
      </div>

      <div className="tabs">
        <div className="tab active"><Icon name="columns" size={15} />字段清单 <span className="tab-n">{job.fields.length}</span></div>
      </div>
      <div className="panel">
        <div style={{ overflowX: "auto" }}>
          <table className="fields">
            <thead>
              <tr>
                <th className="c-idx">序号</th>
                <th style={{ width: 180 }}>字段名</th>
                <th style={{ width: 160 }}>中文名</th>
                <th>含义</th>
                <th style={{ width: 140 }}>来源系统</th>
                <th style={{ width: 130 }}>数据类型</th>
              </tr>
            </thead>
            <tbody>
              {job.fields.map((field, index) => (
                <tr key={field.name}>
                  <td className="c-idx">{index + 1}</td>
                  <td className="c-name">{field.name}</td>
                  <td className="c-cn">{field.cn}</td>
                  <td className="field-meaning">{field.meaning}</td>
                  <td><span className="tag tag-neutral">{field.src}</span></td>
                  <td className="c-type">{field.type}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
