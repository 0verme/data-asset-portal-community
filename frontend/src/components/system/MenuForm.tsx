import type { Dispatch, SetStateAction } from "react";

import type { MenuItem } from "../../data/menus.ts";
import type { MenuFormData, SystemFormFieldError } from "../../hooks/useSystemModule.ts";
import { ActionErrorBanner, BinaryStatusToggle, confirmDeleteAction, DangerZone, FormSection } from "../common/index.ts";
import { MENU_ICON_OPTIONS } from "./constants.ts";
import { Checkbox, Input, Select, Textarea } from "../../ui/index.ts";

function normalizeStatus(value: string | boolean): string {
  return typeof value === "boolean" ? (value ? "enabled" : "disabled") : value;
}

export interface MenuFormProps {
  form: MenuFormData;
  setForm: Dispatch<SetStateAction<MenuFormData>>;
  errors?: readonly SystemFormFieldError[] | undefined;
  mode?: "new" | "edit" | undefined;
  initial?: MenuItem | null | undefined;
  onDelete?: ((menu: MenuItem) => void) | undefined;
}

export function MenuForm({
  form,
  setForm,
  errors = [],
  mode = "new",
  initial = null,
  onDelete,
}: MenuFormProps) {
  const hasError = (field: string) => errors.some((item) => item.field === field);
  const isEdit = mode === "edit";

  return (
    <>
      <ActionErrorBanner title="请先修正以下问题" messages={errors.map((item) => item.message)} />

      <FormSection title="菜单信息">
        <div className="form-grid">
          <div className="fl">
            <label>菜单编码</label>
            <Input
              aria-label="菜单编码"
              className={`inp mono${hasError("code") ? " invalid" : ""}`}
              value={form.code}
              onChange={(event) => setForm((prev) => ({ ...prev, code: event.target.value }))}
              placeholder="例如：indicator"
            />
          </div>
          <div className="fl">
            <label>菜单名称</label>
            <Input
              aria-label="菜单名称"
              className={`inp${hasError("name") ? " invalid" : ""}`}
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="例如：指标维护"
            />
          </div>
          <div className="fl">
            <label>菜单图标</label>
            <Select<string>
              aria-label="菜单图标"
              className="inp"
              items={MENU_ICON_OPTIONS.map((item) => ({ label: item.name, value: item.value }))}
              value={form.icon || null}
              onValueChange={(value) => setForm((prev) => ({ ...prev, icon: value || "" }))}
            />
          </div>
          <div className="fl">
            <label>路由路径</label>
            <Input
              aria-label="路由路径"
              className={`inp mono${hasError("path") ? " invalid" : ""}`}
              value={form.path}
              onChange={(event) => setForm((prev) => ({ ...prev, path: event.target.value }))}
              placeholder="例如：/indicator-maintenance"
            />
          </div>
          <div className="fl">
            <label>排序号</label>
            <Input
              aria-label="排序号"
              className={`inp mono${hasError("order") ? " invalid" : ""}`}
              value={form.order}
              onChange={(event) => setForm((prev) => ({ ...prev, order: event.target.value }))}
              placeholder="数字越小越靠前，例如 10"
            />
          </div>
          <div className="fl">
            <label>状态</label>
            <BinaryStatusToggle
              mode="status"
              value={form.status}
              className="system-status-seg"
              onChange={(value) => setForm((prev) => ({ ...prev, status: normalizeStatus(value) }))}
            />
          </div>
          <div className="fl">
            <label>导航位置</label>
            <Select<string>
              aria-label="导航位置"
              className="inp"
              items={[{ label: "顶栏", value: "primary" }, { label: "更多", value: "more" }]}
              value={form.navPlacement || null}
              onValueChange={(value) => setForm((prev) => ({ ...prev, navPlacement: value || "primary" }))}
            />
          </div>
          <div className="fl full">
            <label>可见范围</label>
            <label className="system-check-line">
              <Checkbox
                label="仅管理员可见"
                checked={form.adminOnly}
                onCheckedChange={(checked) => setForm((prev) => ({ ...prev, adminOnly: checked }))}
              />
            </label>
          </div>
          <div className="fl full">
            <label>说明</label>
            <Textarea
              aria-label="说明"
              className="ta"
              value={form.desc}
              onChange={(event) => setForm((prev) => ({ ...prev, desc: event.target.value }))}
              placeholder="补充菜单用途或权限说明"
            />
          </div>
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
    </>
  );
}
