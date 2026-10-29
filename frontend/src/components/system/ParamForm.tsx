import { useLayoutEffect, useMemo, useRef, type Dispatch, type SetStateAction } from "react";

import type {
  ParamDictCategoryWithCount,
  ParamDictItemWithCategoryName,
} from "../../api/paramDicts.ts";
import type {
  ParamFormData,
  SystemFormFieldError,
} from "../../hooks/useSystemModule.ts";
import {
  BinaryStatusToggle,
  confirmDeleteAction,
  DangerZone,
  FormSection,
} from "../common/index.ts";
import { FormErrorSummary, FormField, focusFirstFormError, Input, Select, Textarea } from "../../ui/index.ts";
import { formFieldErrorEntries } from "../../utils/formFieldErrorMapping.ts";

const PARAM_FORM_ID = "system-param-form";
const PARAM_FIELD_LABELS: Readonly<Record<string, string>> = {
  categoryCode: "参数分类",
  code: "参数编码",
  name: "参数名称",
  value: "参数值",
  status: "状态",
  desc: "说明",
};

function normalizeStatus(value: string | boolean): string {
  return typeof value === "boolean" ? (value ? "enabled" : "disabled") : value;
}

export interface ParamFormProps {
  form: ParamFormData;
  categories: readonly ParamDictCategoryWithCount[];
  setForm: Dispatch<SetStateAction<ParamFormData>>;
  errors?: readonly SystemFormFieldError[] | undefined;
  focusRevision?: number | undefined;
  onFieldChange?: ((field: string) => void) | undefined;
  mode?: "new" | "edit" | undefined;
  initial?: ParamDictItemWithCategoryName | null | undefined;
  onDelete?: ((item: ParamDictItemWithCategoryName) => void) | undefined;
}

export function ParamForm({
  form,
  categories,
  setForm,
  errors = [],
  focusRevision = 0,
  onFieldChange,
  mode = "new",
  initial = null,
  onDelete,
}: ParamFormProps) {
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
    <div id={PARAM_FORM_ID} ref={formRef}>
      <FormErrorSummary
        formId={PARAM_FORM_ID}
        errors={fieldErrors}
        getFieldLabel={(field) => PARAM_FIELD_LABELS[field] || "表单内容"}
      />
      <FormSection title="参数信息">
        <div className="form-grid">
          <FormField className="fl" formId={PARAM_FORM_ID} name="categoryCode" label="参数分类" error={fieldErrors["categoryCode"]}>
            <Select<string>
              aria-label="参数分类"
              className={`inp${fieldErrors["categoryCode"] ? " invalid" : ""}`}
              placeholder="请选择分类"
              items={[{ label: "请选择分类", value: "" }, ...categories.map((item) => ({ label: item.name, value: item.code }))]}
              value={form.categoryCode || ""}
              onValueChange={(value) => {
                clearField("categoryCode");
                setForm((prev) => ({ ...prev, categoryCode: value || "" }));
              }}
            />
          </FormField>
          <FormField className="fl" formId={PARAM_FORM_ID} name="code" label="参数编码" error={fieldErrors["code"]}>
            <Input
              aria-label="参数编码"
              className={`inp mono${fieldErrors["code"] ? " invalid" : ""}`}
              value={form.code}
              readOnly={isEdit}
              onChange={(event) => {
                clearField("code");
                setForm((prev) => ({ ...prev, code: event.target.value }));
              }}
              placeholder="例如：ENABLED"
            />
          </FormField>
          <FormField className="fl" formId={PARAM_FORM_ID} name="name" label="参数名称" error={fieldErrors["name"]}>
            <Input aria-label="参数名称" className={`inp${fieldErrors["name"] ? " invalid" : ""}`} value={form.name} onChange={(event) => {
              clearField("name");
              setForm((prev) => ({ ...prev, name: event.target.value }));
            }} placeholder="例如：启用" />
          </FormField>
          <FormField className="fl" formId={PARAM_FORM_ID} name="value" label="参数值" error={fieldErrors["value"]}>
            <Input aria-label="参数值" className={`inp mono${fieldErrors["value"] ? " invalid" : ""}`} value={form.value} onChange={(event) => {
              clearField("value");
              setForm((prev) => ({ ...prev, value: event.target.value }));
            }} placeholder="例如：enabled" />
          </FormField>
          <FormField className="fl full" formId={PARAM_FORM_ID} name="status" label="状态" error={fieldErrors["status"]}>
            <div role="group" aria-label="状态">
              <BinaryStatusToggle mode="status" value={form.status} className="system-status-seg" onChange={(value) => {
                clearField("status");
                setForm((prev) => ({ ...prev, status: normalizeStatus(value) }));
              }} />
            </div>
          </FormField>
          <FormField className="fl full" formId={PARAM_FORM_ID} name="desc" label="说明" error={fieldErrors["desc"]}>
            <Textarea aria-label="说明" className="ta" value={form.desc} onChange={(event) => {
              clearField("desc");
              setForm((prev) => ({ ...prev, desc: event.target.value }));
            }} placeholder="补充参数用途、业务说明或取值约束" />
          </FormField>
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
                if (await confirmDeleteAction({
                  name: initial.name,
                  typeLabel: "参数字典",
                  impact: "该参数删除后，可能影响码值解析、页面筛选和历史配置追溯。建议优先禁用，而不是删除。",
                  consequences: [
                    "删除前应以后端依赖校验结果为准。",
                    "若后端返回不可删除原因，页面会直接展示原因。",
                  ],
                  confirmKeyword: initial.code || "",
                  confirmKeywordLabel: "请输入参数编码二次确认",
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
