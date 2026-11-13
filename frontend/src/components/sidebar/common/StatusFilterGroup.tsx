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
      title = "状态",
      allLabel = "全部状态",
      enabledLabel = "启用",
      disabledLabel = "禁用",
}: StatusFilterGroupProps) {
      return (
            <SidebarFilterGroup
                  title={title}
                  allOption={{
                        key: "all",
                        label: allLabel,
                        count: totalCount,
                        active: value === allValue,
                        onClick: () => onChange(allValue),
                  }}
                  items={[
                        {
                              key: "enabled",
                              label: enabledLabel,
                              count: enabledCount,
                              active: value === enabledValue,
                              onClick: () => onChange(enabledValue),
                        },
                        {
                              key: "disabled",
                              label: disabledLabel,
                              count: disabledCount,
                              active: value === disabledValue,
                              onClick: () => onChange(disabledValue),
                        },
                  ]}
            />
      );
}
