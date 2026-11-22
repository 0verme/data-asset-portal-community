import { useTranslation } from "react-i18next";
import { SidebarFilterGroup } from "./SidebarFilterGroup.tsx";

export interface StatusFilterGroupProps {
  value: string | null | undefined;
  onChange: (value: string | null) => void;
  totalCount: number;
  enabledCount: number;
  disabledCount: number;
  allValue: string | null;
  enabledValue?: string | undefined;
  disabledValue?: string | undefined;
}

export function StatusFilterGroup({
  value,
  onChange,
  totalCount,
  enabledCount,
  disabledCount,
  allValue,
  enabledValue = "enabled",
  disabledValue = "disabled",
}: StatusFilterGroupProps) {
  const { t } = useTranslation("common");
  return (
    <SidebarFilterGroup
      title={t("shared.status")}
      allOption={{
        key: "all",
        label: t("shared.allStatus"),
        count: totalCount,
        active: value === allValue,
        onClick: () => onChange(allValue),
      }}
      items={[
        {
          key: "enabled",
          label: t("shared.enabled"),
          count: enabledCount,
          active: value === enabledValue,
          onClick: () => onChange(enabledValue),
        },
        {
          key: "disabled",
          label: t("shared.disabled"),
          count: disabledCount,
          active: value === disabledValue,
          onClick: () => onChange(disabledValue),
        },
      ]}
    />
  );
}
