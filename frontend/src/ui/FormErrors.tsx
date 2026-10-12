import type { ReactElement, ReactNode } from "react";

import { Button } from "./Button.tsx";
import { Field, type FieldProps } from "./controls.tsx";
import { Banner } from "./feedback.tsx";
import { formErrorSummaryId, formFieldElementId, focusFormField, type FormFieldErrors } from "./formErrors.ts";
import { joinClassNames } from "./classNames.ts";
import "./formErrors.css";

export type FormFieldProps = Omit<FieldProps, "error"> & {
  /** Canonical field path shared by local and server-side errors. */
  name: string;
  /** Must match the id of the containing form. */
  formId: string;
  error?: ReactNode;
  className?: string;
};

/** Kumo-backed inline field error with a stable marker for summaries and focus. */
export function FormField({
  name,
  formId,
  error,
  className,
  children,
  ...fieldProps
}: FormFieldProps): ReactElement {
  return (
    <div
      id={formFieldElementId(formId, name)}
      className={joinClassNames("dap-ui-form-field", className)}
      data-form-field={name}
      tabIndex={-1}
    >
      <Field {...fieldProps} error={error}>{children}</Field>
    </div>
  );
}

export interface FormErrorSummaryProps {
  /** Must match the id of the containing form. */
  formId: string;
  errors: FormFieldErrors;
  /** Labels come from the caller's known field contract, never raw server paths. */
  getFieldLabel: (field: string) => string;
  title?: string;
}

/** Persistent, actionable summary. Inline field text remains associated by DAP Field. */
export function FormErrorSummary({
  formId,
  errors,
  getFieldLabel,
  title = "请检查表单",
}: FormErrorSummaryProps): ReactElement | null {
  const entries = Object.entries(errors).filter(([, message]) => typeof message === "string" && message.trim());
  if (!entries.length) return null;

  const focus = (field: string): void => {
    if (typeof document === "undefined") return;
    focusFormField(document.getElementById(formId), field);
  };

  return (
    <Banner
      id={formErrorSummaryId(formId)}
      className="dap-ui-form-error-summary"
      tone="error"
      title={title}
      description={(
        <ul className="dap-ui-form-error-summary__list">
          {entries.map(([field, message]) => (
            <li className="dap-ui-form-error-summary__item" key={field}>
              <Button
                className="dap-ui-form-error-summary__button"
                type="button"
                variant="tertiary"
                size="sm"
                onClick={() => focus(field)}
              >
                {getFieldLabel(field)}：{message}
              </Button>
            </li>
          ))}
        </ul>
      )}
    />
  );
}
