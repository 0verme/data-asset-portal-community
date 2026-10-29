import { useLayoutEffect, useMemo, useRef, type Dispatch, type SetStateAction } from "react";

import type { MockSystemUser } from "../../data/systemUsers.ts";
import type { RoleFormData } from "../../hooks/useRoleModule.ts";
import type { UserFormData, SystemFormFieldError } from "../../hooks/useSystemModule.ts";
import { BinaryStatusToggle, confirmDeleteAction, DangerZone, FormSection } from "../common/index.ts";
import { FormErrorSummary, FormField, focusFirstFormError } from "../../ui/index.ts";
import { Input, Select, Textarea } from "../../ui/index.ts";
import { formFieldErrorEntries } from "../../utils/formFieldErrorMapping.ts";

const USER_FORM_ID = "system-user-form";
const USER_FIELD_LABELS: Readonly<Record<string, string>> = {
  username: "用户名",
  displayName: "显示名",
  email: "邮箱",
  status: "账号状态",
  role: "账号角色",
  remark: "备注",
};

function normalizeStatus(value: string | boolean): string {
  return typeof value === "boolean" ? (value ? "enabled" : "disabled") : value;
}

type UserRoleOption = Pick<RoleFormData, "roleCode" | "name"> & { enabled?: string | undefined };

export interface UserFormProps {
  form: UserFormData;
  setForm: Dispatch<SetStateAction<UserFormData>>;
  roles?: readonly UserRoleOption[] | undefined;
  errors?: readonly SystemFormFieldError[] | undefined;
  focusRevision?: number | undefined;
  onFieldChange?: ((field: string) => void) | undefined;
  mode?: "new" | "edit" | undefined;
  initial?: MockSystemUser | null | undefined;
  onDelete?: ((user: MockSystemUser) => void) | undefined;
}

export function UserForm({
  form,
  setForm,
  roles = [],
  errors = [],
  focusRevision = 0,
  onFieldChange,
  mode = "new",
  initial = null,
  onDelete,
}: UserFormProps) {
  const isEdit = mode === "edit";
  const fieldErrors = useMemo(() => formFieldErrorEntries(errors), [errors]);
  const formRef = useRef<HTMLDivElement>(null);
  const previousFocusRevision = useRef(focusRevision);
  useLayoutEffect(() => {
    if (previousFocusRevision.current === focusRevision) return;
    previousFocusRevision.current = focusRevision;
    focusFirstFormError(formRef.current, fieldErrors, "auto");
  }, [fieldErrors, focusRevision]);
  const clearField = (field: string) => onFieldChange?.(field);
  const roleOptions: readonly UserRoleOption[] = roles.length ? roles : [
    { roleCode: "admin", name: "系统管理员" },
    { roleCode: "maintainer", name: "业务维护员" },
  ];

  return (
    <div id={USER_FORM_ID} ref={formRef}>
      <FormErrorSummary
        formId={USER_FORM_ID}
        errors={fieldErrors}
        getFieldLabel={(field) => USER_FIELD_LABELS[field] || "表单内容"}
      />
      <FormSection title="基本信息">
        <div className="form-grid">
          <FormField
            className="fl"
            formId={USER_FORM_ID}
            name="username"
            label="用户名"
            error={fieldErrors["username"]}
            description={!isEdit ? "初始密码默认为用户名，可由管理员后续重置。" : undefined}
          >
            <Input
              aria-label="用户名"
              className={`inp mono${fieldErrors["username"] ? " invalid" : ""}`}
              value={form.username}
              maxLength={64}
              onChange={(event) => {
                clearField("username");
                setForm((prev) => ({ ...prev, username: event.target.value }));
              }}
              placeholder="例如：admin"
            />
          </FormField>
          <FormField className="fl" formId={USER_FORM_ID} name="displayName" label="显示名" error={fieldErrors["displayName"]}>
            <Input
              aria-label="显示名"
              className={`inp${fieldErrors["displayName"] ? " invalid" : ""}`}
              value={form.displayName}
              onChange={(event) => {
                clearField("displayName");
                setForm((prev) => ({ ...prev, displayName: event.target.value }));
              }}
              placeholder="例如：系统管理员"
            />
          </FormField>
          <FormField className="fl" formId={USER_FORM_ID} name="email" label="邮箱" error={fieldErrors["email"]}>
            <Input
              aria-label="邮箱"
              className={`inp${fieldErrors["email"] ? " invalid" : ""}`}
              value={form.email}
              onChange={(event) => {
                clearField("email");
                setForm((prev) => ({ ...prev, email: event.target.value }));
              }}
              placeholder="例如：admin@dataportal.local"
            />
          </FormField>
          <FormField className="fl" formId={USER_FORM_ID} name="status" label="账号状态" error={fieldErrors["status"]}>
            <div role="group" aria-label="账号状态">
              <BinaryStatusToggle mode="status" value={form.status} className="system-status-seg" onChange={(value) => {
                clearField("status");
                setForm((prev) => ({ ...prev, status: normalizeStatus(value) }));
              }} />
            </div>
          </FormField>
          <FormField className="fl" formId={USER_FORM_ID} name="role" label="账号角色" error={fieldErrors["role"]}>
            <Select<string>
              aria-label="账号角色"
              className="sel"
              items={roleOptions.filter((role) => role.enabled !== "disabled").map((role) => ({ label: role.name || role.roleCode, value: role.roleCode }))}
              value={form.role || null}
              onValueChange={(value) => {
                clearField("role");
                setForm((prev) => ({ ...prev, role: value || "" }));
              }}
            />
          </FormField>
          <FormField className="fl full" formId={USER_FORM_ID} name="remark" label="备注" error={fieldErrors["remark"]}>
            <Textarea
              aria-label="备注"
              className="ta"
              value={form.remark}
              onChange={(event) => {
                clearField("remark");
                setForm((prev) => ({ ...prev, remark: event.target.value }));
              }}
              placeholder="补充账号用途、职责范围或禁用原因"
            />
          </FormField>
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
    </div>
  );
}
