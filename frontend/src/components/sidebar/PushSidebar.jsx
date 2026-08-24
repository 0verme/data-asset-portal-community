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

import { DEFAULT_PUSH_FILTER } from "../../config/defaults.js";
import { SidebarActionGroup } from "./common/SidebarActionGroup.jsx";
import { SidebarFilterGroup } from "./common/SidebarFilterGroup.jsx";
import { StatusFilterGroup } from "./common/StatusFilterGroup.jsx";

export function PushSidebar({ push, statusOptions, requireLogin, pushRoute }) {
  const {
    pushSystems,
    pushProtocolOptions,
    pushFilter,
    setPushFilter,
    pushFacets,
    pushGoSystemEdit,
    pushOpenSystem,
    recentPushSystems,
  } = push;

  const enabledValue = statusOptions.find((item) => item.value !== "disabled")?.value || "enabled";
  const disabledValue = statusOptions.find((item) => item.value !== enabledValue)?.value || "disabled";

  return (
    <>
      <SidebarFilterGroup
        title="连接协议"
        items={pushProtocolOptions
          .filter((item) => pushFacets.protocol[item.value])
          .map((item) => ({
            key: item.value,
            label: item.name,
            count: pushFacets.protocol[item.value] || 0,
            active: pushFilter.protocol === item.value,
            onClick: () =>
              setPushFilter((prev) => ({
                ...prev,
                protocol: prev.protocol === item.value ? null : item.value,
              })),
          }))}
      />

      <StatusFilterGroup
        value={pushFilter.status}
        allValue={DEFAULT_PUSH_FILTER.status}
        enabledValue={enabledValue}
        disabledValue={disabledValue}
        totalCount={pushSystems.length}
        enabledCount={pushFacets.status[enabledValue] || 0}
        disabledCount={pushFacets.status[disabledValue] || 0}
        onChange={(status) => setPushFilter((prev) => ({ ...prev, status }))}
      />

      <SidebarFilterGroup
        title="重要程度"
        items={[
          { value: "important", label: "重要" },
          { value: "normal", label: "普通" },
        ].map((item) => ({
          key: item.value,
          label: item.label,
          count: pushFacets.importanceLevel[item.value] || 0,
          active: pushFilter.importanceLevel === item.value,
          onClick: () =>
            setPushFilter((prev) => ({
              ...prev,
              importanceLevel: prev.importanceLevel === item.value ? null : item.value,
            })),
        }))}
      />

      <SidebarActionGroup
        actions={[
          {
            key: "create-push-system",
            label: "新增系统",
            onClick: () => requireLogin(() => pushGoSystemEdit(null)),
          },
        ]}
      />

      {recentPushSystems.length ? (
        <SidebarFilterGroup
          title="最近访问"
          items={recentPushSystems.map((system) => ({
            key: system.id,
            active: pushRoute.sys === system.id,
            onClick: () => pushOpenSystem(system.id),
            content: <span className="side-ellipsis">{system.name}</span>,
          }))}
        />
      ) : null}
    </>
  );
}
