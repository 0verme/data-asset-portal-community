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
import { CardGridView, EmptyState, RowActions, StatusBadge, ViewModeSwitcher } from "../common/index.js";

import { DbBadge } from "./UpstreamParts.jsx";

export function UpstreamList({
  systems,
  pendingIds = [],
  query,
  view,
  onChangeView,
  onOpen,
  onEdit,
  onNew,
  onToggle,
  onViewTables,
  canEdit = false,
}) {
  return (
    <div className="upstream-page">
      <div className="page-head">
        <div>
          <div className="page-title"><Icon name="download" size={21} color="var(--ink-2)" />上游卸数系统</div>
          <div className="page-sub">
            上游业务系统按计划将数据卸载至数据湖，共 <b>{systems.length}</b> 个{query ? <>，匹配“{query}”</> : null}
          </div>
        </div>
        <div className="head-actions">
          <ViewModeSwitcher value={view} onChange={onChangeView} modes={["card", "list"]} />
          {canEdit ? <button className="btn primary" onClick={onNew}><Icon name="plus" size={15} />新增系统</button> : null}
        </div>
      </div>

      {!systems.length ? (
        <EmptyState title="未找到匹配的系统" desc="换个关键词试试，或者新增上游系统。" />
      ) : view === "card" ? (
        <CardGridView
          items={systems}
          getKey={(item) => item.id}
          onItemClick={(item) => onOpen(item.id)}
          renderBadges={(item) => (
            <>
              <DbBadge type={item.dbType} />
              <StatusBadge status={item.status} />
            </>
          )}
          renderTitle={(item) => item.name}
          renderSubtitle={(item) => `${item.abbr} / ${item.id}`}
          renderDesc={(item) => item.desc}
          renderFootLeft={(item) => (
            <div className="time-chips">
              {item.unloadTimes.map((time) => <span key={time} className="time-chip">{time}</span>)}
            </div>
          )}
          renderFootMeta={(item) => (
            <span className="m"><Icon name="user" size={13} />{item.owner} / {item.dept}</span>
          )}
          renderFootActions={(item) => {
            const enabled = item.status === "enabled";
            return (
              <RowActions
                disabled={pendingIds.includes(item.id)}
                onEdit={canEdit ? () => onEdit(item.id) : undefined}
                extraActions={[
                  {
                    key: "view-tables",
                    label: "查看入仓表",
                    icon: "link",
                    onClick: () => onViewTables?.({
                      sourceSystemId: item.upstreamSystemId || "",
                      tab: "table",
                    }),
                  },
                ]}
                toggle={canEdit ? {
                  enabled,
                  label: item.name,
                  onToggle: () => onToggle(item.id, enabled ? "disabled" : "enabled"),
                } : undefined}
              />
            );
          }}
        />
      ) : (
        <div className="tbl-wrap">
          <table className="dt mobile-card-table">
            <thead>
              <tr>
                <th style={{ width: "24%" }}>系统</th>
                <th style={{ width: 140 }}>数据库类型</th>
                <th>卸数时间点</th>
                <th style={{ width: 150 }}>负责人 / 部门</th>
                <th style={{ width: 96 }}>状态</th>
                <th style={{ width: 220, textAlign: "right" }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {systems.map((item) => {
                const isPending = pendingIds.includes(item.id);
                const enabled = item.status === "enabled";
                return (
                <tr key={item.id} onClick={() => onOpen(item.id)}>
                  <td data-label="">
                    <div className="job-row-name">
                      <span className="jn">{item.name}</span>
                      <span className="jf">{item.abbr} / {item.id}</span>
                    </div>
                  </td>
                  <td data-label="数据库类型"><DbBadge type={item.dbType} /></td>
                  <td data-label="卸数时间点">
                    <div className="time-chips">
                      {item.unloadTimes.map((time) => <span key={time} className="time-chip">{time}</span>)}
                    </div>
                  </td>
                  <td data-label="负责人 / 部门">{item.owner} / {item.dept}</td>
                  <td data-label="状态">
                    <StatusBadge status={item.status} />
                  </td>
                  <td data-label="" className="mobile-card-actions" style={{ textAlign: "right" }} onClick={(event) => event.stopPropagation()}>
                    <RowActions
                      disabled={isPending}
                      onEdit={canEdit ? () => onEdit(item.id) : undefined}
                      extraActions={[
                        {
                          key: "view-tables",
                          label: "查看入仓表",
                          icon: "link",
                          onClick: () => onViewTables?.({
                            sourceSystemId: item.upstreamSystemId || "",
                            tab: "table",
                          }),
                        },
                      ]}
                      toggle={canEdit ? {
                        enabled,
                        label: item.name,
                        onToggle: () => onToggle(item.id, enabled ? "disabled" : "enabled"),
                      } : undefined}
                    />
                  </td>
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

