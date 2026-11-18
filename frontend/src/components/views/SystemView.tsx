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

import type { SystemRoute } from "../../routing/types.ts";
import { useTranslation } from "react-i18next";
import { OperationLogPage } from "../OperationLog/OperationLogPage.tsx";
import { AiManagementPage, SiteBrandingPage, SystemManagementPage } from "../system/index.ts";

type RequireLogin = (action?: () => void, permission?: string) => boolean;

export interface SystemViewProps {
    systemRoute: SystemRoute;
    query: string;
    authenticated?: boolean | undefined;
    canManageMenus?: boolean | undefined;
    canManageParams?: boolean | undefined;
    canManageRoles?: boolean | undefined;
    canManageUsers?: boolean | undefined;
    canViewUsers?: boolean | undefined;
    canViewRoles?: boolean | undefined;
    canViewMenus?: boolean | undefined;
    canViewParams?: boolean | undefined;
    canViewOperationLog?: boolean | undefined;
    requireLogin: RequireLogin;
    systemActionIntent?: string | undefined;
    setSystemActionIntent: (intent: string) => void;
}

export function SystemView({
    systemRoute,
    query,
    authenticated = true,
    canManageMenus = false,
    canManageParams = false,
    canManageRoles = false,
    canManageUsers = false,
    canViewUsers = false,
    canViewRoles = false,
    canViewMenus = false,
    canViewParams = false,
    canViewOperationLog = false,
    requireLogin,
    systemActionIntent,
    setSystemActionIntent,
}: SystemViewProps) {
    const { t } = useTranslation("common");
    if (!authenticated) {
        return (
            <div className="state-card" role="status" aria-live="polite">
                <h4>{t("systemManagement.loginRequiredTitle")}</h4>
                <p>{t("systemManagement.loginRequiredDescription")}</p>
                <button
                    className="btn primary"
                    type="button"
                    onClick={() => requireLogin(() => undefined)}
                >
                    {t("systemManagement.login")}
                </button>
            </div>
        );
    }
    const canViewPage: Record<string, boolean> = {
        users: canViewUsers,
        roles: canViewRoles,
        menus: canViewMenus,
        "param-dicts": canViewParams,
        ai: canViewParams,
        branding: canViewParams,
        "operation-logs": canViewOperationLog,
    };
    if (canViewPage[systemRoute.page] !== true) {
        return (
            <div className="state-card state-card-error" role="alert">
                <h4>{t("systemManagement.noPageAccessTitle")}</h4>
                <p>{t("systemManagement.noPageAccessDescription")}</p>
            </div>
        );
    }
    if (systemRoute.page === "ai") return <AiManagementPage canEdit={canManageParams} />;
    if (systemRoute.page === "branding") return <SiteBrandingPage canEdit={canManageParams} />;
    if (systemRoute.page === "operation-logs") return <OperationLogPage query={query} />;

    const canEditCurrentPage =
        systemRoute.page === "roles"
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
            requireLogin={requireLogin}
            actionIntent={systemActionIntent}
            onActionHandled={() => setSystemActionIntent("")}
        />
    );
}
