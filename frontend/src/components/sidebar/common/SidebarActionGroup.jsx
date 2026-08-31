import { SidebarFilterGroup } from "./SidebarFilterGroup.jsx";

export function SidebarActionGroup({ actions = [] }) {
  if (!actions.length) return null;

  return (
    <SidebarFilterGroup
      title="维护"
      items={actions.map((action) => ({
        key: action.key,
        label: action.label,
        leading: action.icon,
        disabled: action.disabled,
        onClick: action.onClick,
      }))}
    />
  );
}
