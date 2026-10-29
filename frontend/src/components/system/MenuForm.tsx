import { useLayoutEffect, useMemo, useRef, type Dispatch, type SetStateAction } from "react";

import type { MenuItem } from "../../data/menus.ts";
import type { MenuFormData, SystemFormFieldError } from "../../hooks/useSystemModule.ts";
import { BinaryStatusToggle, confirmDeleteAction, DangerZone, FormSection } from "../common/index.ts";
import { MENU_ICON_OPTIONS } from "./constants.ts";
import { Checkbox, FormErrorSummary, FormField, focusFirstFormError, Input, Select, Textarea } from "../../ui/index.ts";
import { formFieldErrorEntries } from "../../utils/formFieldErrorMapping.ts";

const MENU_FORM_ID = "system-menu-form";
const MENU_FIELD_LABELS: Readonly<Record<string, string>> = {
  code: "菜单编码",
  name: "菜单名称",
  icon: "菜单图标",
  path: "路由路径",
  order: "排序号",
  status: "状态",
  navPlacement: "导航位置",
  adminOnly: "可见范围",
  desc: "说明",
};

function normalizeStatus(value: string | boolean): string {
  return typeof value === "boolean" ? (value ? "enabled" : "disabled") : value;
}

export interface MenuFormProps {
  form: MenuFormData;
  setForm: Dispatch<SetStateAction<MenuFormData>>;
  errors?: readonly SystemFormFieldError[] | undefined;
  focusRevision?: number | undefined;
  onFieldChange?: ((field: string) => void) | undefined;
  mode?: "new" | "edit" | undefined;
  initial?: MenuItem | null | undefined;
  onDelete?: ((menu: MenuItem) => void) | undefined;
}

export function MenuForm({
  form,
  setForm,
  errors = [],
  focusRevision = 0,
  onFieldChange,
  mode = "new",
  initial = null,
  onDelete,
}: MenuFormProps) {
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

  return (
    <div id={MENU_FORM_ID} ref={formRef}>
      <FormErrorSummary
        formId={MENU_FORM_ID}
        errors={fieldErrors}
        getFieldLabel={(field) => MENU_FIELD_LABELS[field] || "表单内容"}
      />
      <FormSection title="菜单信息">
        <div className="form-grid">
          <FormField className="fl" formId={MENU_FORM_ID} name="code" label="菜单编码" error={fieldErrors["code"]}>
            <Input aria-label="菜单编码" className={`inp mono${fieldErrors["code"] ? " invalid" : ""}`} value={form.code} onChange={(event) => {
              clearField("code");
              setForm((prev) => ({ ...prev, code: event.target.value }));
            }} placeholder="例如：indicator" />
          </FormField>
          <FormField className="fl" formId={MENU_FORM_ID} name="name" label="菜单名称" error={fieldErrors["name"]}>
            <Input aria-label="菜单名称" className={`inp${fieldErrors["name"] ? " invalid" : ""}`} value={form.name} onChange={(event) => {
              clearField("name");
              setForm((prev) => ({ ...prev, name: event.target.value }));
            }} placeholder="例如：指标维护" />
          </FormField>
          <FormField className="fl" formId={MENU_FORM_ID} name="icon" label="菜单图标" error={fieldErrors["icon"]}>
            <Select<string> aria-label="菜单图标" className="inp" items={MENU_ICON_OPTIONS.map((item) => ({ label: item.name, value: item.value }))} value={form.icon || null} onValueChange={(value) => {
              clearField("icon");
              setForm((prev) => ({ ...prev, icon: value || "" }));
            }} />
          </FormField>
          <FormField className="fl" formId={MENU_FORM_ID} name="path" label="路由路径" error={fieldErrors["path"]}>
            <Input aria-label="路由路径" className={`inp mono${fieldErrors["path"] ? " invalid" : ""}`} value={form.path} onChange={(event) => {
              clearField("path");
              setForm((prev) => ({ ...prev, path: event.target.value }));
            }} placeholder="例如：/indicator-maintenance" />
          </FormField>
          <FormField className="fl" formId={MENU_FORM_ID} name="order" label="排序号" error={fieldErrors["order"]}>
            <Input aria-label="排序号" className={`inp mono${fieldErrors["order"] ? " invalid" : ""}`} value={form.order} onChange={(event) => {
              clearField("order");
              setForm((prev) => ({ ...prev, order: event.target.value }));
            }} placeholder="数字越小越靠前，例如 10" />
          </FormField>
          <FormField className="fl" formId={MENU_FORM_ID} name="status" label="状态" error={fieldErrors["status"]}>
            <div role="group" aria-label="状态">
              <BinaryStatusToggle mode="status" value={form.status} className="system-status-seg" onChange={(value) => {
                clearField("status");
                setForm((prev) => ({ ...prev, status: normalizeStatus(value) }));
              }} />
            </div>
          </FormField>
          <FormField className="fl" formId={MENU_FORM_ID} name="navPlacement" label="导航位置" error={fieldErrors["navPlacement"]}>
            <Select<string> aria-label="导航位置" className="inp" items={[{ label: "顶栏", value: "primary" }, { label: "更多", value: "more" }]} value={form.navPlacement || null} onValueChange={(value) => {
              clearField("navPlacement");
              setForm((prev) => ({ ...prev, navPlacement: value || "primary" }));
            }} />
          </FormField>
          <FormField className="fl full" formId={MENU_FORM_ID} name="adminOnly" label="可见范围" error={fieldErrors["adminOnly"]}>
            <Checkbox label="仅管理员可见" checked={form.adminOnly} onCheckedChange={(checked) => {
              clearField("adminOnly");
              setForm((prev) => ({ ...prev, adminOnly: checked }));
            }} />
          </FormField>
          <FormField className="fl full" formId={MENU_FORM_ID} name="desc" label="说明" error={fieldErrors["desc"]}>
            <Textarea aria-label="说明" className="ta" value={form.desc} onChange={(event) => {
              clearField("desc");
              setForm((prev) => ({ ...prev, desc: event.target.value }));
            }} placeholder="补充菜单用途或权限说明" />
          </FormField>
        </div>
      </FormSection>

      {isEdit && initial ? (
        <DangerZone
          description="删除菜单会影响导航和权限配置。若菜单暂时不再使用，建议优先禁用。"
          actions={[
            {
              key: "delete-menu",
              label: "删除菜单",
              icon: "trash",
              danger: true,
              onClick: async () => {
                if (await confirmDeleteAction({
                  name: initial.name,
                  typeLabel: "菜单",
                  impact: "该菜单删除后，可能影响系统导航、权限配置和历史访问追溯。建议优先禁用，而不是删除。",
                  consequences: [
                    "删除前应以后端权限与依赖校验结果为准。",
                    "若后端返回不可删除原因，页面会直接展示原因。",
                  ],
                  confirmKeyword: initial.code || "",
                  confirmKeywordLabel: "请输入菜单编码二次确认",
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
