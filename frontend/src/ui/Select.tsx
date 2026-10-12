import {
  cloneElement,
  isValidElement,
  type AriaAttributes,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from "react";
import { Select as KumoSelect } from "@cloudflare/kumo/components/select";

import { joinClassNames } from "./classNames.ts";
import { CONTROL_SIZE_MAP, type ControlSize } from "./variants.ts";

type KumoSelectProps = ComponentProps<typeof KumoSelect>;

export type SelectProps<Value = string> = Omit<
  KumoSelectProps,
  "aria-invalid" | "defaultValue" | "items" | "labelTooltip" | "multiple" | "onValueChange" | "size" | "value"
> & {
  "aria-invalid"?: AriaAttributes["aria-invalid"];
  defaultValue?: Value | null;
  items?: ReadonlyArray<{ label: ReactNode; value: Value }>;
  onValueChange?: (value: Value | null) => void;
  size?: ControlSize;
  value?: Value | null;
};

type DapSelectComponent = {
  <Value = string>(props: SelectProps<Value>): ReactElement;
  Option: typeof KumoSelect.Option;
  Group: typeof KumoSelect.Group;
  GroupLabel: typeof KumoSelect.GroupLabel;
  Separator: typeof KumoSelect.Separator;
};

// `.sel` belongs to native <select> styling and adds CSS arrow gradients; Kumo renders its own caret.
function normalizeKumoSelectClassName(className?: string): string {
  const compatibleClassName = className
    ?.split(/\s+/)
    .filter((name) => name && name !== "sel")
    .join(" ");
  return joinClassNames("dap-ui-select", compatibleClassName);
}

/** Kumo Select needs invalid state on its trigger, not only on the root. */
function setTriggerAriaInvalid(
  trigger: ReactElement,
  ariaInvalid: AriaAttributes["aria-invalid"],
): ReactElement {
  return cloneElement(
    trigger as ReactElement<{ "aria-invalid"?: AriaAttributes["aria-invalid"] }>,
    { "aria-invalid": ariaInvalid },
  );
}

function withAriaInvalid(
  render: KumoSelectProps["render"],
  ariaInvalid: AriaAttributes["aria-invalid"],
): KumoSelectProps["render"] {
  if (ariaInvalid === undefined) return render;
  if (typeof render === "function") {
    return (props, state) => {
      const element = render(props, state);
      return isValidElement(element)
        ? setTriggerAriaInvalid(element, ariaInvalid)
        : element;
    };
  }
  return setTriggerAriaInvalid(render ?? <button />, ariaInvalid);
}

function DapSelect<Value = string>({
  "aria-invalid": ariaInvalid,
  className,
  defaultValue,
  items,
  onValueChange,
  render,
  size = "md",
  value,
  ...props
}: SelectProps<Value>) {
  const selectProps = {
    ...props,
    className: normalizeKumoSelectClassName(className),
    render: withAriaInvalid(render, ariaInvalid),
    size: CONTROL_SIZE_MAP[size],
    ...(defaultValue !== undefined ? { defaultValue } : {}),
    ...(items !== undefined ? { items } : {}),
    ...(onValueChange ? { onValueChange: (nextValue: unknown) => onValueChange(nextValue as Value | null) } : {}),
    ...(value !== undefined ? { value } : {}),
  } as unknown as KumoSelectProps;

  return <KumoSelect {...selectProps} />;
}

export const Select = Object.assign(DapSelect, {
  Option: KumoSelect.Option,
  Group: KumoSelect.Group,
  GroupLabel: KumoSelect.GroupLabel,
  Separator: KumoSelect.Separator,
}) as DapSelectComponent;
