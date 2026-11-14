import { useTranslation } from "react-i18next";

import { SidebarFilterGroup } from "./SidebarFilterGroup.tsx";

export interface StatusFilterGroupProps {
      value: string | null | undefined;
      onChange: (value: string | null) => void;
      totalCount: number;
      enabledCount: number;
      disabledCount: number;
      allValue: string | null;
      title?: string | undefined;
      allLabel?: string | undefined;
      enabledLabel?: string | undefined;
      disabledLabel?: string | undefined;
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
      title,
      allLabel,
      enabledLabel,
      disabledLabel,
}: StatusFilterGroupProps) {
      const { t } = useTranslation("common");
      const resolvedTitle = title || t("status.title");
      const resolvedAllLabel = allLabel || t("status.all");
      const resolvedEnabledLabel = enabledLabel || t("status.enabled");
      const resolvedDisabledLabel = disabledLabel || t("status.disabled");
      return (
            <SidebarFilterGroup
                  title={resolvedTitle}
                  allOption={{
                        key: "all",
                        label: resolvedAllLabel,
                        count: totalCount,
                        active: value === allValue,
                        onClick: () => onChange(allValue),
                  }}
                  items={[
                        {
                              key: "enabled",
                              label: resolvedEnabledLabel,
                              count: enabledCount,
                              active: value === enabledValue,
                              onClick: () => onChange(enabledValue),
                        },
                        {
                              key: "disabled",
                              label: resolvedDisabledLabel,
                              count: disabledCount,
                              active: value === disabledValue,
                              onClick: () => onChange(disabledValue),
                        },
                  ]}
            />
      );
}
