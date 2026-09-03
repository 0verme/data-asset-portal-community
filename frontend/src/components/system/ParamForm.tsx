import type { Dispatch, SetStateAction } from "react";

import type {
  ParamDictCategoryWithCount,
  ParamDictItemWithCategoryName,
} from "../../api/paramDicts.ts";
import type {
  ParamFormData,
  SystemFormFieldError,
} from "../../hooks/useSystemModule.ts";
import {
  ActionErrorBanner,
  BinaryStatusToggle,
  confirmDeleteAction,
  DangerZone,
  FormSection,
} from "../common/index.ts";

function normalizeStatus(value: string | boolean): string {
  return typeof value === "boolean" ? (value ? "enabled" : "disabled") : value;
}

export interface ParamFormProps {
  form: ParamFormData;
  categories: readonly ParamDictCategoryWithCount[];
  setForm: Dispatch<SetStateAction<ParamFormData>>;
  errors?: readonly SystemFormFieldError[] | undefined;
  mode?: "new" | "edit" | undefined;
  initial?: ParamDictItemWithCategoryName | null | undefined;
  onDelete?: ((item: ParamDictItemWithCategoryName) => void) | undefined;
}

export function ParamForm({
  form,
  categories,
  setForm,
  errors = [],
  mode = "new",
  initial = null,
  onDelete,
}: ParamFormProps) {
  const hasError = (field: string) =>
    errors.some((item) => item.field === field);
  const isEdit = mode === "edit";

  return (
    <>
      <ActionErrorBanner
        title="请先修正以下问题"
        messages={errors.map((item) => item.message)}
      />

      <FormSection title="参数信息">
        <div className="form-grid">
          <div className="fl">
            <label>参数分类</label>
            <select
              className={`inp${hasError("categoryCode") ? " invalid" : ""}`}
              value={form.categoryCode}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  categoryCode: event.target.value,
                }))
              }
            >
              <option value="">请选择分类</option>
              {categories.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
          <div className="fl">
            <label>参数编码</label>
            <input
              className={`inp mono${hasError("code") ? " invalid" : ""}`}
              value={form.code}
              readOnly={isEdit}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, code: event.target.value }))
              }
              placeholder="例如：ENABLED"
            />
          </div>
          <div className="fl">
            <label>参数名称</label>
            <input
              className={`inp${hasError("name") ? " invalid" : ""}`}
              value={form.name}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, name: event.target.value }))
              }
              placeholder="例如：启用"
            />
          </div>
          <div className="fl">
            <label>参数值</label>
            <input
              className={`inp mono${hasError("value") ? " invalid" : ""}`}
              value={form.value}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, value: event.target.value }))
              }
              placeholder="例如：enabled"
            />
          </div>
          <div className="fl full">
            <label>状态</label>
            <BinaryStatusToggle
              mode="status"
              value={form.status}
              className="system-status-seg"
              onChange={(value) =>
                setForm((prev) => ({ ...prev, status: normalizeStatus(value) }))
              }
            />
          </div>
          <div className="fl full">
            <label>说明</label>
            <textarea
              className="ta"
              value={form.desc}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, desc: event.target.value }))
              }
              placeholder="补充参数用途、业务说明或取值约束"
            />
          </div>
        </div>
      </FormSection>

      {isEdit && initial ? (
        <DangerZone
          description="删除参数可能影响码值解析和页面筛选。若参数暂时下线，建议优先禁用。"
          actions={[
            {
              key: "delete-param",
              label: "删除参数",
              icon: "trash",
              danger: true,
              onClick: async () => {
                if (
                  await confirmDeleteAction({
                    name: initial.name,
                    typeLabel: "参数字典",
                    impact:
                      "该参数删除后，可能影响码值解析、页面筛选和历史配置追溯。建议优先禁用，而不是删除。",
                    consequences: [
                      "删除前应以后端依赖校验结果为准。",
                      "若后端返回不可删除原因，页面会直接展示原因。",
                    ],
                    confirmKeyword: initial.code || "",
                    confirmKeywordLabel: "请输入参数编码二次确认",
                  })
                ) {
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
