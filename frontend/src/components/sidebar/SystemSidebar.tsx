import type { SystemRoute } from "../../routing/types.ts";
import { useUiCopy } from "../../i18n/useUiTranslation.ts";

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
  const tx = useUiCopy("admin");
  const hasManagementPage = canViewUsers || canViewRoles || canViewMenus || canViewParams;
  if (!hasManagementPage && canViewOperationLog) {
    return <div className="side-group"><div className="side-title">{tx("操作日志")}</div></div>;
  }
  if (!hasManagementPage) return null;

  return (
    <>
      <div className="side-group">
        <div className="side-title">{tx("系统管理")}</div>
        {canViewUsers ? <div className={`side-item${systemRoute.page === "users" ? " active" : ""}`} onClick={() => setSystemRoute({ page: "users" })}>{tx("用户管理")}</div> : null}
        {canViewRoles ? <div className={`side-item${systemRoute.page === "roles" ? " active" : ""}`} onClick={() => setSystemRoute({ page: "roles" })}>{tx("角色管理")}</div> : null}
        {canViewMenus ? <div className={`side-item${systemRoute.page === "menus" ? " active" : ""}`} onClick={() => setSystemRoute({ page: "menus" })}>{tx("菜单管理")}</div> : null}
        {canViewParams ? <div className={`side-item${systemRoute.page === "param-dicts" ? " active" : ""}`} onClick={() => setSystemRoute({ page: "param-dicts" })}>{tx("参数字典")}</div> : null}
        {canViewOperationLog ? <div className={`side-item${systemRoute.page === "operation-logs" ? " active" : ""}`} onClick={() => setSystemRoute({ page: "operation-logs" })}>{tx("操作日志")}</div> : null}
      </div>

      {systemRoute.page === "users" && canManageUsers ? <div className="side-group"><div className="side-title">{tx("维护")}</div><div className="side-item" onClick={() => setSystemActionIntent("new-user")}>{tx("新增用户")}</div></div> : null}
      {systemRoute.page === "roles" && canManageRoles ? <div className="side-group"><div className="side-title">{tx("维护")}</div><div className="side-item" onClick={() => setSystemActionIntent("new-role")}>{tx("新增角色")}</div></div> : null}
      {systemRoute.page === "menus" && canManageMenus ? <div className="side-group"><div className="side-title">{tx("维护")}</div><div className="side-item" onClick={() => setSystemActionIntent("new-menu")}>{tx("新增菜单")}</div></div> : null}
      {systemRoute.page === "param-dicts" && canManageParams ? <div className="side-group"><div className="side-title">{tx("维护")}</div><div className="side-item" onClick={() => setSystemActionIntent("new-param")}>{tx("新增参数")}</div></div> : null}
    </>
  );
}
