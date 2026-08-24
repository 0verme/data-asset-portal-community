import { SidebarFilterGroup } from "./SidebarFilterGroup.jsx";

export function StatusFilterGroup({
  value,
  onChange,
  totalCount,
  enabledCount,
  disabledCount,
  allValue,
  enabledValue = "enabled",
  disabledValue = "disabled",
}) {
  return (
    <SidebarFilterGroup
      title="状态"
      items={[
        {
          key: "all",
          label: "全部状态",
          count: totalCount,
          active: value === allValue,
          onClick: () => onChange(allValue),
        },
        {
          key: "enabled",
          label: "启用",
          count: enabledCount,
          active: value === enabledValue,
          onClick: () => onChange(enabledValue),
        },
        {
          key: "disabled",
          label: "禁用",
          count: disabledCount,
          active: value === disabledValue,
          onClick: () => onChange(disabledValue),
        },
      ]}
    />
  );
}
