import React from "react";

function SidebarFilterItem({ item }) {
  const className = [
    "side-item",
    item.active ? "active" : "",
    item.disabled ? "disabled" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={className} onClick={item.disabled ? undefined : item.onClick}>
      {item.content || (
        <>
          {item.leading}
          {item.label}
          {item.count !== undefined && item.count !== null ? (
            <span className="count">{item.count}</span>
          ) : null}
        </>
      )}
    </div>
  );
}

export function SidebarFilterGroup({ title, items = [] }) {
  return (
    <div className="side-group">
      <div className="side-title">{title}</div>
      {items.map((item) => (
        <SidebarFilterItem key={item.key} item={item} />
      ))}
    </div>
  );
}
