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

import React from "react";
import { DEFAULT_INDICATOR_ROUTE } from "../../config/defaults.js";
import { INDICATOR_DIMENSION_OPTIONS } from "../../data/indicators.js";
import { SidebarActionGroup } from "./common/SidebarActionGroup.jsx";
import { SidebarFilterGroup } from "./common/SidebarFilterGroup.jsx";
import { StatusFilterGroup } from "./common/StatusFilterGroup.jsx";

export function IndicatorSidebar({ indicator, indicatorFilter, setIndicatorFilter, setIndicatorRoute }) {
  const { indicators, indicatorFacets, indicatorCreate } = indicator;

  return (
    <>
      <SidebarFilterGroup
        title="指标维度"
        items={[
          {
            key: "all",
            label: "全部指标",
            count: indicators.length,
            active: indicatorFilter.dimension === "all",
            onClick: () => {
              setIndicatorFilter((prev) => ({ ...prev, dimension: "all" }));
              setIndicatorRoute(DEFAULT_INDICATOR_ROUTE);
            },
          },
          ...INDICATOR_DIMENSION_OPTIONS.filter((item) => item.value !== "all").map((item) => ({
            key: item.value,
            active: indicatorFilter.dimension === item.value,
            onClick: () => {
              setIndicatorFilter((prev) => ({ ...prev, dimension: item.value }));
              setIndicatorRoute(DEFAULT_INDICATOR_ROUTE);
            },
            content: (
              <>
                <span className="badge-layer">{item.code}</span>
                {item.label}
                <span className="count">{indicatorFacets.dimension[item.value] || 0}</span>
              </>
            ),
          })),
        ]}
      />

      <StatusFilterGroup
        value={indicatorFilter.status}
        allValue="all"
        totalCount={indicators.length}
        enabledCount={indicatorFacets.status.enabled || 0}
        disabledCount={indicatorFacets.status.disabled || 0}
        onChange={(status) => {
          setIndicatorFilter((prev) => ({ ...prev, status }));
          setIndicatorRoute(DEFAULT_INDICATOR_ROUTE);
        }}
      />

      <SidebarActionGroup
        actions={[
          {
            key: "create-indicator",
            label: "新增指标",
            onClick: indicatorCreate,
          },
        ]}
      />
    </>
  );
}
