import type { SystemRoute } from "../../routing/types.ts";

export interface SystemSidebarProps {
  systemRoute: SystemRoute;
  setSystemRoute: (route: SystemRoute) => void;
  setSystemActionIntent: (intent: string) => void;
  canViewUsers: boolean;
  canViewRoles: boolean;
  canViewMenus: boolean;
  canViewParams: boolean;
  canViewOperationLog: boolean;
  canManageUsers: boolean;
  canManageRoles: boolean;
  canManageMenus: boolean;
  canManageParams: boolean;
}

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
}: SystemSidebarProps) {
  const hasManagementPage = canViewUsers || canViewRoles || canViewMenus || canViewParams;
  if (!hasManagementPage && canViewOperationLog) {
    return <div className="side-group"><div className="side-title">操作日志</div></div>;
  }
  if (!hasManagementPage) return null;

  return (
    <>
      <div className="side-group">
        <div className="side-title">系统管理</div>
        {canViewUsers ? <div className={`side-item${systemRoute.page === "users" ? " active" : ""}`} onClick={() => setSystemRoute({ page: "users" })}>用户管理</div> : null}
        {canViewRoles ? <div className={`side-item${systemRoute.page === "roles" ? " active" : ""}`} onClick={() => setSystemRoute({ page: "roles" })}>角色管理</div> : null}
        {canViewMenus ? <div className={`side-item${systemRoute.page === "menus" ? " active" : ""}`} onClick={() => setSystemRoute({ page: "menus" })}>菜单管理</div> : null}
        {canViewParams ? <div className={`side-item${systemRoute.page === "param-dicts" ? " active" : ""}`} onClick={() => setSystemRoute({ page: "param-dicts" })}>参数字典</div> : null}
        {canViewOperationLog ? <div className={`side-item${systemRoute.page === "operation-logs" ? " active" : ""}`} onClick={() => setSystemRoute({ page: "operation-logs" })}>操作日志</div> : null}
      </div>

      {systemRoute.page === "users" && canManageUsers ? <div className="side-group"><div className="side-title">维护</div><div className="side-item" onClick={() => setSystemActionIntent("new-user")}>新增用户</div></div> : null}
      {systemRoute.page === "roles" && canManageRoles ? <div className="side-group"><div className="side-title">维护</div><div className="side-item" onClick={() => setSystemActionIntent("new-role")}>新增角色</div></div> : null}
      {systemRoute.page === "menus" && canManageMenus ? <div className="side-group"><div className="side-title">维护</div><div className="side-item" onClick={() => setSystemActionIntent("new-menu")}>新增菜单</div></div> : null}
      {systemRoute.page === "param-dicts" && canManageParams ? <div className="side-group"><div className="side-title">维护</div><div className="side-item" onClick={() => setSystemActionIntent("new-param")}>新增参数</div></div> : null}
    </>
  );
}
