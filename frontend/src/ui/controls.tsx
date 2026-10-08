import { cloneElement, forwardRef, type AriaAttributes, type ComponentPropsWithRef, type ReactElement, type ReactNode } from "react";
import { Field as KumoField, type FieldProps as KumoFieldProps } from "@cloudflare/kumo/components/field";
import { Input as KumoInput, Textarea as KumoTextarea } from "@cloudflare/kumo/components/input";

import { joinClassNames } from "./classNames.ts";
import { CONTROL_SIZE_MAP, type ControlSize } from "./variants.ts";

type KumoInputProps = ComponentPropsWithRef<typeof KumoInput>;
type KumoTextareaProps = ComponentPropsWithRef<typeof KumoTextarea>;

export type InputProps = Omit<
  KumoInputProps,
  "className" | "description" | "error" | "label" | "labelTooltip" | "passwordManagerIgnore" | "size" | "variant"
> & {
  className?: string;
  intent?: "default" | "error";
  size?: ControlSize;
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function DapInput(
  { className, intent = "default", size = "md", ...props },
  ref,
) {
  return (
    <KumoInput
      {...props}
      ref={ref}
      aria-invalid={intent === "error" ? true : props["aria-invalid"]}
      className={joinClassNames(
        "dap-ui-input",
        intent === "error" ? "ring-kumo-danger focus:ring-kumo-danger/50" : undefined,
        className,
      )}
      size={CONTROL_SIZE_MAP[size]}
    />
  );
});

Input.displayName = "DapInput";

export type TextareaProps = Omit<
  KumoTextareaProps,
  "className" | "description" | "error" | "label" | "labelTooltip" | "onValueChange" | "size" | "variant"
> & {
  className?: string;
  intent?: "default" | "error";
  size?: ControlSize;
};

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function DapTextarea(
  { className, intent = "default", size = "md", ...props },
  ref,
) {
  return (
    <KumoTextarea
      {...props}
      ref={ref}
      aria-invalid={intent === "error" ? true : props["aria-invalid"]}
      className={joinClassNames(
        "dap-ui-textarea",
        intent === "error" ? "ring-kumo-danger focus:ring-kumo-danger/50" : undefined,
        className,
      )}
      size={CONTROL_SIZE_MAP[size]}
    />
  );
});

Textarea.displayName = "DapTextarea";

type FieldControlProps = { "aria-invalid"?: AriaAttributes["aria-invalid"] };

export type FieldProps = Omit<KumoFieldProps, "children" | "error" | "labelTooltip"> & {
  children: ReactElement<FieldControlProps>;
  error?: ReactNode;
};

export function Field({ children, error, ...props }: FieldProps) {
  if (!error) return <KumoField {...props}>{children}</KumoField>;
  const control = cloneElement(children, { "aria-invalid": true });
  return <KumoField {...props} error={{ message: error, match: true }}>{control}</KumoField>;
}

Field.displayName = "DapField";
