import { Highlight, Icon } from "../ui.jsx";
import {
  EmptyState,
  StatusBadge,
} from "../common/index.js";

import { getSystemBadgeText } from "../../utils/push.js";

export function ProtocolTag({ protocol }) {
  return <span className="tag tag-neutral">{protocol}</span>;
}

export function PushSystemList({ systems, query, view, onOpen }) {
  const showContactDetails = systems.some((system) => (
    system.host || system.downstreamContact || system.dataDeveloperContact
  ));

  if (!systems.length) {
    return <EmptyState title="未找到匹配的系统" desc="没有符合当前筛选条件的下游系统，试试调整搜索词或清空筛选。" />;
  }

  if (view === "list") {
    return (
      <div className="tbl-wrap">
        <table className="dt mobile-card-table">
          <thead>
            <tr>
              <th style={{ width: "26%" }}>系统</th>
              <th>连接协议</th>
              {showContactDetails ? <>
                <th style={{ width: 140 }}>下游对接人</th>
                <th style={{ width: 140 }}>数据开发对接人</th>
              </> : null}
              <th style={{ width: 96, textAlign: "center" }}>作业数</th>
              <th style={{ width: 96 }}>状态</th>
            </tr>
          </thead>
          <tbody>
            {systems.map((system) => {
              const badgeText = getSystemBadgeText(system.abbr);
              const isImportant = system.importanceLevel === "important";
              return (
                <tr className={isImportant ? "sys-row-important" : undefined} key={system.id} onClick={() => onOpen(system.id)}>
                  <td data-label="">
                    <div className="sys-cell">
                      <span className="sys-logo compact" title={system.abbr || ""}>{badgeText}</span>
                      <div>
                        <div className="sys-name-line">
                          <div className="sys-name"><Highlight text={system.name} q={query} /></div>
                          {isImportant ? <span className="tag tag-danger">重要</span> : null}
                        </div>
                        <div className="sys-id"><Highlight text={system.id} q={query} /></div>
                      </div>
                    </div>
                  </td>
                  <td data-label="连接"><span className="path-txt"><ProtocolTag protocol={system.protocol} /></span></td>
                  {showContactDetails ? <>
                    <td data-label="下游对接人" style={{ color: "var(--ink-2)" }}>{system.downstreamContact || "未指定"}</td>
                    <td data-label="数据开发对接人" style={{ color: "var(--ink-2)" }}>{system.dataDeveloperContact || "未指定"}</td>
                  </> : null}
                  <td data-label="作业数" style={{ textAlign: "center" }}><span className="t-num">{system.jobs.length}</span></td>
                  <td data-label="状态"><StatusBadge status={system.status} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="sys-grid">
      {systems.map((system) => {
        const badgeText = getSystemBadgeText(system.abbr);
        const isImportant = system.importanceLevel === "important";
        return (
          <div
            className={`sys-card${isImportant ? " important" : ""}`}
            key={system.id}
            onClick={() => onOpen(system.id)}
          >
            <div className="sys-card-top">
              <div className="sys-card-main">
                <div className="sys-logo" title={system.abbr || ""}>{badgeText}</div>
                <div className="sys-card-title">
                  <div className="sn"><Highlight text={system.name} q={query} /></div>
                  <div className="sa"><Highlight text={system.id} q={query} /></div>
                </div>
              </div>
              <div className="sys-card-statuses">
                {isImportant ? <span className="tag tag-danger">重要</span> : null}
                <StatusBadge status={system.status} />
              </div>
            </div>
            <div className="sys-desc">{system.desc}</div>
            {isImportant ? (
              <div className="sys-conn sys-deadline">
                <span className="ck">最晚出数时间</span>
                <span className="cv mono">{system.latestOutputTime || "未配置"}</span>
              </div>
            ) : null}
            {system.host ? <div className="sys-conn">
              <span className="ck">下游 IP</span>
              <span className="cv mono">{system.host}</span>
            </div> : null}
            {system.downstreamContact ? <div className="sys-conn">
              <span className="ck">下游对接人</span>
              <span className="cv">{system.downstreamContact}</span>
            </div> : null}
            {system.dataDeveloperContact ? <div className="sys-conn">
              <span className="ck">数据开发对接</span>
              <span className="cv">{system.dataDeveloperContact}</span>
            </div> : null}
            <div className="sys-card-foot">
              <span className="jobs-n"><Icon name="push" size={14} color="var(--ink-3)" /><b>{system.jobs.length}</b> 个推送作业</span>
              <span className="enter-link">进入 <Icon name="arrow" size={14} /></span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
