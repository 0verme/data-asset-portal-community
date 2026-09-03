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

import { Icon } from "../ui.tsx";
import { MetaItem, PageHeader, StatusBadge } from "../common/index.ts";
import { buildModuleBreadcrumbs } from "../../routing/navigation.ts";
import { isLegacyDictValue } from "../../utils/optionUtils.ts";

import { nextUnload, ScheduleStepper } from "./UpstreamParts.jsx";
import { displayUpstreamValue, getUpstreamDetailMetadata } from "./upstreamFieldContract.js";

export function UpstreamDetail({ system, dbTypeOptions = [], deptOptions = [], onBack, onBackToList, onEdit }) {
  const status = system?.status ?? "";
  const enabled = status === "enabled";
  const unloadTimes = Array.isArray(system?.unloadTimes) ? system.unloadTimes : [];
  const scheduleNow = new Date();
  const next = unloadTimes.length ? nextUnload(unloadTimes, scheduleNow) : null;
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
          {onEdit ? <div className="dh-actions">
            <button className="btn" onClick={onEdit}><Icon name="edit" size={15} />编辑</button>
          </div> : null}
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

      <div className="file-head-card schedule-card">
        <div className="schedule-card-header">
          <div className="schedule-card-heading">
            <h3 className="schedule-card-title"><Icon name="clock" size={14} color="var(--ink-3)" />卸数计划</h3>
            <div className="schedule-card-subtitle">每日自动执行 · {unloadTimes.length} 次</div>
          </div>
          <div className={`schedule-next${!enabled ? " is-muted" : ""}`}>
            <span className="schedule-next-label">下一次卸数</span>
            <span className="schedule-next-value">
              {!enabled ? "已暂停" : next ? `${next.nextDay ? "明日 " : ""}${next.label}` : "暂无计划"}
            </span>
          </div>
        </div>
        {unloadTimes.length ? (
          <ScheduleStepper times={unloadTimes} muted={!enabled} now={scheduleNow} />
        ) : (
          <div className="schedule-empty" role="status">暂无卸数计划</div>
        )}
      </div>
    </div>
  );
}

