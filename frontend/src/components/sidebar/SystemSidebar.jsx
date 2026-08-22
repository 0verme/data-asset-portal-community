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

export function SystemSidebar({
  systemRoute,
  setSystemRoute,
  setSystemActionIntent,
  canViewUsers,
  canViewRoles,
  canViewMenus,
  canViewParams,
  canViewOperationLog,
  canManageUsers,
  canManageRoles,
  canManageMenus,
  canManageParams,
}) {
  const hasManagementPage = canViewUsers || canViewRoles || canViewMenus || canViewParams;
  if (!hasManagementPage && canViewOperationLog) {
    return <div className="side-group"><div className="side-title">操作日志</div></div>;
  }
  if (!hasManagementPage) return null;

  return (
    <>
      <div className="side-group">
        <div className="side-title">系统管理</div>
        {canViewUsers ? <div className={"side-item" + (systemRoute.page === "users" ? " active" : "")} onClick={() => setSystemRoute({ page: "users" })}>用户管理</div> : null}
        {canViewRoles ? <div className={"side-item" + (systemRoute.page === "roles" ? " active" : "")} onClick={() => setSystemRoute({ page: "roles" })}>角色管理</div> : null}
        {canViewMenus ? <div className={"side-item" + (systemRoute.page === "menus" ? " active" : "")} onClick={() => setSystemRoute({ page: "menus" })}>菜单管理</div> : null}
        {canViewParams ? <div className={"side-item" + (systemRoute.page === "param-dicts" ? " active" : "")} onClick={() => setSystemRoute({ page: "param-dicts" })}>参数字典</div> : null}
        {canViewOperationLog ? <div className={"side-item" + (systemRoute.page === "operation-logs" ? " active" : "")} onClick={() => setSystemRoute({ page: "operation-logs" })}>操作日志</div> : null}
      </div>

      {systemRoute.page === "users" && canManageUsers ? <div className="side-group"><div className="side-title">维护</div><div className="side-item" onClick={() => setSystemActionIntent("new-user")}>新增用户</div></div> : null}
      {systemRoute.page === "roles" && canManageRoles ? <div className="side-group"><div className="side-title">维护</div><div className="side-item" onClick={() => setSystemActionIntent("new-role")}>新增角色</div></div> : null}
      {systemRoute.page === "menus" && canManageMenus ? <div className="side-group"><div className="side-title">维护</div><div className="side-item" onClick={() => setSystemActionIntent("new-menu")}>新增菜单</div></div> : null}
      {systemRoute.page === "param-dicts" && canManageParams ? <div className="side-group"><div className="side-title">维护</div><div className="side-item" onClick={() => setSystemActionIntent("new-param")}>新增参数</div></div> : null}
    </>
  );
}
