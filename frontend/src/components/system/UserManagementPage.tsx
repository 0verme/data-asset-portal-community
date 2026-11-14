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

import type { RowAction } from "../common/RowActions.tsx";
import type { MockSystemUser } from "../../data/systemUsers.ts";
import { formatDateTime } from "../../utils/date.ts";
import { EmptyState, RowActions, StatusBadge, WideTableScroll } from "../common/index.ts";
import { Highlight, Icon, initial } from "../ui.tsx";
import { Button, TablePagination } from "../../ui/index.ts";
import { USER_ROLE_META, USER_STATUS_META } from "./constants.ts";
import { useUiCopy } from "../../i18n/useUiTranslation.ts";

// 用户账号状态统一为启用/禁用，重置密码和状态切换作为业务动作展示。
export function buildUserStatusActions(
  user: MockSystemUser,
  onResetPassword: (user: MockSystemUser) => void,
  onChangeStatus: (user: MockSystemUser, status: string) => void,
  translate: (source: string, options?: Readonly<Record<string, unknown>>) => string = (source) => source,
): RowAction[] {
  const label = user.displayName || user.username;
  return [
    {
      key: "reset",
      label: translate("重置密码"),
      icon: "key",
      onClick: () => onResetPassword(user),
      confirm: {
        title: translate("确认重置密码？"),
        content: translate("重置后，该用户的密码将恢复为当前用户名。"),
        details: [
          translate("用户名：{{username}}", { username: user.username }),
          translate("显示名：{{displayName}}", { displayName: user.displayName || "-" }),
        ],
        confirmText: translate("确认重置"),
        cancelText: translate("取消"),
      },
    },
    user.status === "enabled"
      ? {
          key: "disable",
          label: translate("禁用"),
          icon: "close",
          onClick: () => onChangeStatus(user, "disabled"),
          confirm: { title: translate("禁用"), content: translate("确定禁用 {{label}} 吗？", { label }), confirmText: translate("禁用") },
        }
      : { key: "enable", label: translate("启用"), icon: "check", onClick: () => onChangeStatus(user, "enabled") },
  ];
}

export interface UserManagementPageProps {
  users: readonly MockSystemUser[];
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  query: string;
  canEdit: boolean;
  onNew: () => void;
  onEdit: (user: MockSystemUser) => void;
  onResetPassword: (user: MockSystemUser) => void;
  onChangeStatus: (user: MockSystemUser, status: string) => void;
}

export function UserManagementPage({
  users,
  total,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  query,
  canEdit,
  onNew,
  onEdit,
  onResetPassword,
  onChangeStatus,
}: UserManagementPageProps) {
  const tx = useUiCopy("admin");
  const filteredUsers = users;

  return (
    <div className="system-page">
      <div className="page-head">
        <div>
          <div className="page-title"><span className="pt-code">SYS</span>{tx("用户管理")}</div>
          <div className="page-sub">
            {tx("共")}{" "}<b>{total}</b> {tx("个账号")}{query ? <>{tx("，匹配 “")}{query}”</> : null}
          </div>
        </div>
        <div className="head-actions">
          <Button className="btn primary" variant="primary" type="button" onClick={onNew}>
            <Icon name="plus" size={15} />{tx("新增用户")}</Button>
        </div>
      </div>

      {!filteredUsers.length ? (
        <EmptyState
          title={tx("未找到匹配的用户")}
          desc={tx("可以调整搜索条件，或直接新增一个系统账号。")}
          actionText={canEdit ? tx("新增用户") : ""}
          onAction={canEdit ? onNew : undefined}
        />
      ) : (
        <div className="tbl-wrap">
          <WideTableScroll ariaLabel={tx("用户管理表格")} className="system-users-wide-scroll">
            <table className="dt mobile-card-table system-users-table">
            <thead>
              <tr>
                <th style={{ width: 180 }}>{tx("用户名")}</th>
                <th style={{ width: 160 }}>{tx("显示名")}</th>
                <th style={{ width: 96 }}>{tx("状态")}</th>
                <th style={{ width: 176 }}>{tx("最后登录时间")}</th>
                <th style={{ width: 176 }}>{tx("创建时间")}</th>
                <th>{tx("备注")}</th>
                <th style={{ width: 280, textAlign: "right" }}>{tx("操作")}</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((user) => (
                <tr key={user.username}>
                  <td data-label="">
                    <div className="system-user-cell">
                      <span className="system-avatar">{initial(user.displayName || user.username)}</span>
                      <div>
                        <div className="system-user-name mono"><Highlight text={user.username} q={query} /></div>
                        {user.email.trim() ? (
                          <div className="system-user-sub"><Highlight text={user.email} q={query} /></div>
                        ) : null}
                        <div className="system-user-sub">{tx(USER_ROLE_META[user.role] || "系统管理员")}</div>
                      </div>
                    </div>
                  </td>
                  <td data-label={tx("显示名")}><Highlight text={user.displayName || "-"} q={query} /></td>
                  <td data-label={tx("状态")}><StatusBadge status={user.status} metaMap={USER_STATUS_META} /></td>
                  <td data-label={tx("最后登录")} className="mono">{formatDateTime(user.lastLoginAt)}</td>
                  <td data-label={tx("创建时间")} className="mono">{formatDateTime(user.createdAt)}</td>
                  <td data-label={tx("备注")}><span className="system-line-clamp"><Highlight text={user.remark || "-"} q={query} /></span></td>
                  <td data-label="" className="mobile-card-actions" style={{ textAlign: "right" }}>
                    <RowActions
                      onEdit={() => onEdit(user)}
                      extraActions={buildUserStatusActions(user, onResetPassword, onChangeStatus, tx)}
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
        ariaLabel={tx("用户管理分页")}
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
      />
    </div>
  );
}
