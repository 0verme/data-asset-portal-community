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

import { SystemManagementPage } from "../system/index.js";
import { OperationLogPage } from "../OperationLog/OperationLogPage.jsx";

export function SystemView({
  systemRoute,
  query,
  authenticated = true,
  canManageMenus = false,
  canManageParams = false,
  canManageRoles,
  canManageUsers = false,
  canManageSystem,
  requireLogin,
  systemActionIntent,
  setSystemActionIntent,
}) {
  if (!authenticated) {
    return (
      <div className="state-card" role="status" aria-live="polite">
        <h4>登录后访问系统管理</h4>
        <p>系统管理、用户、角色、配置和操作日志仅对授权用户开放。</p>
        <button className="btn primary" type="button" onClick={() => requireLogin?.(() => {})}>登录</button>
      </div>
    );
  }
  if (systemRoute.page === "operation-logs" || !canManageSystem) {
    return <OperationLogPage query={query} />;
  }
  const canEditCurrentPage = systemRoute.page === "roles"
    ? canManageRoles
    : systemRoute.page === "menus"
      ? canManageMenus
      : systemRoute.page === "param-dicts"
        ? canManageParams
        : canManageUsers;
  return (
    <SystemManagementPage
      route={systemRoute}
      query={query}
      canEdit={canEditCurrentPage}
      canManageRoles={canManageRoles}
      canManageSystem={canManageSystem}
      requireLogin={requireLogin}
      actionIntent={systemActionIntent}
      onActionHandled={() => setSystemActionIntent("")}
    />
  );
}
