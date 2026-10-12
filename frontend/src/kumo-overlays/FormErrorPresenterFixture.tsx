import { useRef, useState, type FormEvent } from "react";

import {
  Button,
  clearFormFieldErrors,
  FormErrorSummary,
  FormField,
  focusFirstFormError,
  Input,
  mergeFormFieldErrors,
  type FormFieldErrors,
} from "../ui/index.ts";

const FORM_ID = "feedback-contract-form";

interface FormValues {
  owner: string;
  email: string;
  parameterName: string;
}

export default function FormErrorPresenterFixture() {
  const formRef = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState<FormValues>({
    owner: "初始负责人",
    email: "invalid-address",
    parameterName: "已输入的第 13 行参数名",
  });
  const [serverErrors, setServerErrors] = useState<FormFieldErrors>({});
  const [localErrors, setLocalErrors] = useState<FormFieldErrors>({});
  const errors = mergeFormFieldErrors(serverErrors, localErrors);

  const updateField = (field: keyof FormValues, errorPath: string, value: string): void => {
    setValues((current) => ({ ...current, [field]: value }));
    setServerErrors((current) => clearFormFieldErrors(current, errorPath));
    setLocalErrors((current) => clearFormFieldErrors(current, errorPath));
  };

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const nextLocalErrors: FormFieldErrors = values.email.includes("@")
      ? {}
      : { email: "请输入有效的邮箱地址。" };
    const nextServerErrors: FormFieldErrors = {
      owner: "服务器校验要求确认负责人。",
      "params.12.name": "第 13 行参数名称需要调整。",
    };
    const nextErrors = mergeFormFieldErrors(nextServerErrors, nextLocalErrors);
    setLocalErrors(nextLocalErrors);
    setServerErrors(nextServerErrors);
    focusFirstFormError(formRef.current, nextErrors, "auto");
  };

  return (
    <main style={{ margin: "24px auto", maxWidth: 720, padding: 16 }}>
      <h1>Form Error Presenter Fixture</h1>
      <p>模拟长表单提交失败、服务端与本地错误合并及按字段修正。</p>
      <div
        data-testid="form-scroll-container"
        style={{ border: "1px solid #888", height: 280, marginTop: 20, overflowY: "auto" }}
      >
        <form id={FORM_ID} ref={formRef} onSubmit={submit} style={{ display: "grid", gap: 16, padding: 16 }}>
          <div aria-hidden="true" data-testid="long-form-spacer" style={{ height: 520 }}>
            长表单上方内容
          </div>
          <FormErrorSummary
            errors={errors}
            formId={FORM_ID}
            getFieldLabel={(field) => ({
              owner: "负责人",
              email: "邮箱",
              "params.12.name": "第 13 行参数名称",
            })[field] || "表单内容"}
          />
          <FormField name="owner" formId={FORM_ID} label="负责人" error={errors["owner"]}>
            <Input
              aria-label="负责人"
              value={values.owner}
              onChange={(event) => updateField("owner", "owner", event.target.value)}
            />
          </FormField>
          <FormField name="email" formId={FORM_ID} label="邮箱" error={errors["email"]}>
            <Input
              aria-label="邮箱"
              value={values.email}
              onChange={(event) => updateField("email", "email", event.target.value)}
            />
          </FormField>
          <FormField name="params.12.name" formId={FORM_ID} label="第 13 行参数名称" error={errors["params.12.name"]}>
            <Input
              aria-label="第 13 行参数名称"
              value={values.parameterName}
              onChange={(event) => updateField("parameterName", "params.12.name", event.target.value)}
            />
          </FormField>
          <Button type="submit" variant="primary">提交表单</Button>
        </form>
      </div>
      <div aria-hidden="true" style={{ height: 1000 }} />
    </main>
  );
}
