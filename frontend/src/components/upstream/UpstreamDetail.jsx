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
import { buildModuleBreadcrumbs } from "../../routing/navigation.ts";
import { isLegacyDictValue } from "../../hooks/useDictOptions.js";

import { nextUnload, ScheduleTimeline } from "./UpstreamParts.jsx";
import { displayUpstreamValue, getUpstreamDetailMetadata } from "./upstreamFieldContract.js";

export function UpstreamDetail({ system, dbTypeOptions = [], deptOptions = [], onBack, onBackToList, onEdit }) {
  const status = system?.status ?? "";
  const enabled = status === "enabled";
  const unloadTimes = Array.isArray(system?.unloadTimes) ? system.unloadTimes : [];
  const next = unloadTimes.length ? nextUnload(unloadTimes) : null;
  const systemName = displayUpstreamValue(system?.name);
  const systemAbbr = displayUpstreamValue(system?.abbr);
  const detailMetadata = getUpstreamDetailMetadata(system);
  const dbTypeLegacy = isLegacyDictValue(dbTypeOptions, system?.dbType);
  const deptLegacy = Boolean(system?.dept) && isLegacyDictValue(deptOptions, system?.dept);

  return (
    <div>
      <PageHeader
        back={{ onClick: onBack, text: "返回上游卸数列表" }}
        breadcrumbs={buildModuleBreadcrumbs("upstream", [
          { label: systemAbbr },
        ], onBackToList)}
      />

      <div className="detail-head">
        <div className="dh-top">
          <div>
            <div className="dh-title">
              <span className="up-mark"><Icon name="download" size={18} color="var(--ink-2)" /></span>
              <span className="upstream-detail-title">{systemName}</span>
              <span className="upstream-detail-abbr mono">{systemAbbr}</span>
              <StatusBadge status={status} />
            </div>
            <div className="dh-desc">{displayUpstreamValue(system?.desc)}</div>
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
        <div className="dh-meta upstream-detail-meta" data-field-contract="upstream-system">
          {detailMetadata.map(({ key, label, value, mono }) => (
            <MetaItem key={key} label={label} value={value} mono={mono} />
          ))}
        </div>
      </div>

      <div className="flow-card">
        <div className="flow-node">
          <span className="fn-abbr">{systemAbbr}</span>
          <div className="fn-txt">
            <div className="fn-k">上游业务库</div>
            <div className="fn-v mono">{displayUpstreamValue(system?.dbType)}</div>
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
        <ScheduleTimeline times={unloadTimes} muted={!enabled} />
        <div className="sched-foot">
          <div className="next-pill">
            <span className="np-k">下次卸数</span>
            <span className="np-v">
              {enabled ? (next ? `${next.label}${next.nextDay ? " / 次日" : ""}` : "—") : "已暂停"}
            </span>
          </div>
          <div className="time-chips">
            {unloadTimes.map((time) => <span key={time} className="time-chip">{time}</span>)}
          </div>
        </div>
      </div>
    </div>
  );
}

