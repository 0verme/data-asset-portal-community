import { forwardRef, type ReactNode } from "react";
import { Button as KumoButton, type ButtonProps as KumoButtonProps } from "@cloudflare/kumo/components/button";

import { joinClassNames } from "./classNames.ts";
import { BUTTON_VARIANT_MAP, CONTROL_SIZE_MAP, type ButtonVariant, type ControlSize } from "./variants.ts";

type KumoTextButtonProps = Extract<KumoButtonProps, { shape?: "base" }>;

export type ButtonProps = Omit<KumoTextButtonProps, "shape" | "size" | "title" | "variant"> & {
  size?: ControlSize;
  variant?: ButtonVariant;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function DapButton(
  { className, size = "md", variant = "secondary", ...props },
  ref,
) {
  return (
    <KumoButton
      {...props}
      ref={ref}
      className={joinClassNames("dap-ui-button", className)}
      shape="base"
      size={CONTROL_SIZE_MAP[size]}
      variant={BUTTON_VARIANT_MAP[variant]}
    />
  );
});

Button.displayName = "DapButton";

type AccessibleName =
  | { "aria-label": string; "aria-labelledby"?: string }
  | { "aria-label"?: string; "aria-labelledby": string };

export type IconButtonProps = Omit<ButtonProps, "children" | "icon"> & {
  icon: ReactNode;
  shape?: "square" | "circle";
} & AccessibleName;

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function DapIconButton(
  { className, icon, shape = "square", size = "md", variant = "secondary", ...props },
  ref,
) {
  return (
    <KumoButton
      {...props}
      ref={ref}
      className={joinClassNames("dap-ui-icon-button", className)}
      icon={icon}
      shape={shape}
      size={CONTROL_SIZE_MAP[size]}
      variant={BUTTON_VARIANT_MAP[variant]}
    />
  );
});

IconButton.displayName = "DapIconButton";
