import React from "react";
import { Highlight, Icon } from "../ui.jsx";
import {
  ActionErrorBanner,
  BinaryStatusToggle,
  confirmDeleteAction,
  DangerZone,
  EmptyState,
  FormActionBar,
  MetaItem,
  PageHeader,
  RowActions,
  StatusBadge,
  TimeInput,
} from "../common/index.js";

import { buildModuleBreadcrumbs } from "../../routing/navigation.js";
import { FREQ_PARAM_CONFIG } from "./pushConstants.js";
import { formatFreq, formatRenameHint, isRenameJob } from "./pushUtils.js";

export function PushJobDetail({ system, job, showDetails = false, onBackSystems, onBackJobs, onEdit }) {
  return (
    <div>
      <div className="crumb"><a onClick={onBackSystems}>系统列表</a><span className="sep"><Icon name="chevron" size={13} /></span><a onClick={onBackJobs}>{system.id}</a><span className="sep"><Icon name="chevron" size={13} /></span><span className="cur">{job.id}</span></div>
      <div className="detail-head"><div className="dh-top"><div><div className="dh-title"><Icon name="file" size={21} color="var(--ink-2)" /><span className="push-title">{job.cn}</span><StatusBadge on={job.enabled} /></div><div className="dh-cn mono">{job.targetFileName}</div></div><div className="dh-actions"><button className="btn primary" onClick={onEdit}><Icon name="edit" size={15} />编辑接口</button></div></div></div>
      <div className="file-head-card"><h3 className="file-head-title"><Icon name="info" size={14} />作业摘要</h3><div className="fh-grid"><div className="fh-item"><div className="k">推送频率</div><div className="v">{job.freqType}{FREQ_PARAM_CONFIG[job.freqType] ? ` / ${formatFreq(job)}` : ""}</div></div><div className="fh-item fh-full"><div className="k">业务逻辑说明</div><div className="v file-desc">{job.desc}</div></div></div></div>
      {showDetails ? <PushJobDetails system={system} job={job} /> : null}
    </div>
  );
}

function PushJobDetails({ system, job }) {
  return (
    <div>
      <div className="file-head-card">
        <h3 className="file-head-title"><Icon name="info" size={14} />文件头信息</h3>
        <div className="fh-grid">
          <div className="fh-item fh-full"><div className="k">湖仓来源信息</div><div className="v"></div></div>
          <div className="fh-item"><div className="k">湖仓来源路径</div><div className="v mono">{job.sourcePath}</div></div>
          <div className="fh-item"><div className="k">湖仓来源文件名</div><div className="v mono">{job.sourceFileName}</div></div>
          <div className="fh-item fh-full"><div className="k">目标推送信息</div><div className="v"></div></div>
          <div className="fh-item"><div className="k">目标推送路径</div><div className="v mono">{system.protocol} {"->"} {system.host}:{system.port}{job.targetPath}</div></div>
          <div className="fh-item"><div className="k">目标推送文件名</div><div className="v mono">{job.targetFileName}</div></div>
          {isRenameJob(job) ? <div className="fh-item fh-full"><div className="k">提示</div><div className="v mono">推送时重命名 {formatRenameHint(job)}</div></div> : null}
          <div className="fh-item"><div className="k">字段分隔符</div><div className="v mono">{job.delimiter === "\\t" ? "\\t (Tab)" : job.delimiter}</div></div>
          <div className="fh-item"><div className="k">文件编码</div><div className="v mono">{job.encoding}</div></div>
          <div className="fh-item"><div className="k">推送频率</div><div className="v">{job.freqType}{FREQ_PARAM_CONFIG[job.freqType] ? ` · ${formatFreq(job)}` : ""}</div></div>
          <div className="fh-item"><div className="k">预估行数</div><div className="v mono">{job.rowCnt}</div></div>
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
