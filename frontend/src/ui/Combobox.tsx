import type { ComponentProps, ReactElement } from "react";
import { Combobox as KumoCombobox } from "@cloudflare/kumo/components/combobox";

import { CONTROL_SIZE_MAP, type ControlSize } from "./variants.ts";

type KumoComboboxProps = ComponentProps<typeof KumoCombobox>;
type KumoTriggerInputProps = ComponentProps<typeof KumoCombobox.TriggerInput>;
type KumoChipProps = ComponentProps<typeof KumoCombobox.Chip>;

function DapTriggerInput({ clearLabel = "清除选择", showOptionsLabel = "显示选项", ...props }: KumoTriggerInputProps) {
  return <KumoCombobox.TriggerInput {...props} clearLabel={clearLabel} showOptionsLabel={showOptionsLabel} />;
}

function DapChip({ removeLabel = "移除", ...props }: KumoChipProps) {
  return <KumoCombobox.Chip {...props} removeLabel={removeLabel} />;
}

export type ComboboxProps<Value = unknown, Multiple extends boolean = false> = Omit<
  KumoComboboxProps,
  "items" | "labelTooltip" | "multiple" | "onValueChange" | "size" | "value"
> & {
  items: ReadonlyArray<Value>;
  multiple?: Multiple;
  onValueChange?: (value: Multiple extends true ? Value[] : Value | null) => void;
  size?: ControlSize;
  value?: Multiple extends true ? Value[] : Value | null;
};

type DapComboboxComponent = {
  <Value, Multiple extends boolean = false>(props: ComboboxProps<Value, Multiple>): ReactElement;
  Content: typeof KumoCombobox.Content;
  TriggerInput: typeof DapTriggerInput;
  TriggerValue: typeof KumoCombobox.TriggerValue;
  TriggerMultipleWithInput: typeof KumoCombobox.TriggerMultipleWithInput;
  Chip: typeof DapChip;
  Item: typeof KumoCombobox.Item;
  Empty: typeof KumoCombobox.Empty;
  List: typeof KumoCombobox.List;
  Group: typeof KumoCombobox.Group;
  GroupLabel: typeof KumoCombobox.GroupLabel;
};

function DapCombobox<Value, Multiple extends boolean = false>({
  items,
  multiple,
  onValueChange,
  size = "md",
  value,
  ...props
}: ComboboxProps<Value, Multiple>) {
  const comboboxProps = {
    ...props,
    items,
    size: CONTROL_SIZE_MAP[size],
    ...(multiple !== undefined ? { multiple } : {}),
    ...(onValueChange ? { onValueChange: (nextValue: unknown) => onValueChange(nextValue as Multiple extends true ? Value[] : Value | null) } : {}),
    ...(value !== undefined ? { value } : {}),
  } as unknown as KumoComboboxProps;

  return <KumoCombobox {...comboboxProps} />;
}

export const Combobox = Object.assign(DapCombobox, {
  Content: KumoCombobox.Content,
  TriggerInput: DapTriggerInput,
  TriggerValue: KumoCombobox.TriggerValue,
  TriggerMultipleWithInput: KumoCombobox.TriggerMultipleWithInput,
  Chip: DapChip,
  Item: KumoCombobox.Item,
  Empty: KumoCombobox.Empty,
  List: KumoCombobox.List,
  Group: KumoCombobox.Group,
  GroupLabel: KumoCombobox.GroupLabel,
}) as DapComboboxComponent;
