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

import { Highlight, Icon, initial } from "../ui.jsx";
import { EmptyState, RowActions, StatusBadge } from "../common/index.js";
import { formatDateTime } from "../../utils/date.ts";
import { USER_ROLE_META, USER_STATUS_META } from "./constants.js";

// 用户账号状态统一为启用/禁用，重置密码和状态切换作为业务动作展示。
export function buildUserStatusActions(user, onResetPassword, onChangeStatus) {
  const label = user.displayName || user.username;
  return [
    {
      key: "reset",
      label: "重置密码",
      icon: "key",
      onClick: () => onResetPassword(user),
      confirm: {
        title: "确认重置密码？",
        content: "重置后，该用户的密码将恢复为当前用户名。",
        details: [`用户名：${user.username}`, `显示名：${user.displayName || "-"}`],
        confirmText: "确认重置",
        cancelText: "取消",
      },
    },
    user.status === "enabled"
      ? {
          key: "disable",
          label: "禁用",
          icon: "close",
          onClick: () => onChangeStatus(user, "disabled"),
          confirm: { title: "禁用", content: `确定禁用 ${label} 吗？`, confirmText: "禁用" },
        }
      : { key: "enable", label: "启用", icon: "check", onClick: () => onChangeStatus(user, "enabled") },
  ];
}

export function UserManagementPage({
  users,
  query,
  canEdit,
  onNew,
  onEdit,
  onResetPassword,
  onChangeStatus,
}) {
  const normalizedQuery = query.trim().toLowerCase();
  const filteredUsers = users.filter((user) => {
    if (!normalizedQuery) return true;
    return [user.username, user.displayName, user.email, user.status, USER_ROLE_META[user.role] || user.role]
      .some((value) => String(value || "").toLowerCase().includes(normalizedQuery));
  });

  return (
    <div className="system-page">
      <div className="page-head">
        <div>
          <div className="page-title"><span className="pt-code">SYS</span>用户管理</div>
          <div className="page-sub">
            共 <b>{filteredUsers.length}</b> 个账号
            {filteredUsers.length !== users.length ? <>，总量 <b>{users.length}</b></> : null}
            {query ? <>，匹配 “{query}”</> : null}
          </div>
        </div>
        <div className="head-actions">
          <button className="btn primary" type="button" onClick={onNew}>
            <Icon name="plus" size={15} />新增用户
          </button>
        </div>
      </div>

      {!filteredUsers.length ? (
        <EmptyState
          title="未找到匹配的用户"
          desc="可以调整搜索条件，或直接新增一个系统账号。"
          actionText={canEdit ? "新增用户" : ""}
          onAction={canEdit ? onNew : undefined}
        />
      ) : (
        <div className="tbl-wrap">
          <table className="dt mobile-card-table">
            <thead>
              <tr>
                <th style={{ width: 180 }}>用户名</th>
                <th style={{ width: 160 }}>显示名</th>
                <th style={{ width: 96 }}>状态</th>
                <th style={{ width: 176 }}>最后登录时间</th>
                <th style={{ width: 176 }}>创建时间</th>
                <th>备注</th>
                <th style={{ width: 280, textAlign: "right" }}>操作</th>
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
                        {typeof user.email === "string" && user.email.trim() ? (
                          <div className="system-user-sub"><Highlight text={user.email} q={query} /></div>
                        ) : null}
                        <div className="system-user-sub">{USER_ROLE_META[user.role] || "系统管理员"}</div>
                      </div>
                    </div>
                  </td>
                  <td data-label="显示名"><Highlight text={user.displayName || "-"} q={query} /></td>
                  <td data-label="状态"><StatusBadge status={user.status} metaMap={USER_STATUS_META} /></td>
                  <td data-label="最后登录" className="mono">{formatDateTime(user.lastLoginAt)}</td>
                  <td data-label="创建时间" className="mono">{formatDateTime(user.createdAt)}</td>
                  <td data-label="备注"><span className="system-line-clamp"><Highlight text={user.remark || "-"} q={query} /></span></td>
                  <td data-label="" className="mobile-card-actions" style={{ textAlign: "right" }}>
                    <RowActions
                      onEdit={() => onEdit(user)}
                      extraActions={buildUserStatusActions(user, onResetPassword, onChangeStatus)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
