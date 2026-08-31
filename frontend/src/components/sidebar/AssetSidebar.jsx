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

import { SidebarActionGroup } from "./common/SidebarActionGroup.jsx";
import { SidebarFilterGroup } from "./common/SidebarFilterGroup.jsx";
import { buildSidebarFacetItems } from "./common/buildSidebarFacetItems.js";

export function AssetSidebar({ asset, canEdit = false }) {
  const {
    domain,
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

  return (
    <>
      <SidebarFilterGroup
        title="数据分层"
        items={[
          {
            key: "all-layers",
            label: "全部层级",
            count: Object.values(layerCounts).reduce((total, count) => total + count, 0),
            active: !selectedLayer,
            onClick: () => {
              setSelectedLayer(null);
              assetBack();
            },
          },
          ...buildSidebarFacetItems({
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
                <span className="layer-code">{option.code}</span>
                <span className="layer-cn">{option.cn}</span>
                <span className="count">{count}</span>
              </>
            ),
          }),
        ]}
      />

      <SidebarFilterGroup
        title="主题域"
        items={[
          {
            key: "all-domains",
            label: "全部主题域",
            count: Object.values(domainCounts).reduce((total, count) => total + count, 0),
            active: !domain,
            onClick: () => {
              setDomain(null);
              assetBack();
            },
          },
          ...buildSidebarFacetItems({
            options: visibleDomains,
            selectedValue: domain,
            getValue: (item) => item,
            getCount: (item) => domainCounts[item] || 0,
            onSelect: (nextValue) => {
              setDomain(nextValue);
              assetBack();
            },
          }),
        ]}
      />

      <SidebarActionGroup
        actions={canEdit ? [{
          key: "create-asset",
          label: "新增表",
          onClick: assetCreate,
        }] : []}
      />
    </>
  );
}
