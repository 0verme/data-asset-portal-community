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
import { SystemManagementPage } from "../system/index.js";
import { OperationLogPage } from "../OperationLog/OperationLogPage.jsx";

export function SystemView({
  systemRoute,
  query,
  canEdit,
  canManageRoles,
  canManageSystem,
  requireLogin,
  systemActionIntent,
  setSystemActionIntent,
}) {
  if (systemRoute.page === "operation-logs" || !canManageSystem) {
    return <OperationLogPage query={query} />;
  }
  return (
    <SystemManagementPage
      route={systemRoute}
      query={query}
      canEdit={systemRoute.page === "roles" ? canManageRoles : canEdit}
      canManageRoles={canManageRoles}
      canManageSystem={canManageSystem}
      requireLogin={requireLogin}
      actionIntent={systemActionIntent}
      onActionHandled={() => setSystemActionIntent("")}
    />
  );
}
