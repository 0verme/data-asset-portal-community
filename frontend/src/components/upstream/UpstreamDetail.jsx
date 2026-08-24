// Copyright 2025 Jearhe
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { Icon } from "../ui.jsx";
import { MetaItem, PageHeader, StatusBadge } from "../common/index.js";
import { buildModuleBreadcrumbs } from "../../routing/navigation.js";
import { isLegacyDictValue } from "../../hooks/useDictOptions.js";

import { DbBadge, nextUnload, ScheduleTimeline } from "./UpstreamParts.jsx";

export function UpstreamDetail({ system, dbTypeOptions = [], deptOptions = [], onBack, onBackToList, onEdit }) {
  const enabled = system.status === "enabled";
  const next = nextUnload(system.unloadTimes);
  const dbTypeLegacy = isLegacyDictValue(dbTypeOptions, system.dbType);
  const deptLegacy = Boolean(system.dept) && isLegacyDictValue(deptOptions, system.dept);

  return (
    <div>
      <PageHeader
        back={{ onClick: onBack, text: "返回上游卸数列表" }}
        breadcrumbs={buildModuleBreadcrumbs("upstream", [
          { label: system.abbr },
        ], onBackToList)}
      />

      <div className="detail-head">
        <div className="dh-top">
          <div>
            <div className="dh-title">
              <span className="up-mark"><Icon name="download" size={18} color="var(--ink-2)" /></span>
              <span className="push-title">{system.name}</span>
              <DbBadge type={system.dbType} />
              <StatusBadge status={system.status} />
            </div>
            <div className="dh-desc">{system.desc}</div>
            {dbTypeLegacy || deptLegacy ? (
              <div className="editor-sub" style={{ marginTop: 8, color: "var(--warn)" }}>
                {(dbTypeLegacy ? "数据库类型" : "业务部门")}当前值未在码值中维护。
              </div>
            ) : null}
          </div>
          <div className="dh-actions">
            <button className="btn" onClick={onEdit}><Icon name="edit" size={15} />编辑</button>
          </div>
        </div>
        <div className="dh-meta">
          <MetaItem label="系统简称" value={system.abbr} mono />
          <MetaItem label="数据库类型" value={system.dbType} />
          <MetaItem label="负责人" value={`${system.owner} / ${system.dept}`} />
        </div>
      </div>

      <div className="flow-card">
        <div className="flow-node">
          <span className="fn-abbr">{system.abbr}</span>
          <div className="fn-txt">
            <div className="fn-k">上游业务库</div>
            <div className="fn-v mono">{system.dbType}</div>
          </div>
        </div>
        <div className="flow-arrow">
          <span className="fa-label">定时卸数</span>
          <Icon name="chevron" size={16} color="var(--ink-3)" />
        </div>
        <div className="flow-node">
          <span className="fn-abbr lake"><Icon name="db" size={14} color="#fff" /></span>
          <div className="fn-txt">
            <div className="fn-k">数据湖</div>
            <div className="fn-v mono">ODS 贴源层</div>
          </div>
        </div>
      </div>

      <div className="file-head-card">
        <h3 className="fh-h"><Icon name="clock" size={14} />卸数计划</h3>
        <ScheduleTimeline times={system.unloadTimes} muted={!enabled} />
        <div className="sched-foot">
          <div className="next-pill">
            <span className="np-k">下次卸数</span>
            <span className="np-v">
              {enabled ? `${next.label}${next.nextDay ? " / 次日" : ""}` : "已暂停"}
            </span>
          </div>
          <div className="time-chips">
            {system.unloadTimes.map((time) => <span key={time} className="time-chip">{time}</span>)}
          </div>
        </div>
      </div>
    </div>
  );
}

