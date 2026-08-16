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

import { Highlight, Icon } from "../ui.jsx";
import { EmptyState, RowActions, StatusBadge } from "../common/index.js";
import { MENU_STATUS_META } from "./constants.js";

export function MenuManagementPage({
  menus,
  query,
  canEdit,
  onNew,
  onEdit,
  onChangeStatus,
  onMove,
}) {
  const normalizedQuery = query.trim().toLowerCase();
  const filteredMenus = menus.filter((item) => {
    if (!normalizedQuery) return true;
    return [item.code, item.name, item.path, item.desc]
      .some((value) => String(value || "").toLowerCase().includes(normalizedQuery));
  });

  return (
    <div className="system-page">
      <div className="page-head">
        <div>
          <div className="page-title"><span className="pt-code">MENU</span>菜单管理</div>
          <div className="page-sub">
            共 <b>{menus.length}</b> 个系统菜单
            {query ? <>，匹配 “{query}” 命中 <b>{filteredMenus.length}</b> 条</> : null}
            ，维护菜单启停与排序，权限分配后续开放。
          </div>
        </div>
        <div className="head-actions">
          <button className="btn primary" type="button" onClick={onNew}>
            <Icon name="plus" size={15} />新增菜单
          </button>
        </div>
      </div>

      {!filteredMenus.length ? (
        <EmptyState
          title="暂无菜单"
          desc={query ? "没有匹配的菜单，试试调整搜索条件。" : "可以新增一条菜单。"}
          actionText={canEdit && !query ? "新增菜单" : ""}
          onAction={canEdit && !query ? onNew : undefined}
        />
      ) : (
        <div className="tbl-wrap">
          <table className="dt mobile-card-table menu-mobile-table">
            <thead>
              <tr>
                <th style={{ width: 110 }}>排序</th>
                <th style={{ width: 200 }}>菜单名称</th>
                <th style={{ width: 140 }}>编码</th>
                <th style={{ width: 200 }}>路由路径</th>
                <th style={{ width: 110 }}>可见范围</th>
                <th style={{ width: 96 }}>状态</th>
                <th>说明</th>
                <th style={{ width: 300, textAlign: "right" }}>操作</th>
                <th style={{ width: 110 }}>导航位置</th>
              </tr>
            </thead>
            <tbody>
              {filteredMenus.map((item, index) => (
                <tr key={item.id}>
                  <td data-label="排序">
                    <div className="system-cell-inline">
                      <span className="mono">{item.order}</span>
                      <button
                        className="btn"
                        type="button"
                        disabled={!!query || index === 0}
                        title="上移"
                        onClick={() => onMove(item, "up")}
                      >
                        <Icon name="up" size={14} />
                      </button>
                      <button
                        className="btn"
                        type="button"
                        disabled={!!query || index === filteredMenus.length - 1}
                        title="下移"
                        onClick={() => onMove(item, "down")}
                      >
                        <Icon name="down" size={14} />
                      </button>
                    </div>
                  </td>
                  <td data-label="">
                    <span className="system-cell-inline">
                      <Icon name={item.icon || "grid"} size={15} />
                      <Highlight text={item.name} q={query} />
                    </span>
                  </td>
                  <td data-label="编码" className="mono"><Highlight text={item.code} q={query} /></td>
                  <td data-label="路由路径" className="mono"><Highlight text={item.path || "-"} q={query} /></td>
                  <td data-label="可见范围">{item.adminOnly ? "仅管理员" : "全部用户"}</td>
                  <td data-label="状态"><StatusBadge status={item.status} metaMap={MENU_STATUS_META} /></td>
                  <td data-label="说明"><span className="system-line-clamp"><Highlight text={item.desc || "-"} q={query} /></span></td>
                  <td data-label="" className="mobile-card-actions" style={{ textAlign: "right" }}>
                    <RowActions
                      onEdit={() => onEdit(item)}
                      toggle={{
                        enabled: item.status === "enabled",
                        label: item.name,
                        onToggle: () => onChangeStatus(item, item.status === "enabled" ? "disabled" : "enabled"),
                      }}
                    />
                  </td>
                  <td data-label="导航位置">{item.navPlacement === "primary" ? "顶栏" : "更多"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
