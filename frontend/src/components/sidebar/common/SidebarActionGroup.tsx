import { SidebarFilterGroup } from "./SidebarFilterGroup.tsx";

export interface SidebarAction {
      key: string;
      label: string;
      icon?: string | undefined;
      disabled?: boolean | undefined;
      onClick?: (() => void) | undefined;
}

export interface SidebarActionGroupProps {
      actions?: readonly SidebarAction[] | undefined;
}

export function SidebarActionGroup({ actions = [] }: SidebarActionGroupProps) {
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
