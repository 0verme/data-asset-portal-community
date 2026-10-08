import type { ComponentProps, ReactElement, ReactNode } from "react";
import { Select as KumoSelect } from "@cloudflare/kumo/components/select";

import { CONTROL_SIZE_MAP, type ControlSize } from "./variants.ts";

type KumoSelectProps = ComponentProps<typeof KumoSelect>;

export type SelectProps<Value = string> = Omit<
  KumoSelectProps,
  "defaultValue" | "items" | "labelTooltip" | "multiple" | "onValueChange" | "size" | "value"
> & {
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

function DapSelect<Value = string>({
  defaultValue,
  items,
  onValueChange,
  size = "md",
  value,
  ...props
}: SelectProps<Value>) {
  const selectProps = {
    ...props,
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
