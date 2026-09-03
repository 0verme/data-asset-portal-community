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

import { isPublicPermission } from "../../auth/permissions.ts";
import { Highlight, Icon } from "../ui.tsx";
import {
  ActionErrorBanner,
  BinaryStatusToggle,
  confirmDeleteAction,
  DangerZone,
  EmptyState,
  FormSection,
  RowActions,
  StatusBadge,
} from "../common/index.ts";

const ROLE_STATUS_META = {
  enabled: { label: "启用", className: "st-on" },
  disabled: { label: "禁用", className: "st-off" },
};

function permissionName(permission) {
  return permission?.name || permission?.code || "未知权限";
}

function requestRoleDeletion(role, onDelete) {
  const name = role.name || role.roleCode;
  return confirmDeleteAction({
    title: "删除角色",
    name,
    typeLabel: "角色",
    impact: `确定删除角色「${name}」吗？删除后不可恢复。`,
    consequences: ["内置角色不可删除。", "仍绑定用户的角色必须先解除用户关联。"],
    confirmKeyword: role.roleCode,
    confirmKeywordLabel: "请输入角色编码二次确认",
    onConfirm: () => onDelete?.(role),
  });
}

export function RoleForm({ form, setForm, permissions, errors = [], mode = "new", initial = null, onDelete }) {
  const isEdit = mode === "edit";
  const hasError = (field) => errors.some((item) => item.field === field);
  const assignablePermissions = permissions.filter((permission) => !isPublicPermission(permission?.code));
  const assignableCodes = new Set(assignablePermissions.map((permission) => permission.code));
  const selected = new Set((form.permissionCodes || []).filter((code) => assignableCodes.has(code)));
  const togglePermission = (code) => {
    setForm((previous) => {
      const current = new Set(
        (previous.permissionCodes || []).filter((permission) => !isPublicPermission(permission)),
      );
      if (current.has(code)) current.delete(code);
      else current.add(code);
      return { ...previous, permissionCodes: [...current].sort() };
    });
  };

  return (
    <>
      <ActionErrorBanner title="请先修正以下问题" messages={errors.map((item) => item.message)} />
      <FormSection title="角色信息">
        <div className="form-grid">
          <div className="fl">
            <label>角色编码</label>
            <input
              className={`inp mono${hasError("roleCode") ? " invalid" : ""}`}
              value={form.roleCode}
              disabled={isEdit}
              maxLength={64}
              onChange={(event) => setForm((previous) => ({ ...previous, roleCode: event.target.value }))}
              placeholder="例如：indicator-maintainer"
            />
            {!isEdit ? <div className="form-hint">仅允许小写字母、数字、短横线和下划线，创建后不可修改。</div> : null}
          </div>
          <div className="fl">
            <label>角色名称</label>
            <input
              className={`inp${hasError("name") ? " invalid" : ""}`}
              value={form.name}
              disabled={Boolean(initial?.builtin)}
              maxLength={128}
              onChange={(event) => setForm((previous) => ({ ...previous, name: event.target.value }))}
              placeholder="例如：指标维护员"
            />
          </div>
          <div className="fl">
            <label>角色状态</label>
            <BinaryStatusToggle
              mode="status"
              value={form.enabled}
              disabled={Boolean(initial?.builtin)}
              className="system-status-seg"
              onChange={(value) => setForm((previous) => ({ ...previous, enabled: value }))}
            />
          </div>
          <div className="fl full">
            <label>角色说明</label>
            <textarea
              className="ta"
              value={form.description}
              disabled={Boolean(initial?.builtin)}
              maxLength={2000}
              onChange={(event) => setForm((previous) => ({ ...previous, description: event.target.value }))}
              placeholder="说明该角色的职责范围"
            />
          </div>
        </div>
      </FormSection>

      <FormSection title={`权限映射（已选 ${selected.size} 项）`}>
        <p className="form-hint">公共只读权限已默认开放，无需在角色中重复配置；此处仅配置角色的额外权限。</p>
        <div className="role-permission-grid">
          {assignablePermissions.map((permission) => (
            <label className="role-permission-option" key={permission.code}>
              <input
                type="checkbox"
                checked={selected.has(permission.code)}
                disabled={Boolean(initial?.builtin)}
                onChange={() => togglePermission(permission.code)}
              />
              <span>
                <b>{permissionName(permission)}</b>
                <small className="mono">{permission.code}</small>
              </span>
            </label>
          ))}
        </div>
      </FormSection>

      {isEdit && initial && !initial.builtin ? (
        <DangerZone
          description="删除角色后将无法恢复。后端会拒绝删除仍绑定用户的角色。"
          actions={[
            {
              key: "delete-role",
              label: "删除角色",
              icon: "trash",
              danger: true,
              onClick: () => requestRoleDeletion(initial, onDelete),
            },
          ]}
        />
      ) : null}
    </>
  );
}

export function RoleManagementPage({ roles, query, canEdit, onNew, onEdit, onDelete, deletingRoleCode = "" }) {
  const normalizedQuery = query.trim().toLowerCase();
  const filteredRoles = roles.filter((role) => [role.roleCode, role.name, role.description]
    .some((value) => String(value || "").toLowerCase().includes(normalizedQuery)));

  return (
    <div className="system-page">
      <div className="page-head">
        <div>
          <div className="page-title"><span className="pt-code">RBAC</span>角色管理</div>
          <div className="page-sub">共 <b>{filteredRoles.length}</b> 个角色{filteredRoles.length !== roles.length ? <>，总量 <b>{roles.length}</b></> : null}{query ? <>，匹配 “{query}”</> : null}</div>
        </div>
        {canEdit ? <div className="head-actions"><button className="btn primary" type="button" onClick={onNew}><Icon name="plus" size={15} />新增角色</button></div> : null}
      </div>

      {!filteredRoles.length ? (
        <EmptyState title="未找到匹配的角色" desc="可以调整搜索条件，或新增一个自定义角色。" actionText={canEdit ? "新增角色" : ""} onAction={canEdit ? onNew : undefined} />
      ) : (
        <div className="tbl-wrap">
          <table className="dt mobile-card-table">
            <thead>
              <tr><th>角色</th><th>类型</th><th>状态</th><th>权限</th><th>绑定用户</th><th>说明</th><th style={{ width: 180, textAlign: "right" }}>操作</th></tr>
            </thead>
            <tbody>
              {filteredRoles.map((role) => (
                <tr key={role.roleCode}>
                  <td data-label="角色"><div className="system-user-name"><Highlight text={role.name || role.roleCode} q={query} /></div><div className="system-user-sub mono"><Highlight text={role.roleCode} q={query} /></div></td>
                  <td data-label="类型">{role.builtin ? "内置" : "自定义"}</td>
                  <td data-label="状态"><StatusBadge status={role.enabled} metaMap={ROLE_STATUS_META} /></td>
                  <td data-label="权限">{role.permissionCodes?.length || 0} 项</td>
                  <td data-label="绑定用户">{role.userCount || 0} 个</td>
                  <td data-label="说明"><span className="system-line-clamp">{role.description || "-"}</span></td>
                  <td data-label="" className="mobile-card-actions" style={{ textAlign: "right" }}>
                    <RowActions
                      disabled={deletingRoleCode === role.roleCode}
                      onEdit={canEdit && !role.builtin ? () => onEdit(role) : undefined}
                      extraActions={canEdit && !role.builtin && onDelete ? [{
                        key: "delete-role",
                        label: "删除",
                        icon: "trash",
                        danger: true,
                        onClick: () => requestRoleDeletion(role, onDelete),
                      }] : []}
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
