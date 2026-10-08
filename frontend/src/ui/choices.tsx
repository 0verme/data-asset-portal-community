import { forwardRef, type ComponentProps } from "react";
import { Checkbox as KumoCheckbox } from "@cloudflare/kumo/components/checkbox";
import { Switch as KumoSwitch } from "@cloudflare/kumo/components/switch";

import { joinClassNames } from "./classNames.ts";

type KumoCheckboxProps = ComponentProps<typeof KumoCheckbox>;
type KumoSwitchProps = ComponentProps<typeof KumoSwitch>;

export type CheckboxProps = Omit<KumoCheckboxProps, "labelTooltip" | "onCheckedChange" | "variant"> & {
  intent?: "default" | "error";
  onCheckedChange?: (checked: boolean) => void;
};

export const Checkbox = forwardRef<HTMLButtonElement, CheckboxProps>(function DapCheckbox(
  { className, intent = "default", onCheckedChange, ...props },
  ref,
) {
  return (
    <KumoCheckbox
      {...props}
      ref={ref}
      className={joinClassNames("dap-ui-checkbox", className)}
      variant={intent}
      {...(onCheckedChange ? { onCheckedChange: (checked: boolean | "indeterminate") => onCheckedChange(checked === true) } : {})}
    />
  );
});

Checkbox.displayName = "DapCheckbox";

export type SwitchProps = Omit<KumoSwitchProps, "labelTooltip" | "onCheckedChange"> & {
  onCheckedChange?: (checked: boolean) => void;
};

export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(function DapSwitch(
  { className, onCheckedChange, ...props },
  ref,
) {
  return (
    <KumoSwitch
      {...props}
      ref={ref}
      className={joinClassNames("dap-ui-switch", className)}
      {...(onCheckedChange ? { onCheckedChange } : {})}
    />
  );
});

Switch.displayName = "DapSwitch";
