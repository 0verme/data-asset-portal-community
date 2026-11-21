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

import type { PublicUpstreamSystem } from "../../api/upstream.ts";
import type { MappingRoute } from "../../routing/types.ts";
import { CardGridView, EmptyState, RowActions, StatusBadge, ViewModeSwitcher, WideTableScroll } from "../common/index.ts";
import type { ViewMode } from "../common/ViewModeSwitcher.tsx";
import { Icon } from "../ui.tsx";
import { Button, Select } from "../../ui/index.ts";
import { DbBadge } from "./UpstreamParts.tsx";

/**
 * Lightweight connection locator line for the card view. The remote API only
 * returns these fields under the `internal` profile; under `strict` they are
 * absent and the line is not rendered.
 */
function UpstreamConnectionMeta({ system }: { system: PublicUpstreamSystem }) {
  const items: Array<[string, string]> = [];
  if (system.schema) items.push(["Schema", system.schema]);
  if (system.host) items.push(["连接", system.host]);
  else if (system.db) items.push(["数据库", system.db]);
  if (!items.length) return null;
  return (
    <div className="upstream-connection">
      {items.map(([label, value]) => (
        <span key={label} className="uc-item">
          <span className="uc-label">{label}</span>
          <span className="uc-value mono">{value}</span>
        </span>
      ))}
    </div>
  );
}

export interface UpstreamListProps {
  systems: readonly PublicUpstreamSystem[];
  total?: number | undefined;
  pendingIds?: readonly string[] | undefined;
  query: string;
  view: ViewMode;
  onChangeView: (view: ViewMode) => void;
  onOpen: (systemId: string) => void;
  onEdit?: ((systemId: string) => void) | undefined;
  onNew?: (() => void) | undefined;
  onToggle: (systemId: string, status: string) => void | Promise<unknown>;
  onViewTables?: ((route: Partial<MappingRoute>) => void) | undefined;
  sort: string;
  onSortChange: (sort: string) => void;
  canEdit?: boolean | undefined;
}

export function UpstreamList({
  systems,
  total = systems.length,
  pendingIds = [],
  query,
  view,
  onChangeView,
  onOpen,
  onEdit,
  onNew,
  onToggle,
  onViewTables,
  sort,
  onSortChange,
  canEdit = false,
}: UpstreamListProps) {
  return (
    <section className="upstream-page upstream-list-page" aria-labelledby="upstream-list-title">
      <header className="page-head">
        <div>
          <h1 id="upstream-list-title" className="page-title"><Icon name="download" size={21} color="var(--ink-2)" />上游卸数系统</h1>
          <div className="page-sub">
            上游业务系统按计划将数据卸载至数据湖，共 <b>{total}</b> 个{query ? <>，匹配“{query}”</> : null}
          </div>
        </div>
        <div className="head-actions">
          <Select<string>
            aria-label="上游系统排序"
            className="table-list-sort"
            size="sm"
            value={sort}
            onValueChange={(value) => onSortChange(value || "abbr:asc")}
            items={[
              { label: "缩写升序", value: "abbr:asc" },
              { label: "名称升序", value: "name:asc" },
              { label: "标识升序", value: "id:asc" },
              { label: "标识降序", value: "id:desc" },
            ]}
          />
          <ViewModeSwitcher value={view} onChange={onChangeView} modes={["card", "list"] as const} />
          {canEdit && onNew ? <Button className="btn primary" variant="primary" type="button" onClick={onNew}><Icon name="plus" size={15} />新增系统</Button> : null}
        </div>
      </header>

      {!systems.length ? (
        <EmptyState title="未找到匹配的系统" desc="换个关键词试试，或者新增上游系统。" />
      ) : view === "card" ? (
        <CardGridView
          items={systems}
          getKey={(item) => item.id}
          getAccessibleLabel={(item) => `查看${item.name}详情`}
          onItemClick={(item) => onOpen(item.id)}
          renderBadges={(item) => (
            <>
              <DbBadge type={item.dbType} />
              <StatusBadge status={item.status} />
            </>
          )}
          renderTitle={(item) => item.name}
          renderSubtitle={(item) => `${item.abbr} / ${item.id}`}
          renderDesc={(item) => (
            <>
              <span className="upstream-card-description">{item.desc}</span>
              <UpstreamConnectionMeta system={item} />
            </>
          )}
          renderFootLeft={(item) => (
            <div className="upstream-card-schedule">
              <span className="upstream-card-foot-label">卸数时间</span>
              <div className="time-chips">
                {item.unloadTimes.map((time) => <span key={time} className="time-chip">{time}</span>)}
              </div>
            </div>
          )}
          renderFootMeta={(item) => (
            <span className="m"><Icon name="user" size={13} /><span>{item.owner} / {item.dept}</span></span>
          )}
          renderFootActions={(item) => {
            const enabled = item.status === "enabled";
            return (
              <RowActions
                disabled={pendingIds.includes(item.id)}
                onView={() => onOpen(item.id)}
                onEdit={canEdit && onEdit ? () => onEdit(item.id) : undefined}
                extraActions={[
                  {
                    key: "view-tables",
                    label: "查看入仓表",
                    icon: "link",
                    onClick: () => onViewTables?.({ sourceSystemId: String(item.upstreamSystemId || ""), tab: "table" }),
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
          <WideTableScroll ariaLabel="上游卸数系统列表" className="upstream-wide-scroll">
            <table className="dt mobile-card-table upstream-wide-table">
            <thead>
              <tr>
                <th style={{ width: "24%" }}>系统</th>
                <th style={{ width: 140 }}>数据库类型</th>
                <th>卸数时间点</th>
                <th style={{ width: 150 }}>负责人 / 部门</th>
                <th style={{ width: 96 }}>状态</th>
                <th style={{ width: 300, textAlign: "right" }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {systems.map((item) => {
                const isPending = pendingIds.includes(item.id);
                const enabled = item.status === "enabled";
                return (
                  <tr
                    key={item.id}
                    tabIndex={0}
                    aria-label={`查看${item.name}详情`}
                    onClick={() => onOpen(item.id)}
                    onKeyDown={(event) => {
                      if (event.target !== event.currentTarget) return;
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onOpen(item.id);
                      }
                    }}
                  >
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
                    <td data-label="状态"><StatusBadge status={item.status} /></td>
                    <td data-label="" className="mobile-card-actions" style={{ textAlign: "right" }} onClick={(event) => event.stopPropagation()}>
                      <RowActions
                        disabled={isPending}
                        onView={() => onOpen(item.id)}
                        onEdit={canEdit && onEdit ? () => onEdit(item.id) : undefined}
                        extraActions={[
                          {
                            key: "view-tables",
                            label: "查看入仓表",
                            icon: "link",
                            onClick: () => onViewTables?.({ sourceSystemId: String(item.upstreamSystemId || ""), tab: "table" }),
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
          </WideTableScroll>
        </div>
      )}
    </section>
  );
}
