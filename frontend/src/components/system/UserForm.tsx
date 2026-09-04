import type { Dispatch, SetStateAction } from "react";

import type { MockSystemUser } from "../../data/systemUsers.ts";
import type { RoleFormData } from "../../hooks/useRoleModule.ts";
import type { UserFormData, SystemFormFieldError } from "../../hooks/useSystemModule.ts";
import { ActionErrorBanner, BinaryStatusToggle, confirmDeleteAction, DangerZone, FormSection } from "../common/index.ts";

function normalizeStatus(value: string | boolean): string {
  return typeof value === "boolean" ? (value ? "enabled" : "disabled") : value;
}

type UserRoleOption = Pick<RoleFormData, "roleCode" | "name"> & { enabled?: string | undefined };

export interface UserFormProps {
  form: UserFormData;
  setForm: Dispatch<SetStateAction<UserFormData>>;
  roles?: readonly UserRoleOption[] | undefined;
  errors?: readonly SystemFormFieldError[] | undefined;
  mode?: "new" | "edit" | undefined;
  initial?: MockSystemUser | null | undefined;
  onDelete?: ((user: MockSystemUser) => void) | undefined;
}

export function UserForm({
  form,
  setForm,
  roles = [],
  errors = [],
  mode = "new",
  initial = null,
  onDelete,
}: UserFormProps) {
  const hasError = (field: string) => errors.some((item) => item.field === field);
  const isEdit = mode === "edit";
  const roleOptions: readonly UserRoleOption[] = roles.length ? roles : [
    { roleCode: "admin", name: "系统管理员" },
    { roleCode: "maintainer", name: "业务维护员" },
  ];

  return (
    <>
      <ActionErrorBanner title="请先修正以下问题" messages={errors.map((item) => item.message)} />

      <FormSection title="基本信息">
        <div className="form-grid">
          <div className="fl">
            <label>用户名</label>
            <input
              className={`inp mono${hasError("username") ? " invalid" : ""}`}
              value={form.username}
              maxLength={64}
              onChange={(event) => setForm((prev) => ({ ...prev, username: event.target.value }))}
              placeholder="例如：admin"
            />
            {!isEdit ? <div className="form-hint">初始密码默认为用户名，可由管理员后续重置。</div> : null}
          </div>
          <div className="fl">
            <label>显示名</label>
            <input
              className={`inp${hasError("displayName") ? " invalid" : ""}`}
              value={form.displayName}
              onChange={(event) => setForm((prev) => ({ ...prev, displayName: event.target.value }))}
              placeholder="例如：系统管理员"
            />
          </div>
          <div className="fl">
            <label>邮箱</label>
            <input
              className="inp"
              value={form.email}
              onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
              placeholder="例如：admin@dataportal.local"
            />
          </div>
          <div className="fl">
            <label>账号状态</label>
            <BinaryStatusToggle mode="status" value={form.status} className="system-status-seg" onChange={(value) => setForm((prev) => ({ ...prev, status: normalizeStatus(value) }))} />
          </div>
          <div className="fl">
            <label>账号角色</label>
            <select className="sel" value={form.role} onChange={(event) => setForm((prev) => ({ ...prev, role: event.target.value }))}>
              {roleOptions.filter((role) => role.enabled !== "disabled").map((role) => (
                <option value={role.roleCode} key={role.roleCode}>{role.name || role.roleCode}</option>
              ))}
            </select>
          </div>
          <div className="fl full">
            <label>备注</label>
            <textarea
              className="ta"
              value={form.remark}
              onChange={(event) => setForm((prev) => ({ ...prev, remark: event.target.value }))}
              placeholder="补充账号用途、职责范围或禁用原因"
            />
          </div>
        </div>
      </FormSection>

      {isEdit && initial ? (
        <DangerZone
          description="删除用户后将无法恢复，相关历史审计记录仍会保留。若账号不再使用，建议优先禁用。"
          actions={[
            {
              key: "delete-user",
              label: "删除用户",
              icon: "trash",
              danger: true,
              onClick: async () => {
                if (await confirmDeleteAction({
                  name: initial.displayName || initial.username,
                  typeLabel: "用户",
                  impact: "该用户删除后，可能影响权限追溯、历史任务记录和审计日志。若仅停止使用，建议优先禁用。",
                  consequences: [
                    "删除前应以后端权限和审计规则校验结果为准。",
                    "若后端返回不可删除原因，页面会直接展示原因。",
                  ],
                  confirmKeyword: initial.username || "",
                  confirmKeywordLabel: "请输入用户名二次确认",
                })) {
                  onDelete?.(initial);
                }
              },
            },
          ]}
        />
      ) : null}
    </>
  );
}
