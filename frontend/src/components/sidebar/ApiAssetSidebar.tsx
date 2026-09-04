import type { Dispatch, SetStateAction } from "react";

import type { UseApiAssetModuleResult } from "../../hooks/useApiAssetModule.ts";
import type { ApiAssetFilter } from "../../routing/types.ts";
import { SidebarActionGroup } from "./common/SidebarActionGroup.tsx";
import { SidebarFilterGroup } from "./common/SidebarFilterGroup.tsx";
import { StatusFilterGroup } from "./common/StatusFilterGroup.tsx";

type RequireLogin = (action: () => void, permission?: string) => boolean;

type FacetOption = {
  value: string;
  count: number;
  label: string;
};

export interface ApiAssetSidebarProps {
  apiAsset: UseApiAssetModuleResult;
  filter: ApiAssetFilter;
  setFilter: Dispatch<SetStateAction<ApiAssetFilter>>;
  requireLogin: RequireLogin;
  canEdit?: boolean | undefined;
}

export function ApiAssetSidebar({
  apiAsset,
  filter,
  setFilter,
  requireLogin,
  canEdit = false,
}: ApiAssetSidebarProps) {
  const group = (
    title: string,
    key: keyof ApiAssetFilter,
    allLabel: string,
    items: readonly FacetOption[],
  ) => (
    <SidebarFilterGroup
      title={title}
      allOption={{
        key: `all-${String(key)}`,
        label: allLabel,
        count: apiAsset.items.length,
        active:
          filter[key] === null ||
          filter[key] === undefined ||
          filter[key] === "",
        onClick: () => setFilter((previous) => ({ ...previous, [key]: null })),
      }}
      items={items.map(({ value, count, label }) => ({
        key: value,
        label,
        count,
        active: String(filter[key]) === String(value),
        onClick: () =>
          setFilter((previous) => ({
            ...previous,
            [key]: previous[key] === value ? null : value,
          })),
      }))}
    />
  );

  return (
    <>
      {group(
        "请求方式",
        "method",
        "全部请求方式",
        Object.entries(apiAsset.facets.method)
          .sort()
          .map(([value, count]) => ({ value, count, label: value })),
      )}
      {group(
        "业务系统",
        "downstreamSystemId",
        "全部业务系统",
        apiAsset.systems
          .filter((system) => apiAsset.facets.downstreamSystemId[system.id])
          .map((system) => ({
            value: String(system.id),
            count: apiAsset.facets.downstreamSystemId[system.id] || 0,
            label: system.name,
          })),
      )}
      <StatusFilterGroup
        value={filter.status}
        onChange={(status) =>
          setFilter((previous) => ({ ...previous, status }))
        }
        totalCount={apiAsset.items.length}
        enabledCount={apiAsset.facets.status["enabled"] || 0}
        disabledCount={apiAsset.facets.status["disabled"] || 0}
        allValue={null}
      />
      <SidebarActionGroup
        actions={
          canEdit
            ? [
                {
                  key: "create-api",
                  label: "新增 API",
                  onClick: () => requireLogin(apiAsset.create),
                },
              ]
            : []
        }
      />
    </>
  );
}
