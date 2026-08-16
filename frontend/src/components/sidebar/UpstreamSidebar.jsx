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
import { DEFAULT_UP_FILTER } from "../../config/defaults.js";
import { SidebarActionGroup } from "./common/SidebarActionGroup.jsx";
import { SidebarFilterGroup } from "./common/SidebarFilterGroup.jsx";
import { StatusFilterGroup } from "./common/StatusFilterGroup.jsx";

export function UpstreamSidebar({ upstream, statusOptions, requireLogin, setUpRoute }) {
  const { upstreamSystems, upstreamDbTypes, upFilter, setUpFilter } = upstream;

  const dbTypeCounts = upstreamSystems.reduce((acc, item) => {
    acc[item.dbType] = (acc[item.dbType] || 0) + 1;
    return acc;
  }, {});

  const enabledValue = statusOptions.find((item) => item.value !== "disabled")?.value || "enabled";
  const disabledValue = statusOptions.find((item) => item.value !== enabledValue)?.value || "disabled";
  const statusCounts = upstreamSystems.reduce(
    (acc, item) => {
      if (item.status === enabledValue) {
        acc.enabled += 1;
      } else if (item.status === disabledValue) {
        acc.disabled += 1;
      }
      return acc;
    },
    { enabled: 0, disabled: 0 },
  );

  return (
    <>
      <SidebarFilterGroup
        title="数据库类型"
        items={upstreamDbTypes
          .filter((item) => dbTypeCounts[item.value])
          .map((item) => ({
            key: item.value,
            label: item.name,
            count: dbTypeCounts[item.value],
            active: upFilter.dbType === item.value,
            onClick: () =>
              setUpFilter((prev) => ({
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
        totalCount={upstreamSystems.length}
        enabledCount={statusCounts.enabled}
        disabledCount={statusCounts.disabled}
        onChange={(status) => setUpFilter((prev) => ({ ...prev, status }))}
      />

      <SidebarActionGroup
        actions={[
          {
            key: "create-upstream",
            label: "新增系统",
            onClick: () => requireLogin(() => setUpRoute({ page: "new", id: null })),
          },
        ]}
      />
    </>
  );
}
