import type { Dispatch, SetStateAction } from "react";

import { DEFAULT_INDICATOR_ROUTE } from "../../config/defaults.ts";
import type { UseIndicatorModuleResult } from "../../hooks/useIndicatorModule.ts";
import type { IndicatorFilter, IndicatorRoute } from "../../routing/types.ts";
import { SidebarActionGroup } from "./common/SidebarActionGroup.tsx";
import { SidebarFilterGroup } from "./common/SidebarFilterGroup.tsx";
import { StatusFilterGroup } from "./common/StatusFilterGroup.tsx";

export interface IndicatorSidebarProps {
  indicator: UseIndicatorModuleResult;
  indicatorFilter: IndicatorFilter;
  setIndicatorFilter: Dispatch<SetStateAction<IndicatorFilter>>;
  setIndicatorRoute: (route: IndicatorRoute) => void;
  canEdit?: boolean | undefined;
}

export function IndicatorSidebar({
  indicator,
  indicatorFilter,
  setIndicatorFilter,
  setIndicatorRoute,
  canEdit = false,
}: IndicatorSidebarProps) {
  const { indicators, indicatorFacets, indicatorDimensions, indicatorCreate } = indicator;

  return (
    <>
      <SidebarFilterGroup
        title="指标维度"
        allOption={{
          key: "all",
          label: "全部指标",
          count: indicators.length,
          active: indicatorFilter.dimension === "all",
          onClick: () => {
            setIndicatorFilter((prev) => ({ ...prev, dimension: "all" }));
            setIndicatorRoute(DEFAULT_INDICATOR_ROUTE);
          },
        }}
        items={indicatorDimensions.map((item) => ({
          key: item.value || "__unassigned__",
          active: indicatorFilter.dimension === item.value,
          onClick: () => {
            setIndicatorFilter((prev) => ({
              ...prev,
              dimension: item.value,
            }));
            setIndicatorRoute(DEFAULT_INDICATOR_ROUTE);
          },
          content: (
            <>
              <span className="badge-layer">{item.code}</span>
              {item.label}
              <span className="count">
                {indicatorFacets.dimension[item.value] || 0}
              </span>
            </>
          ),
        }))}
      />

      <StatusFilterGroup
        value={indicatorFilter.status}
        allValue="all"
        totalCount={indicators.length}
        enabledCount={indicatorFacets.status["enabled"] || 0}
        disabledCount={indicatorFacets.status["disabled"] || 0}
        onChange={(status) => {
          setIndicatorFilter((prev) => ({ ...prev, status: status || "all" }));
          setIndicatorRoute(DEFAULT_INDICATOR_ROUTE);
        }}
      />

      <SidebarActionGroup
        actions={
          canEdit
            ? [
                {
                  key: "create-indicator",
                  label: "新增指标",
                  onClick: indicatorCreate,
                },
              ]
            : []
        }
      />
    </>
  );
}
