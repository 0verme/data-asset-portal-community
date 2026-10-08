import type { ReactNode } from "react";

import { Button } from "../../../ui/index.ts";
import type { SidebarFilterItem } from "../common/SidebarFilterGroup.tsx";

export interface AssetSidebarFilterGroupProps {
  title: ReactNode;
  items?: readonly SidebarFilterItem[] | undefined;
  allOption?: SidebarFilterItem | undefined;
}

function AssetSidebarFilterButton({ item }: { item: SidebarFilterItem }) {
  const className = [
    "side-item",
    item.active ? "active" : "",
    item.disabled ? "disabled" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Button
      type="button"
      variant="tertiary"
      size="sm"
      className={className}
      onClick={item.disabled ? undefined : item.onClick}
      disabled={item.disabled}
      aria-pressed={typeof item.active === "boolean" ? item.active : undefined}
    >
      {item.content || (
        <>
          {item.leading}
          {item.label}
          {item.count !== undefined && item.count !== null ? (
            <span className="count">{item.count}</span>
          ) : null}
        </>
      )}
    </Button>
  );
}

export function AssetSidebarFilterGroup({
  title,
  items = [],
  allOption,
}: AssetSidebarFilterGroupProps) {
  const renderedItems = allOption ? [allOption, ...items] : items;

  return (
    <div className="side-group asset-sidebar-filter-group">
      <div className="side-title">{title}</div>
      {renderedItems.map((item) => <AssetSidebarFilterButton key={item.key} item={item} />)}
    </div>
  );
}
