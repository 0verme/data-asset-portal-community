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

import { useLayoutEffect, useRef, type Dispatch, type SetStateAction } from "react";

import { isPublicPermission } from "../../auth/permissions.ts";
import type {
  SystemPermissionItem,
  SystemRoleItem,
} from "../../api/systemRoles.ts";
import type {
  RoleFormData,
  RoleFormFieldError,
} from "../../hooks/useRoleModule.ts";
import {
  confirmDeleteAction,
  DangerZone,
  EmptyState,
  FormSection,
  RowActions,
  StatusBadge,
  BinaryStatusToggle,
  WideTableScroll,
} from "../common/index.ts";
import { Highlight, Icon } from "../ui.tsx";
import { Button, FormErrorSummary, FormField, focusFirstFormError, Input, TablePagination, Textarea } from "../../ui/index.ts";
import { formFieldErrorEntries } from "../../utils/formFieldErrorMapping.ts";
import { translateUiCopy, useUiCopy } from "../../i18n/useUiTranslation.ts";

const ROLE_FORM_ID = "system-role-form";
const ROLE_FIELD_LABELS: Readonly<Record<string, string>> = {
  roleCode: "角色编码",
  name: "角色名称",
  enabled: "角色状态",
  description: "角色说明",
  permissionCodes: "附加权限",
};

const ROLE_STATUS_META = {
  enabled: { label: "启用", className: "st-on" },
  disabled: { label: "禁用", className: "st-off" },
};

function permissionName(permission: SystemPermissionItem | undefined): string {
  return permission?.name || permission?.code || translateUiCopy("admin", "未知权限");
}

function requestRoleDeletion(
  role: SystemRoleItem,
  onDelete: (role: SystemRoleItem) => void | Promise<unknown>,
): Promise<boolean> {
  const name = role.name || role.roleCode;
  return confirmDeleteAction({
    title: translateUiCopy("admin", "删除角色"),
    name,
    typeLabel: translateUiCopy("admin", "角色"),
    impact: translateUiCopy("admin", "确定删除角色「{{name}}」吗？删除后不可恢复。", { name }),
    consequences: [
      translateUiCopy("admin", "内置角色不可删除。"),
      translateUiCopy("admin", "仍绑定用户的角色必须先解除用户关联。"),
    ],
    confirmKeyword: role.roleCode,
    confirmKeywordLabel: translateUiCopy("admin", "请输入角色编码二次确认"),
    onConfirm: () => onDelete(role),
  });
}

function normalizeStatus(value: string | boolean): string {
  return typeof value === "boolean" ? (value ? "enabled" : "disabled") : value;
}

export interface RoleFormProps {
  form: RoleFormData;
  setForm: Dispatch<SetStateAction<RoleFormData>>;
  permissions: readonly SystemPermissionItem[];
  errors?: readonly RoleFormFieldError[] | undefined;
  focusRevision?: number | undefined;
  onFieldChange?: ((field: string) => void) | undefined;
  mode?: "new" | "edit" | undefined;
  initial?: SystemRoleItem | null | undefined;
  onDelete?: ((role: SystemRoleItem) => void | Promise<unknown>) | undefined;
}

export function RoleForm({
  form,
  setForm,
  permissions,
  errors = [],
  focusRevision = 0,
  onFieldChange,
  mode = "new",
  initial = null,
  onDelete,
}: RoleFormProps) {
  const tx = useUiCopy("admin");
  const isEdit = mode === "edit";
  const fieldErrors = Object.fromEntries(Object.entries(formFieldErrorEntries(errors)).map(([field, message]) => [field, tx(message)]));
  const formRef = useRef<HTMLDivElement>(null);
  const previousFocusRevision = useRef(focusRevision);
  useLayoutEffect(() => {
    if (previousFocusRevision.current === focusRevision) return;
    previousFocusRevision.current = focusRevision;
    focusFirstFormError(formRef.current, fieldErrors, "auto");
  }, [fieldErrors, focusRevision]);
  const clearField = (field: string) => onFieldChange?.(field);
  const assignablePermissions = permissions.filter(
    (permission) => !isPublicPermission(permission.code),
  );
  const assignableCodes = new Set(
    assignablePermissions.map((permission) => permission.code),
  );
  const selected = new Set(
    (form.permissionCodes || []).filter((code) => assignableCodes.has(code)),
  );
  const togglePermission = (code: string) => {
    clearField("permissionCodes");
    setForm((previous) => {
      const current = new Set(
        (previous.permissionCodes || []).filter(
          (permission) => !isPublicPermission(permission),
        ),
      );
      if (current.has(code)) current.delete(code);
      else current.add(code);
      return { ...previous, permissionCodes: [...current].sort() };
    });
  };

  return (
    <div id={ROLE_FORM_ID} ref={formRef}>
      <FormErrorSummary
        formId={ROLE_FORM_ID}
        errors={fieldErrors}
        getFieldLabel={(field) => tx(ROLE_FIELD_LABELS[field] || "表单内容")}
      />
      <FormSection title={tx("角色信息")}>
        <div className="form-grid">
          <FormField
            className="fl"
            formId={ROLE_FORM_ID}
            name="roleCode"
            label={tx("角色编码")}
            error={fieldErrors["roleCode"]}
            description={!isEdit ? tx("仅允许小写字母、数字、短横线和下划线，创建后不可修改。") : undefined}
          >
            <Input
              aria-label={tx("角色编码")}
              className={`inp mono${fieldErrors["roleCode"] ? " invalid" : ""}`}
              value={form.roleCode}
              disabled={isEdit}
              maxLength={64}
              onChange={(event) => {
                clearField("roleCode");
                setForm((previous) => ({ ...previous, roleCode: event.target.value }));
              }}
              placeholder={tx("例如：indicator-maintainer")}
            />
          </FormField>
          <FormField className="fl" formId={ROLE_FORM_ID} name="name" label={tx("角色名称")} error={fieldErrors["name"]}>
            <Input
              aria-label={tx("角色名称")}
              className={`inp${fieldErrors["name"] ? " invalid" : ""}`}
              value={form.name}
              disabled={Boolean(initial?.builtin)}
              maxLength={128}
              onChange={(event) => {
                clearField("name");
                setForm((previous) => ({ ...previous, name: event.target.value }));
              }}
              placeholder={tx("例如：指标维护员")}
            />
          </FormField>
          <FormField className="fl" formId={ROLE_FORM_ID} name="enabled" label={tx("角色状态")} error={fieldErrors["enabled"]}>
            <div role="group" aria-label={tx("角色状态")}>
              <BinaryStatusToggle
                mode="status"
                value={form.enabled}
                disabled={Boolean(initial?.builtin)}
                className="system-status-seg"
                onChange={(value) => {
                  clearField("enabled");
                  setForm((previous) => ({ ...previous, enabled: normalizeStatus(value) }));
                }}
              />
            </div>
          </FormField>
          <FormField className="fl full" formId={ROLE_FORM_ID} name="description" label={tx("角色说明")} error={fieldErrors["description"]}>
            <Textarea
              aria-label={tx("角色说明")}
              className="ta"
              value={form.description}
              disabled={Boolean(initial?.builtin)}
              maxLength={2000}
              onChange={(event) => {
                clearField("description");
                setForm((previous) => ({ ...previous, description: event.target.value }));
              }}
              placeholder={tx("说明该角色的职责范围")}
            />
          </FormField>
        </div>
      </FormSection>

      <FormSection title={tx("权限映射（已选 {{count}} 项）", { count: selected.size })}>
        <p className="form-hint">
          {tx("公共只读权限已默认开放，无需在角色中重复配置；此处仅配置角色的额外权限。")}</p>
        <FormField className="fl full" formId={ROLE_FORM_ID} name="permissionCodes" label={tx("附加权限")} error={fieldErrors["permissionCodes"]}>
          <div className="role-permission-grid" role="group" aria-label={tx("附加权限")}>
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
        </FormField>
      </FormSection>

      {isEdit && initial && !initial.builtin ? (
        <DangerZone
          description={tx("删除角色后将无法恢复。后端会拒绝删除仍绑定用户的角色。")}
          actions={[
            {
              key: "delete-role",
              label: tx("删除角色"),
              icon: "trash",
              danger: true,
              onClick: () =>
                requestRoleDeletion(initial, onDelete || (() => undefined)),
            },
          ]}
        />
      ) : null}
    </div>
  );
}

export interface RoleManagementPageProps {
  roles: readonly SystemRoleItem[];
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  permissions?: readonly SystemPermissionItem[] | undefined;
  query: string;
  canEdit: boolean;
  onNew: () => void;
  onEdit: (role: SystemRoleItem) => void;
  onDelete: (role?: SystemRoleItem | null) => void | Promise<unknown>;
  deletingRoleCode?: string | undefined;
}

export function RoleManagementPage({
  roles,
  total,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  query,
  canEdit,
  onNew,
  onEdit,
  onDelete,
  deletingRoleCode = "",
}: RoleManagementPageProps) {
  const tx = useUiCopy("admin");
  const normalizedQuery = query.trim().toLowerCase();
  const filteredRoles = roles.filter((role) =>
    [role.roleCode, role.name, role.description].some((value) =>
      String(value || "")
        .toLowerCase()
        .includes(normalizedQuery),
    ),
  );

  return (
    <div className="system-page">
      <div className="page-head">
        <div>
          <div className="page-title">
            <span className="pt-code">RBAC</span>{tx("角色管理")}</div>
          <div className="page-sub">
            {tx("共")}{" "}<b>{total}</b> {tx("个角色")}{query ? <>{tx("，匹配 “")}{query}”</> : null}
          </div>
        </div>
        {canEdit ? (
          <div className="head-actions">
            <Button className="btn primary" variant="primary" type="button" onClick={onNew}>
              <Icon name="plus" size={15} />
              {tx("新增角色")}</Button>
          </div>
        ) : null}
      </div>

      {!filteredRoles.length ? (
        <EmptyState
          title={tx("未找到匹配的角色")}
          desc={tx("可以调整搜索条件，或新增一个自定义角色。")}
          actionText={canEdit ? tx("新增角色") : ""}
          onAction={canEdit ? onNew : undefined}
        />
      ) : (
        <div className="tbl-wrap">
          <WideTableScroll ariaLabel={tx("角色管理表格")} className="system-roles-wide-scroll">
            <table className="dt mobile-card-table system-roles-table">
            <thead>
              <tr>
                <th>{tx("角色")}</th>
                <th>{tx("类型")}</th>
                <th>{tx("状态")}</th>
                <th>{tx("权限")}</th>
                <th>{tx("绑定用户")}</th>
                <th>{tx("说明")}</th>
                <th style={{ width: 180, textAlign: "right" }}>{tx("操作")}</th>
              </tr>
            </thead>
            <tbody>
              {filteredRoles.map((role) => (
                <tr key={role.roleCode}>
                  <td data-label={tx("角色")}>
                    <div className="system-user-name">
                      <Highlight text={role.name || role.roleCode} q={query} />
                    </div>
                    <div className="system-user-sub mono">
                      <Highlight text={role.roleCode} q={query} />
                    </div>
                  </td>
                  <td data-label={tx("类型")}>{role.builtin ? tx("内置") : tx("自定义")}</td>
                  <td data-label={tx("状态")}>
                    <StatusBadge
                      status={role.enabled}
                      metaMap={ROLE_STATUS_META}
                    />
                  </td>
                  <td data-label={tx("权限")}>
                    {role.permissionCodes?.length || 0} {tx("项")}</td>
                  <td data-label={tx("绑定用户")}>{role.userCount || 0} {tx("个")}</td>
                  <td data-label={tx("说明")}>
                    <span className="system-line-clamp">
                      {role.description || "-"}
                    </span>
                  </td>
                  <td
                    data-label=""
                    className="mobile-card-actions"
                    style={{ textAlign: "right" }}
                  >
                    <RowActions
                      disabled={deletingRoleCode === role.roleCode}
                      onEdit={
                        canEdit && !role.builtin
                          ? () => onEdit(role)
                          : undefined
                      }
                      extraActions={
                        canEdit && !role.builtin
                          ? [
                              {
                                key: "delete-role",
                                label: tx("删除"),
                                icon: "trash",
                                danger: true,
                                onClick: () =>
                                  requestRoleDeletion(role, onDelete),
                              },
                            ]
                          : []
                      }
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
        ariaLabel={tx("角色管理分页")}
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
      />
    </div>
  );
}
