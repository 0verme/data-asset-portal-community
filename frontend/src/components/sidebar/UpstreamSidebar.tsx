import type { DictOption } from "../../utils/optionUtils.ts";
import type { UpstreamFilter, UpstreamRoute } from "../../routing/types.ts";
import type { UseUpstreamModuleResult } from "../../hooks/useUpstreamModule.ts";
import { DEFAULT_UP_FILTER } from "../../config/defaults.ts";
import { SidebarActionGroup } from "./common/SidebarActionGroup.tsx";
import { SidebarFilterGroup } from "./common/SidebarFilterGroup.tsx";
import { StatusFilterGroup } from "./common/StatusFilterGroup.tsx";
import { Icon } from "../ui.tsx";

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

  const { enabledValue, disabledValue, enabledCount, disabledCount } = upstreamStatusFacets(upstream, statusOptions);
  const hasActiveFilters = Boolean(upFilter.dbType)
    || upFilter.status !== DEFAULT_UP_FILTER.status;

  return (
    <div className="upstream-sidebar">
      <h2 className="upstream-sidebar-heading">数据源 <small lang="en">SOURCES</small></h2>
      <SidebarFilterGroup
        title="数据库类型"
        allOption={{
          key: "all-db-types",
          label: "全部类型",
          leading: <Icon name="layers" size={15} />,
          count: upstreamSystemCount,
          active: !upFilter.dbType,
          onClick: () => setUpFilter((prev) => ({ ...prev, dbType: null })),
        }}
        items={upstreamDbTypes
          .filter((item) => dbTypeCounts[item.value])
          .map((item) => ({
            key: item.value,
            label: item.name,
            leading: <Icon name="db" size={14} />,
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
        enabledCount={enabledCount}
        disabledCount={disabledCount}
        onChange={(status) => setUpFilter((prev: UpstreamFilter) => ({ ...prev, status }))}
      />

      <div className="upstream-sidebar-filter-tools">
        <button
          className="upstream-clear-filter"
          type="button"
          disabled={!hasActiveFilters}
          onClick={() => setUpFilter(() => ({ ...DEFAULT_UP_FILTER }))}
        >
          <Icon name="close" size={13} />清空筛选
        </button>
      </div>

      <SidebarActionGroup
        actions={canEdit ? [{
          key: "create-upstream",
          label: "新增系统",
          onClick: () => requireLogin(() => setUpRoute({ page: "new", id: null })),
        }] : []}
      />
    </div>
  );
}

function upstreamStatusFacets(upstream: UseUpstreamModuleResult, statusOptions: readonly DictOption[]) {
  const enabledValue = statusOptions.find((item) => item.value !== "disabled")?.value || "enabled";
  const disabledValue = statusOptions.find((item) => item.value !== enabledValue)?.value || "disabled";
  return {
    enabledValue,
    disabledValue,
    enabledCount: upstream.upstreamFacets.status[enabledValue] || 0,
    disabledCount: upstream.upstreamFacets.status[disabledValue] || 0,
  };
}

export function UpstreamCoverageSummary({ upstream, statusOptions }: Pick<UpstreamSidebarProps, "upstream" | "statusOptions">) {
  const { upstreamSystemCount, upstreamFacets } = upstream;
  const { enabledCount } = upstreamStatusFacets(upstream, statusOptions);
  const typeCount = Object.values(upstreamFacets.dbType).filter((count) => count > 0).length;
  return (
    <section className="upstream-summary" aria-label="系统覆盖摘要" aria-busy={upstream.upstreamLoading}>
      <h3>系统覆盖摘要</h3>
      {upstream.upstreamLoaded ? (
        <>
          <div className="upstream-summary-number">{enabledCount} <small>/ {upstreamSystemCount}</small></div>
          <p>已启用 {enabledCount} 个上游系统</p>
          {upstreamSystemCount > 0 ? (
            <progress className="sidebar-progress-track" aria-label="系统启用比例" max={upstreamSystemCount} value={enabledCount} />
          ) : (
            <div className="sidebar-progress-track sidebar-progress-track--empty" aria-hidden="true" />
          )}
          <div className="upstream-summary-types"><Icon name="layers" size={14} />类型覆盖：<strong>{typeCount} 类</strong></div>
        </>
      ) : <p>{upstream.upstreamError ? "统计暂不可用" : "正在加载统计…"}</p>}
    </section>
  );
}
