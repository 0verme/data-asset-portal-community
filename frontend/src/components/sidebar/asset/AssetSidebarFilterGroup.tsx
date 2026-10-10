import { useId, useState, type ReactNode } from "react";

import { Button, Tooltip } from "../../../ui/index.ts";
import { Icon } from "../../ui.tsx";
import type { SidebarFilterItem } from "../common/SidebarFilterGroup.tsx";

export interface AssetSidebarFilterItem extends SidebarFilterItem {
  tooltip?: ReactNode | undefined;
}

export interface AssetSidebarFilterGroupProps {
  title: ReactNode;
  items?: readonly AssetSidebarFilterItem[] | undefined;
  allOption?: AssetSidebarFilterItem | undefined;
}

function AssetSidebarFilterButton({ item }: { item: AssetSidebarFilterItem }) {
  const className = [
    "side-item",
    item.active ? "active" : "",
    item.disabled ? "disabled" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const button = (
    <Button
      type="button"
      variant="tertiary"
      size="sm"
      className={`${className} asset-sidebar-filter-option`}
      onClick={item.disabled ? undefined : item.onClick}
      disabled={item.disabled}
      aria-pressed={typeof item.active === "boolean" ? item.active : undefined}
    >
      {item.content || (
        <>
          <span className="asset-sidebar-filter-label">
            {item.leading}
            {item.label}
          </span>
          {item.count !== undefined && item.count !== null ? (
            <span className="count">{item.count}</span>
          ) : null}
        </>
      )}
    </Button>
  );

  return item.tooltip ? (
    <Tooltip trigger={button} content={item.tooltip} side="right" align="start" />
  ) : button;
}

export function AssetSidebarFilterGroup({
  title,
  items = [],
  allOption,
}: AssetSidebarFilterGroupProps) {
  const renderedItems = allOption ? [allOption, ...items] : items;
  const headingId = useId();
  const contentId = useId();
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="side-group asset-sidebar-filter-group">
      <Button
        id={headingId}
        type="button"
        variant="tertiary"
        size="sm"
        className="asset-sidebar-filter-heading"
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => setExpanded((current) => !current)}
      >
        <span>{title}</span>
        <span className="asset-sidebar-filter-chevron" aria-hidden="true">
          <Icon name="chevron" size={14} />
        </span>
      </Button>
      <div
        id={contentId}
        className="asset-sidebar-filter-items"
        role="group"
        aria-labelledby={headingId}
        hidden={!expanded}
      >
        {renderedItems.map((item) => <AssetSidebarFilterButton key={item.key} item={item} />)}
      </div>
    </div>
  );
}
