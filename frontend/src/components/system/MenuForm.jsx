import { ActionErrorBanner, BinaryStatusToggle, confirmDeleteAction, DangerZone, FormSection } from "../common/index.js";
import { MENU_ICON_OPTIONS } from "./constants.js";

export function MenuForm({ form, setForm, errors = [], mode = "new", initial = null, onDelete }) {
  const hasError = (field) => errors.some((item) => item.field === field);
  const isEdit = mode === "edit";

  return (
    <>
      <ActionErrorBanner title="请先修正以下问题" messages={errors.map((item) => item.message)} />

      <FormSection title="菜单信息">
        <div className="form-grid">
          <div className="fl">
            <label>菜单编码</label>
            <input
              className={`inp mono${hasError("code") ? " invalid" : ""}`}
              value={form.code}
              onChange={(event) => setForm((prev) => ({ ...prev, code: event.target.value }))}
              placeholder="例如：indicator"
            />
          </div>
          <div className="fl">
            <label>菜单名称</label>
            <input
              className={`inp${hasError("name") ? " invalid" : ""}`}
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="例如：指标维护"
            />
          </div>
          <div className="fl">
            <label>菜单图标</label>
            <select
              className="inp"
              value={form.icon}
              onChange={(event) => setForm((prev) => ({ ...prev, icon: event.target.value }))}
            >
              {MENU_ICON_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.name}</option>)}
            </select>
          </div>
          <div className="fl">
            <label>路由路径</label>
            <input
              className={`inp mono${hasError("path") ? " invalid" : ""}`}
              value={form.path}
              onChange={(event) => setForm((prev) => ({ ...prev, path: event.target.value }))}
              placeholder="例如：/indicator-maintenance"
            />
          </div>
          <div className="fl">
            <label>排序号</label>
            <input
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
              onChange={(value) => setForm((prev) => ({ ...prev, status: value }))}
            />
          </div>
          <div className="fl">
            <label>导航位置</label>
            <select
              className="inp"
              value={form.navPlacement}
              onChange={(event) => setForm((prev) => ({ ...prev, navPlacement: event.target.value }))}
            >
              <option value="primary">顶栏</option>
              <option value="more">更多</option>
            </select>
          </div>
          <div className="fl full">
            <label>可见范围</label>
            <label className="system-check-line">
              <input
                type="checkbox"
                checked={form.adminOnly}
                onChange={(event) => setForm((prev) => ({ ...prev, adminOnly: event.target.checked }))}
              />
              仅管理员可见
            </label>
          </div>
          <div className="fl full">
            <label>说明</label>
            <textarea
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
                  impact: "该菜单删除后，可能影响系统导航、权限配置和历史访问追溯。建议优先停用，而不是删除。",
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
