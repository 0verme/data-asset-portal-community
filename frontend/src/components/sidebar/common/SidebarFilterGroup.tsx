import type { ReactNode } from "react";

export interface SidebarFilterItem {
  key: string;
  label?: ReactNode;
  leading?: ReactNode;
  count?: ReactNode;
  active?: boolean | undefined;
  disabled?: boolean | undefined;
  onClick?: (() => void) | undefined;
  content?: ReactNode;
}

export interface SidebarFilterGroupProps {
  title: ReactNode;
  items?: readonly SidebarFilterItem[] | undefined;
  allOption?: SidebarFilterItem | undefined;
}

function SidebarFilterItem({ item }: { item: SidebarFilterItem }) {
  const className = [
    "side-item",
    item.active ? "active" : "",
    item.disabled ? "disabled" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
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
    </button>
  );
}

export function SidebarFilterGroup({
  title,
  items = [],
  allOption,
}: SidebarFilterGroupProps) {
  const renderedItems = allOption ? [allOption, ...items] : items;

  return (
    <div className="side-group">
      <div className="side-title">{title}</div>
      {renderedItems.map((item) => (
        <SidebarFilterItem key={item.key} item={item} />
      ))}
    </div>
  );
}
