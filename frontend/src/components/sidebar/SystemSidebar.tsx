import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation("common");
  const sections = [
    { page: "users", label: t("systemManagement.users"), visible: canViewUsers, action: "new-user", actionLabel: t("systemManagement.newUser"), canManage: canManageUsers },
    { page: "roles", label: t("systemManagement.roles"), visible: canViewRoles, action: "new-role", actionLabel: t("systemManagement.newRole"), canManage: canManageRoles },
    { page: "menus", label: t("systemManagement.menus"), visible: canViewMenus, action: "new-menu", actionLabel: t("systemManagement.newMenu"), canManage: canManageMenus },
    { page: "param-dicts", label: t("systemManagement.params"), visible: canViewParams, action: "new-param", actionLabel: t("systemManagement.newParam"), canManage: canManageParams },
    { page: "search-recommendations", label: t("systemManagement.searchRecommendations"), visible: canViewParams },
    { page: "branding", label: t("systemManagement.branding"), visible: canViewParams },
    { page: "ai", label: t("systemManagement.ai"), visible: canViewParams },
    { page: "operation-logs", label: t("systemManagement.operationLogs"), visible: canViewOperationLog },
  ].filter((item) => item.visible);
  if (!sections.length) return null;

  const current = sections.find((item) => item.page === systemRoute.page);
  const action = current?.canManage ? current.action : undefined;

  return (
    <>
      <nav className="side-group" aria-label={t("systemManagement.navigation")}>
        <div className="side-title">{t("systemManagement.navigation")}</div>
        {sections.map(({ page, label }) => (
          <button
            key={page}
            className={`side-item${page === systemRoute.page ? " active" : ""}`}
            type="button"
            data-sidebar-dismiss
            aria-current={page === systemRoute.page ? "page" : undefined}
            onClick={() => setSystemRoute({ page })}
          >
            {label}
          </button>
        ))}
      </nav>
      {action ? (
        <div className="side-group">
          <div className="side-title">{t("systemManagement.maintenance")}</div>
          <button className="side-item" data-sidebar-dismiss type="button" onClick={() => setSystemActionIntent(action)}>
            {current?.actionLabel}
          </button>
        </div>
      ) : null}
    </>
  );
}
