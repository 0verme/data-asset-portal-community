import type { ComponentProps } from "react";
import { Tabs as KumoTabs } from "@cloudflare/kumo/components/tabs";

import { joinClassNames } from "./classNames.ts";
import { CONTROL_SIZE_MAP, TAB_APPEARANCE_MAP, type ControlSize, type TabAppearance } from "./variants.ts";

type KumoTabsProps = ComponentProps<typeof KumoTabs>;

export type TabsProps = Omit<KumoTabsProps, "selectedValue" | "size" | "variant"> & {
  appearance?: TabAppearance;
  defaultValue?: string;
  size?: ControlSize;
};

export function Tabs({
  appearance = "segmented",
  className,
  defaultValue,
  labels,
  size = "md",
  ...props
}: TabsProps) {
  const localizedLabels = {
    scrollStart: "向左滚动标签",
    scrollEnd: "向右滚动标签",
    ...labels,
  };
  return (
    <KumoTabs
      {...props}
      className={joinClassNames("dap-ui-tabs", className)}
      labels={localizedLabels}
      {...(defaultValue !== undefined ? { selectedValue: defaultValue } : {})}
      size={CONTROL_SIZE_MAP[size]}
      variant={TAB_APPEARANCE_MAP[appearance]}
    />
  );
}
