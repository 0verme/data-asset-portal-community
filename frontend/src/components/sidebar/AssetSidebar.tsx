// Copyright 2025 Jearhe
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import type { UseAssetModuleResult } from "../../hooks/useAssetModule.ts";
import type { AssetRoute } from "../../routing/types.ts";
import { SidebarActionGroup } from "./common/SidebarActionGroup.tsx";
import { AssetSidebarFilterGroup, type AssetSidebarFilterItem } from "./asset/AssetSidebarFilterGroup.tsx";
import { buildSidebarFacetItems } from "./common/buildSidebarFacetItems.ts";

export interface AssetSidebarProps {
  asset: UseAssetModuleResult;
  route: AssetRoute;
  canEdit?: boolean | undefined;
}

export function AssetSidebar({ asset, route, canEdit = false }: AssetSidebarProps) {
  const {
    domain,
    homeLoading,
    homeError,
    setDomain,
    selectedLayer,
    setSelectedLayer,
    assetBack,
    assetCreate,
    domainCounts,
    layerCounts,
    visibleDomains,
    visibleLayers,
  } = asset;
  const layerItems: AssetSidebarFilterItem[] = buildSidebarFacetItems({
    options: visibleLayers,
    selectedValue: selectedLayer,
    getValue: (layer) => layer.code,
    getCount: (layer) => layer.count || 0,
    onSelect: (nextValue) => {
      setSelectedLayer(nextValue);
      assetBack();
    },
    renderContent: ({ option, count }) => (
      <>
        <span className="asset-sidebar-filter-layer-label">
          <span className="layer-code">{option.code}</span>
          <span className="layer-cn">{option.cn}</span>
        </span>
        <span className="count">{count}</span>
      </>
    ),
  }).map((item) => {
    const layer = visibleLayers.find((option) => option.code === item.key);
    return {
      ...item,
      tooltip: layer ? `${layer.code} ${layer.cn}` : undefined,
    };
  });
  const domainItems: AssetSidebarFilterItem[] = buildSidebarFacetItems({
    options: visibleDomains,
    selectedValue: domain,
    getValue: (item) => item,
    getCount: (item) => domainCounts[item] || 0,
    onSelect: (nextValue) => {
      setDomain(nextValue);
      assetBack();
    },
  }).map((item) => ({
    ...item,
    tooltip: item.key.length > 6 ? item.key : undefined,
  }));

  const showCreateInSidebar = canEdit && (
    route.page !== "home" || homeLoading || Boolean(homeError)
  );

  return (
    <>
      <AssetSidebarFilterGroup
        title="数据分层"
        allOption={{
          key: "all-layers",
          label: "全部层级",
          count: Object.values(layerCounts).reduce(
            (total, count) => total + count,
            0,
          ),
          active: !selectedLayer,
          onClick: () => {
            setSelectedLayer(null);
            assetBack();
          },
        }}
        items={layerItems}
      />

      <AssetSidebarFilterGroup
        title="主题域"
        allOption={{
          key: "all-domains",
          label: "全部主题域",
          count: Object.values(domainCounts).reduce(
            (total, count) => total + count,
            0,
          ),
          active: !domain,
          onClick: () => {
            setDomain(null);
            assetBack();
          },
        }}
        items={domainItems}
      />

      <SidebarActionGroup
        actions={
          showCreateInSidebar
            ? [
                {
                  key: "create-asset",
                  label: "新增表",
                  onClick: assetCreate,
                },
              ]
            : []
        }
      />
    </>
  );
}
