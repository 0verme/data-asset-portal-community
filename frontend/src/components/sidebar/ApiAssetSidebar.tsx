import type { Dispatch, SetStateAction } from "react";
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation("apiAsset");
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
        count: apiAsset.globalTotal,
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
        t("sidebar.methodTitle"),
        "method",
        t("sidebar.allMethods"),
        Object.entries(apiAsset.facets.method)
          .sort()
          .map(([value, count]) => ({ value, count, label: value })),
      )}
      {group(
        t("sidebar.systemTitle"),
        "downstreamSystemId",
        t("sidebar.allSystems"),
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
        totalCount={apiAsset.globalTotal}
        enabledCount={apiAsset.facets.status["enabled"] || 0}
        disabledCount={apiAsset.facets.status["disabled"] || 0}
        allValue={null}
        title={t("sidebar.statusTitle")}
        allLabel={t("sidebar.allStatuses")}
        enabledLabel={t("status.enabled")}
        disabledLabel={t("status.disabled")}
      />
      <SidebarActionGroup
        actions={
          canEdit
            ? [
                {
                  key: "create-api",
                  label: t("page.create"),
                  onClick: () => requireLogin(apiAsset.create),
                },
              ]
            : []
        }
      />
    </>
  );
}
