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

import type { MenuItem } from "../../data/menus.ts";
import { EmptyState, RowActions, StatusBadge, WideTableScroll } from "../common/index.ts";
import { Highlight, Icon } from "../ui.tsx";
import { Button, IconButton, TablePagination } from "../../ui/index.ts";
import { MENU_STATUS_META } from "./constants.ts";
import { useUiCopy } from "../../i18n/useUiTranslation.ts";

export interface MenuManagementPageProps {
  menus: readonly MenuItem[];
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  query: string;
  canEdit: boolean;
  onNew: () => void;
  onEdit: (menu: MenuItem) => void;
  onChangeStatus: (menu: MenuItem, status: string) => void;
  onMove: (menu: MenuItem, direction: "up" | "down") => void;
}

export function MenuManagementPage({
  menus,
  total,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  query,
  canEdit,
  onNew,
  onEdit,
  onChangeStatus,
  onMove,
}: MenuManagementPageProps) {
  const tx = useUiCopy("admin");
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
          <div className="page-title"><span className="pt-code">MENU</span>{tx("菜单管理")}</div>
          <div className="page-sub">
            {tx("共")}{" "}<b>{total}</b> {tx("个系统菜单")}{query ? <>{tx("，匹配 “")}{query}”</> : null}
            {tx("，维护菜单启停与排序，权限分配后续开放。")}</div>
        </div>
        <div className="head-actions">
          <Button className="btn primary" variant="primary" type="button" onClick={onNew}>
            <Icon name="plus" size={15} />{tx("新增菜单")}</Button>
        </div>
      </div>

      {!filteredMenus.length ? (
        <EmptyState
          title={tx("暂无菜单")}
          desc={tx(query ? "没有匹配的菜单，试试调整搜索条件。" : "可以新增一条菜单。")}
          actionText={canEdit && !query ? tx("新增菜单") : ""}
          onAction={canEdit && !query ? onNew : undefined}
        />
      ) : (
        <div className="tbl-wrap">
          <WideTableScroll ariaLabel={tx("菜单管理表格")}>
            <table className="dt mobile-card-table menu-mobile-table menu-management-table">
              <thead>
                <tr>
                  <th style={{ width: 110 }}>{tx("排序")}</th>
                  <th style={{ width: 200 }}>{tx("菜单名称")}</th>
                  <th style={{ width: 130 }}>{tx("编码")}</th>
                  <th style={{ width: 200 }}>{tx("路由路径")}</th>
                  <th style={{ width: 100 }}>{tx("可见范围")}</th>
                  <th style={{ width: 96 }}>{tx("状态")}</th>
                  <th style={{ width: 224 }}>{tx("说明")}</th>
                  <th style={{ width: 100 }}>{tx("导航位置")}</th>
                  <th className="menu-actions-head" style={{ width: 240, textAlign: "right" }}>{tx("操作")}</th>
                </tr>
              </thead>
              <tbody>
                {filteredMenus.map((item, index) => (
                  <tr key={item.id}>
                    <td data-label={tx("排序")}>
                      <div className="system-cell-inline">
                        <span className="mono">{item.order}</span>
                        <IconButton
                          aria-label={tx("上移")}
                          disabled={!!query || (page === 1 && index === 0)}
                          icon={<Icon name="up" size={14} />}
                          onClick={() => onMove(item, "up")}
                          size="sm"
                          type="button"
                          variant="secondary"
                        />
                        <IconButton
                          aria-label={tx("下移")}
                          disabled={!!query || (page === Math.max(1, Math.ceil(total / pageSize)) && index === filteredMenus.length - 1)}
                          icon={<Icon name="down" size={14} />}
                          onClick={() => onMove(item, "down")}
                          size="sm"
                          type="button"
                          variant="secondary"
                        />
                      </div>
                    </td>
                    <td data-label="" className="menu-name-cell">
                      <span className="system-cell-inline">
                        <Icon name={item.icon || "grid"} size={15} />
                        <Highlight text={item.name} q={query} />
                      </span>
                    </td>
                    <td data-label={tx("编码")} className="mono"><Highlight text={item.code} q={query} /></td>
                    <td data-label={tx("路由路径")} className="mono menu-path-cell"><Highlight text={item.path || "-"} q={query} /></td>
                    <td data-label={tx("可见范围")}>{item.adminOnly ? tx("仅管理员") : tx("全部用户")}</td>
                    <td data-label={tx("状态")}><StatusBadge status={item.status} metaMap={MENU_STATUS_META} /></td>
                    <td data-label={tx("说明")}><span className="system-line-clamp"><Highlight text={item.desc || "-"} q={query} /></span></td>
                    <td data-label={tx("导航位置")}>{item.navPlacement === "primary" ? tx("顶栏") : tx("更多")}</td>
                    <td data-label="" className="mobile-card-actions menu-actions-cell" style={{ textAlign: "right" }}>
                      <RowActions
                        onEdit={() => onEdit(item)}
                        toggle={{
                          enabled: item.status === "enabled",
                          label: item.name,
                          onToggle: () => onChangeStatus(item, item.status === "enabled" ? "disabled" : "enabled"),
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </WideTableScroll>
        </div>
      )}
      <TablePagination
        ariaLabel={tx("菜单管理分页")}
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
      />
    </div>
  );
}
