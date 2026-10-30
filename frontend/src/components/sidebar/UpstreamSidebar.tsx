import type { DictOption } from "../../utils/optionUtils.ts";
import type { UpstreamFilter, UpstreamRoute } from "../../routing/types.ts";
import type { UseUpstreamModuleResult } from "../../hooks/useUpstreamModule.ts";
import { DEFAULT_UP_FILTER } from "../../config/defaults.ts";
import { SidebarActionGroup } from "./common/SidebarActionGroup.tsx";
import { SidebarFilterGroup } from "./common/SidebarFilterGroup.tsx";
import { StatusFilterGroup } from "./common/StatusFilterGroup.tsx";

export interface UpstreamSidebarProps {
  upstream: UseUpstreamModuleResult;
  statusOptions: readonly DictOption[];
  requireLogin: (action: () => void, permission?: string) => boolean;
  canEdit?: boolean | undefined;
  setUpRoute: (route: UpstreamRoute) => void;
}

export function UpstreamSidebar({ upstream, statusOptions, requireLogin, canEdit = false, setUpRoute }: UpstreamSidebarProps) {
  const { upstreamSystemCount, upstreamFacets, upstreamDbTypes, upFilter, setUpFilter } = upstream;
  const dbTypeCounts = upstreamFacets.dbType;

  const enabledValue = statusOptions.find((item) => item.value !== "disabled")?.value || "enabled";
  const disabledValue = statusOptions.find((item) => item.value !== enabledValue)?.value || "disabled";
  const statusCounts = {
    enabled: upstreamFacets.status[enabledValue] || 0,
    disabled: upstreamFacets.status[disabledValue] || 0,
  };

  return (
    <>
      <SidebarFilterGroup
        title="数据库类型"
        allOption={{
          key: "all-db-types",
          label: "全部类型",
          count: upstreamSystemCount,
          active: !upFilter.dbType,
          onClick: () => setUpFilter((prev) => ({ ...prev, dbType: null })),
        }}
        items={upstreamDbTypes
          .filter((item) => dbTypeCounts[item.value])
          .map((item) => ({
            key: item.value,
            label: item.name,
            count: dbTypeCounts[item.value] || 0,
            active: upFilter.dbType === item.value,
            onClick: () => setUpFilter((prev) => ({
              ...prev,
              dbType: prev.dbType === item.value ? null : item.value,
            })),
          }))}
      />

      <StatusFilterGroup
        value={upFilter.status}
        allValue={DEFAULT_UP_FILTER.status}
        enabledValue={enabledValue}
        disabledValue={disabledValue}
        totalCount={upstreamSystemCount}
        enabledCount={statusCounts.enabled}
        disabledCount={statusCounts.disabled}
        onChange={(status) => setUpFilter((prev: UpstreamFilter) => ({ ...prev, status }))}
      />

      <SidebarActionGroup
        actions={canEdit ? [{
          key: "create-upstream",
          label: "新增系统",
          onClick: () => requireLogin(() => setUpRoute({ page: "new", id: null })),
        }] : []}
      />
    </>
  );
}
