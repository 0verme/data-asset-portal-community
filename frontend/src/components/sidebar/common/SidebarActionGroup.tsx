import { useTranslation } from "react-i18next";
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
      const { t } = useTranslation("common");
      if (!actions.length) return null;

      return (
            <SidebarFilterGroup
                  title={t("sidebar.maintenance")}
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
