import type { ReactNode } from "react";

import type { SidebarFilterItem } from "./SidebarFilterGroup.tsx";

export interface SidebarFacetRenderContext<T, V> {
  option: T;
  value: V;
  count: ReactNode;
  active: boolean;
}

export interface SidebarFacetConfig<T, V> {
  options?: readonly T[] | undefined;
  selectedValue?: V | null | undefined;
  getValue?: ((option: T) => V) | undefined;
  getLabel?: ((option: T) => ReactNode) | undefined;
  getCount?: ((option: T) => ReactNode) | undefined;
  onSelect?: ((value: V | null, option: T) => void) | undefined;
  renderContent?:
    | ((context: SidebarFacetRenderContext<T, V>) => ReactNode)
    | undefined;
}

export function buildSidebarFacetItems<T, V = T>({
  options = [],
  selectedValue = null,
  getValue,
  getLabel,
  getCount = () => null,
  onSelect,
  renderContent,
}: SidebarFacetConfig<T, V>): SidebarFilterItem[] {
  return options.map((option) => {
    // SAFETY: when getValue is omitted, the legacy helper contract uses the option itself as its value.
    const value = getValue ? getValue(option) : (option as unknown as V);
    const count = getCount(option);
    const active = selectedValue === value;

    return {
      key: String(value),
      label: getLabel ? getLabel(option) : String(option),
      count,
      active,
      onClick: () => onSelect?.(active ? null : value, option),
      content: renderContent
        ? renderContent({ option, value, count, active })
        : undefined,
    };
  });
}
