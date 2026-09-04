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
      return (
            <SidebarFilterGroup
                  title="状态"
                  allOption={{
                        key: "all",
                        label: "全部状态",
                        count: totalCount,
                        active: value === allValue,
                        onClick: () => onChange(allValue),
                  }}
                  items={[
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
