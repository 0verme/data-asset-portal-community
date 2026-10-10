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

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { LineageBootstrap } from "./api/lineage.ts";
import { getMenus, MENUS_CHANGED_EVENT } from "./api/menus.ts";
import type { MenuItem } from "./data/menus.ts";
import { isDbAuthMode } from "./auth.ts";
import { AuthBar, AuthContext, LoginModal } from "./components/AuthControls.tsx";
import { AppShell } from "./components/app/AppShell.tsx";
import { ModuleContent } from "./components/app/ModuleContent.tsx";
import { ModuleSidebar } from "./components/app/ModuleSidebar.tsx";
import type { AppModuleContext } from "./components/app/appTypes.ts";
import { ConfirmDialogHost, ModuleErrorBoundary, ToastHost } from "./components/common/index.ts";
import { Icon } from "./components/ui.tsx";
import { Button, DropdownMenu, IconButton, Input } from "./ui/index.ts";
import {
  APP_VERSION,
  DEFAULT_ASSET_ROUTE,
  DEFAULT_API_ASSET_ROUTE,
  DEFAULT_INDICATOR_ROUTE,
  DEFAULT_REPORT_ROUTE,
  DEFAULT_ROOT_ROUTE,
  DEFAULT_SYSTEM_ROUTE,
  DEFAULT_UP_ROUTE,
} from "./config/defaults.ts";
import { useAssetModule } from "./hooks/useAssetModule.ts";
import { useApiAssetModule } from "./hooks/useApiAssetModule.ts";
import { useAuthSession } from "./hooks/useAuthSession.ts";
import { useIndicatorModule } from "./hooks/useIndicatorModule.ts";
import { useManualCodeTableModule } from "./hooks/useManualCodeTableModule.ts";
import { usePublicCatalogConfig } from "./hooks/usePublicCatalogConfig.ts";
import { usePushModule } from "./hooks/usePushModule.ts";
import { useReportModule } from "./hooks/useReportModule.ts";
import { useRootModule } from "./hooks/useRootModule.ts";
import { useStatusOptions } from "./hooks/useStatusOptions.ts";
import { useTheme } from "./hooks/useTheme.ts";
import { useUpstreamModule } from "./hooks/useUpstreamModule.ts";
import { loadCapabilities } from "./capabilities/capabilities.ts";
import {
  getNavigationAuthKey,
  getNavigationMenusForAuth,
  getVisibleNavigationMenus,
  loadNavigationMenus,
} from "./routing/navigationMenus.ts";
import { getNavigationPrimaryLimit, splitNavigationMenus, type NavigationMenuFitMetrics } from "./routing/navigationMenuGrouping.ts";
import { useLocationSynchronization } from "./hooks/useLocationSynchronization.ts";
import {
  useNavigationController,
  type NavigationActions,
} from "./hooks/useNavigationController.ts";
import { scrollMainToTop } from "./utils/ui.ts";
import type { MappingRoute, ModuleId, SystemRoute } from "./routing/types.ts";
import type { DictOption } from "./utils/optionUtils.ts";

const MODULE_CODES = new Set<string>([
  "portal",
  "dwm",
  "upstream",
  "mapping",
  "lineage",
  "root",
  "indicator",
  "report",
  "apiAsset",
  "push",
  "codeTable",
  "system",
]);

function isModuleId(value: string): value is ModuleId {
  return MODULE_CODES.has(value);
}

type NavigationTarget = Parameters<NavigationActions["goToModuleWithQuery"]>[0];

type NavigationMenuStatus = "loading" | "ready" | "error";

type NavigationFitSnapshot = NavigationMenuFitMetrics & { menuKey: string };

export default function App(): React.ReactElement {
  const hamburgerRef = React.useRef<HTMLButtonElement | null>(null);
  const sidebarRef = React.useRef<HTMLElement | null>(null);
  const searchToggleRef = React.useRef<HTMLButtonElement | null>(null);
  const searchInputRef = React.useRef<HTMLInputElement | null>(null);
  const navSlotRef = useRef<HTMLDivElement | null>(null);
  const navMeasureRef = useRef<HTMLElement | null>(null);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [moreNavOpen, setMoreNavOpen] = useState(false);
  const [navigationFitSnapshot, setNavigationFitSnapshot] = useState<NavigationFitSnapshot | null>(null);
  const [lineageBootstrap, setLineageBootstrap] = useState<LineageBootstrap | null>(null);
  const [systemActionIntent, setSystemActionIntent] = useState("");
  const [navMenuSnapshot, setNavMenuSnapshot] = useState<{ authKey: string; menus: MenuItem[] }>({
    authKey: "",
    menus: [],
  });
  const [navMenuStatus, setNavMenuStatus] = useState<NavigationMenuStatus>("loading");
  const navMenuRequestRef = useRef(0);

  const handlePopState = React.useCallback((): void => {
    setSidebarOpen(false);
    setSystemActionIntent("");
  }, []);
  const navigation = useNavigationController({ onPopState: handlePopState });
  const {
    module,
    query,
    setQuery,
    route,
    setRoute,
    pushRoute,
    setPushRoute,
    indicatorRoute,
    setIndicatorRoute,
    reportRoute,
    setReportRoute,
    apiAssetRoute,
    setApiAssetRoute,
    rootRoute,
    setRootRoute,
    upRoute,
    setUpRoute,
    mappingRoute,
    setMappingRoute,
    lineageRoute,
    setLineageRoute,
    systemRoute,
    setSystemRoute,
    assetLayoutFromUrl,
    assetDomainFromUrl,
    assetLayerFromUrl,
    assetDetailTabFromUrl,
    pushViewFromUrl,
    pushFilterFromUrl,
    upFilterFromUrl,
    upstreamViewFromUrl,
    indicatorFilter,
    setIndicatorFilter,
    indicatorView,
    setIndicatorView,
    reportFilter,
    setReportFilter,
    reportView,
    setReportView,
    apiAssetFilter,
    setApiAssetFilter,
    apiAssetView,
    setApiAssetView,
  } = navigation;

  const { theme, toggleTheme } = useTheme();
  const themeToggleLabel = theme === "dark" ? "切换到浅色主题" : "切换到深色主题";
  const { statusOptions: rawStatusOptions } = useStatusOptions();
  const statusOptions = useMemo<DictOption[]>(
    () => rawStatusOptions.map((item) => ({ code: item.value, ...item })),
    [rawStatusOptions],
  );
  const {
    auth,
    authReady,
    can,
    canEdit,
    canManageRoles,
    canManageSystem,
    canViewMenus,
    canViewOperationLog,
    canViewParams,
    canViewRoles,
    canViewUsers,
    loginOpen,
    setLoginOpen,
    authBusy,
    authError,
    setAuthError,
    requireLogin,
    runProtectedMutation,
    handleLoginSubmit,
    handleLogout,
  } = useAuthSession();
  // `/auth/me` is an identity probe; wait for both identity and public policy
  // before issuing business-data requests.
  const { config: publicCatalogConfig, ready: publicCatalogConfigReady } = usePublicCatalogConfig();
  const businessAccessReady = (!isDbAuthMode() || authReady) && publicCatalogConfigReady;
  const catalogAccessDisabled = publicCatalogConfig.profile === "disabled" && !auth.user;
  const catalogDataAccessReady = businessAccessReady && !catalogAccessDisabled;
  const navigationAuthKey = getNavigationAuthKey(auth);
  const navMenus = getNavigationMenusForAuth(navMenuSnapshot, navigationAuthKey);
  const currentNavMenuStatus = navMenuSnapshot.authKey === navigationAuthKey ? navMenuStatus : "loading";
  const canManageUsers = can("system:user:write");
  const canManageMenus = can("system:menu:write");
  const canManageParams = can("system:param:write");

  const loadMenus = React.useCallback(async (authKey: string): Promise<void> => {
    const requestId = navMenuRequestRef.current + 1;
    navMenuRequestRef.current = requestId;
    setNavMenuSnapshot({ authKey, menus: [] });
    setNavMenuStatus("loading");
    try {
      const menus = await loadNavigationMenus(getMenus);
      if (requestId !== navMenuRequestRef.current) return;
      setNavMenuSnapshot({ authKey, menus });
      setNavMenuStatus("ready");
    } catch (error) {
      if (requestId !== navMenuRequestRef.current) return;
      console.error("Failed to load navigation menus.", error);
      setNavMenuSnapshot({ authKey, menus: [] });
      setNavMenuStatus("error");
    }
  }, []);

  const refreshCapabilities = React.useCallback(async (): Promise<void> => {
    try {
      // The capability contract load is observed for diagnostics only. Its
      // HTTP load state must never control module navigation or deep links.
      await loadCapabilities();
    } catch (error) {
      console.error("Failed to load the repository-module capability contract.", error);
    }
  }, []);

  useEffect(() => {
    if (!catalogDataAccessReady) {
      navMenuRequestRef.current += 1;
      setNavMenuSnapshot({ authKey: navigationAuthKey, menus: [] });
      setNavMenuStatus(authReady ? "ready" : "loading");
      return undefined;
    }
    const refreshMenus = (): void => {
      void loadMenus(navigationAuthKey);
    };
    refreshMenus();
    window.addEventListener(MENUS_CHANGED_EVENT, refreshMenus);
    return () => {
      navMenuRequestRef.current += 1;
      window.removeEventListener(MENUS_CHANGED_EVENT, refreshMenus);
    };
  }, [authReady, catalogDataAccessReady, loadMenus, navigationAuthKey]);

  useEffect(() => {
    refreshCapabilities();
    return undefined;
  }, [refreshCapabilities]);

  useEffect(() => {
    if (!sidebarOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      setSidebarOpen(false);
      requestAnimationFrame(() => hamburgerRef.current?.focus());
    };
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => sidebarRef.current?.focus());
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [sidebarOpen]);

  useEffect(() => {
    if (!mobileSearchOpen) return undefined;
    requestAnimationFrame(() => searchInputRef.current?.focus());
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      setMobileSearchOpen(false);
      requestAnimationFrame(() => searchToggleRef.current?.focus());
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [mobileSearchOpen]);

  useEffect(() => {
    const desktopSidebarViewport = window.matchMedia("(min-width: 960px)");
    const desktopSearchViewport = window.matchMedia("(min-width: 769px)");
    const closeSidebarOnDesktop = (event: MediaQueryListEvent): void => {
      if (event.matches) setSidebarOpen(false);
    };
    const closeSearchOnDesktop = (event: MediaQueryListEvent): void => {
      if (event.matches) setMobileSearchOpen(false);
    };
    desktopSidebarViewport.addEventListener("change", closeSidebarOnDesktop);
    desktopSearchViewport.addEventListener("change", closeSearchOnDesktop);
    return () => {
      desktopSidebarViewport.removeEventListener("change", closeSidebarOnDesktop);
      desktopSearchViewport.removeEventListener("change", closeSearchOnDesktop);
    };
  }, []);

  const visibleNavMenus = useMemo(
    () => getVisibleNavigationMenus(navMenus, { canManageSystem, canViewOperationLog }),
    [canManageSystem, canViewOperationLog, navMenus],
  );
  const navigationPrimaryMenus = visibleNavMenus.filter((item) => item.navPlacement === "primary");
  const navigationPrimaryMenuCount = navigationPrimaryMenus.length;
  const navigationMenuKey = JSON.stringify(navigationPrimaryMenus.map(({ code, name, icon }) => [code, name, icon]));

  useLayoutEffect(() => {
    const measureNavigation = (): void => {
      const slot = navSlotRef.current;
      const measure = navMeasureRef.current;
      if (!slot || !measure || getComputedStyle(measure).display === "none") return;
      const availableWidth = slot.getBoundingClientRect().width;
      if (availableWidth <= 0) return;

      const measuredMenuButtons = [...measure.querySelectorAll<HTMLElement>("[data-nav-measure-item]")];
      const measuredMoreTrigger = measure.querySelector<HTMLElement>("[data-nav-measure-more]");
      if (measuredMenuButtons.length !== navigationPrimaryMenuCount || !measuredMoreTrigger) return;

      const style = getComputedStyle(measure);
      const cssPixels = (value: string): number => Number.parseFloat(value) || 0;
      const next: NavigationFitSnapshot = {
        menuKey: navigationMenuKey,
        availableWidth,
        menuWidths: measuredMenuButtons.map((button) => button.getBoundingClientRect().width),
        moreTriggerWidth: measuredMoreTrigger.getBoundingClientRect().width,
        chromeWidth: cssPixels(style.paddingLeft) + cssPixels(style.paddingRight)
          + cssPixels(style.borderLeftWidth) + cssPixels(style.borderRightWidth),
        gap: cssPixels(style.columnGap),
      };

      setNavigationFitSnapshot((current) => {
        const sameWidths = current?.menuWidths.length === next.menuWidths.length
          && current.menuWidths.every((width, index) => {
            const nextWidth = next.menuWidths[index];
            return nextWidth !== undefined && Math.abs(width - nextWidth) < 0.5;
          });
        if (
          current?.menuKey === next.menuKey
          && Math.abs(current.availableWidth - next.availableWidth) < 0.5
          && sameWidths
          && Math.abs(current.moreTriggerWidth - next.moreTriggerWidth) < 0.5
          && Math.abs(current.chromeWidth - next.chromeWidth) < 0.5
          && Math.abs(current.gap - next.gap) < 0.5
        ) {
          return current;
        }
        return next;
      });
    };

    measureNavigation();
    const observer = new ResizeObserver(measureNavigation);
    if (navSlotRef.current) observer.observe(navSlotRef.current);
    if (navMeasureRef.current) observer.observe(navMeasureRef.current);
    window.addEventListener("resize", measureNavigation);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measureNavigation);
    };
  }, [module, navigationMenuKey, navigationPrimaryMenuCount]);

  const navigationFitMetrics = navigationFitSnapshot?.menuKey === navigationMenuKey
    ? navigationFitSnapshot
    : null;
  const maxPrimaryMenus = navigationFitMetrics
    ? getNavigationPrimaryLimit(visibleNavMenus, navigationFitMetrics)
    : navigationPrimaryMenus.length;
  const { primary: primaryNavMenus, more: moreNavMenus } = useMemo(
    () => splitNavigationMenus(visibleNavMenus, { maxPrimary: maxPrimaryMenus }),
    [maxPrimaryMenus, visibleNavMenus],
  );
  const moreNavActive = moreNavMenus.some((item) => item.code === module);

  const visibleModuleKeys = useMemo(
    () => visibleNavMenus.map((item) => item.code),
    [visibleNavMenus],
  );

  const asset = useAssetModule({
    active: catalogDataAccessReady && module === "dwm",
    query,
    setQuery,
    route,
    setRoute,
    initialLayout: assetLayoutFromUrl,
    initialDomain: assetDomainFromUrl,
    initialSelectedLayer: assetLayerFromUrl,
    initialDetailTab: assetDetailTabFromUrl,
    requireLogin,
    runProtectedMutation,
  });

  const root = useRootModule({
    active: catalogDataAccessReady && module === "root",
    query,
    setQuery,
    rootRoute,
    setRootRoute,
    runProtectedMutation,
  });

  const indicator = useIndicatorModule({
    active: catalogDataAccessReady && module === "indicator",
    query,
    indicatorRoute,
    setIndicatorRoute,
    indicatorFilter,
    canEdit: can("indicator:write"),
    requireLogin,
    setAuthError,
    setLoginOpen,
  });

  const report = useReportModule({
    active: catalogDataAccessReady && module === "report",
    query,
    reportRoute,
    setReportRoute,
    reportFilter,
    canEdit: can("report:write"),
    requireLogin,
    setAuthError,
    setLoginOpen,
  });
  const apiAsset = useApiAssetModule({
    active: catalogDataAccessReady && module === "apiAsset", query, route: apiAssetRoute, setRoute: setApiAssetRoute,
    filter: apiAssetFilter, canEdit: can("api_asset:write"), requireLogin, setAuthError, setLoginOpen,
  });

  const push = usePushModule({
    active: catalogDataAccessReady && module === "push",
    query,
    setQuery,
    pushRoute,
    setPushRoute,
    initialView: pushViewFromUrl,
    initialFilter: pushFilterFromUrl,
    canEdit: can("push:write"),
    requireLogin,
    runProtectedMutation,
  });

  const upstream = useUpstreamModule({
    active: catalogDataAccessReady && module === "upstream",
    query,
    setQuery,
    upRoute,
    setUpRoute,
    initialView: upstreamViewFromUrl,
    initialFilter: upFilterFromUrl,
    canEdit: can("upstream:write"),
    requireLogin,
    runProtectedMutation,
    setAuthError,
    setLoginOpen,
  });

  const manualCodeTable = useManualCodeTableModule({
    active: catalogDataAccessReady && module === "codeTable",
    query,
    requireLogin,
  });

  const { assetBack, resetAssetNavigation } = asset;
  const { rootBack } = root;
  const { indicatorBack } = indicator;
  const { reportBack } = report;
  const { pushGoList, resetPushNavigation } = push;
  const { upBack, resetUpstreamNavigation } = upstream;
  const { resetRootNavigation } = root;

  useLocationSynchronization({ navigation, asset, push, upstream });

  const canEditAsset = can("asset:write");
  const canEditPush = can("push:write");
  const canEditRoot = can("root:write");
  const canEditUpstream = can("upstream:write");
  const canEditIndicator = can("indicator:write");
  const canEditReport = can("report:write");
  const canEditApiAsset = can("api_asset:write");

  useEffect(() => {
    if (!authReady) return;
    if (!canEditAsset) {
      setRoute((current) => (
        current.page === "edit" || current.page === "new" ? DEFAULT_ASSET_ROUTE : current
      ));
    }
    if (!canEditPush) {
      setPushRoute((current) => (
        ["sysNew", "sysEdit", "jobNew", "jobEdit"].includes(current.page)
          ? { page: current.sys ? "jobs" : "systems", sys: current.sys, job: null }
          : current
      ));
    }
    if (!canEditRoot) {
      setRootRoute((current) => (
        ["new", "edit", "import"].includes(current.page) ? DEFAULT_ROOT_ROUTE : current
      ));
    }
    if (!canEditUpstream) {
      setUpRoute((current) => (
        ["new", "edit"].includes(current.page)
          ? (current.id ? { page: "detail", id: current.id } : DEFAULT_UP_ROUTE)
          : current
      ));
    }
    if (!canEditIndicator) {
      setIndicatorRoute((current) => (
        ["new", "edit"].includes(current.page) ? DEFAULT_INDICATOR_ROUTE : current
      ));
    }
    if (!canEditReport) {
      setReportRoute((current) => (
        ["new", "edit"].includes(current.page) ? DEFAULT_REPORT_ROUTE : current
      ));
    }
    if (!canEditApiAsset) {
      setApiAssetRoute((current) => (["new", "edit"].includes(current.page) ? DEFAULT_API_ASSET_ROUTE : current));
    }
  }, [
    authReady,
    canEditApiAsset,
    canEditAsset,
    canEditIndicator,
    canEditPush,
    canEditReport,
    canEditRoot,
    canEditUpstream,
    setApiAssetRoute,
    setIndicatorRoute,
    setPushRoute,
    setReportRoute,
    setRootRoute,
    setRoute,
    setUpRoute,
  ]);

  const systemLandingRoute = useMemo<SystemRoute>(() => {
    if (canViewUsers) return { page: "users" };
    if (canViewRoles) return { page: "roles" };
    if (canViewMenus) return { page: "menus" };
    if (canViewParams) return { page: "param-dicts" };
    if (canViewOperationLog) return { page: "operation-logs" };
    return DEFAULT_SYSTEM_ROUTE;
  }, [canViewMenus, canViewOperationLog, canViewParams, canViewRoles, canViewUsers]);

  useEffect(() => {
    if (!authReady || module !== "system") return;
    const accessible: Record<string, boolean> = {
      users: canViewUsers,
      roles: canViewRoles,
      menus: canViewMenus,
      "param-dicts": canViewParams,
      "operation-logs": canViewOperationLog,
    };
    if (!accessible[systemRoute.page]) setSystemRoute(systemLandingRoute);
  }, [
    authReady,
    canViewMenus,
    canViewOperationLog,
    canViewParams,
    canViewRoles,
    canViewUsers,
    module,
    setSystemRoute,
    systemLandingRoute,
    systemRoute.page,
  ]);

  const {
    switchModule: switchNavigationModule,
    goToMapping: navigateToMapping,
    backToUpstreamList: navigateBackToUpstreamList,
    goToModuleWithQuery: navigateToModuleWithQuery,
  } = navigation.actions;

  const switchModule = (nextModule: ModuleId): void => {
    setSidebarOpen(false);
    setMobileSearchOpen(false);
    resetAssetNavigation();
    resetPushNavigation();
    resetRootNavigation();
    resetUpstreamNavigation();
    switchNavigationModule(nextModule, { systemRoute: systemLandingRoute });
    setSystemActionIntent("");
    scrollMainToTop();
  };

  const goToMapping = (nextMappingRoute?: Partial<MappingRoute>): void => {
    navigateToMapping(nextMappingRoute);
    setSidebarOpen(false);
    scrollMainToTop();
  };

  const backToUpstreamList = (): void => {
    navigateBackToUpstreamList();
    setSidebarOpen(false);
    scrollMainToTop();
  };

  const goToModuleWithQuery = (target: NavigationTarget, nextQuery?: string): void => {
    const nextModule = typeof target === "string" ? target : target.module;
    if (!nextModule) return;
    navigateToModuleWithQuery(target, nextQuery, { systemRoute: systemLandingRoute });
    setSidebarOpen(false);
    setSystemActionIntent("");
    scrollMainToTop();
  };

  const switchModuleFromMenu = (code: string): void => {
    if (isModuleId(code)) switchModule(code);
  };

  const isPush = module === "push";
  const isIndicator = module === "indicator";
  const isReport = module === "report";
  const isRoot = module === "root";
  const isSystem = module === "system";
  const isUpstream = module === "upstream";
  const isMapping = module === "mapping";
  const isCodeTable = module === "codeTable";
  const isPortal = module === "portal";

  useEffect(() => {
    const hiddenNavigation = window.matchMedia(isPortal ? "(max-width: 768px)" : "(max-width: 959px)");
    const closeWhenHidden = (): void => {
      if (hiddenNavigation.matches) setMoreNavOpen(false);
    };
    closeWhenHidden();
    hiddenNavigation.addEventListener("change", closeWhenHidden);
    return () => hiddenNavigation.removeEventListener("change", closeWhenHidden);
  }, [isPortal]);

  const searchPlaceholder = isPush
    ? "搜索系统、作业、文件名或说明"
    : isCodeTable
      ? "搜索表编码、表名称、负责人或说明"
      : isReport
      ? "搜索报表编码、名称、负责人、归属部门或用途"
      : isIndicator
        ? "搜索指标 ID、中文名、含义或字段/口径关键字"
        : isRoot
          ? "搜索词根、中文、英文或说明"
          : isSystem
            ? systemRoute.page === "menus"
              ? "搜索菜单名称、编码、路径或说明"
              : systemRoute.page === "param-dicts"
                ? "搜索参数分类、编码、名称、取值或说明"
                : systemRoute.page === "roles"
                ? "搜索角色编码、名称或说明"
                : systemRoute.page === "operation-logs"
                  ? "搜索操作用户、模块、对象或操作内容"
                  : "搜索用户名、显示名、邮箱或状态"
            : isUpstream
              ? "搜索系统简称、名称、负责人、部门或说明"
              : isMapping
                ? "搜索源系统、源表、字段或目标字段"
                : "搜索表名、中文名、负责人或字段";

  const sidebarResetKey = `${module}:${root.rootCategory || ""}:${systemRoute.page}:${manualCodeTable.styleFilter}`;
  const mainResetKey = [
    module,
    route.page,
    pushRoute.page,
    indicatorRoute.page,
    reportRoute.page,
    reportRoute.code || "",
    apiAssetRoute.page,
    apiAssetRoute.code || "",
    rootRoute.page,
    rootRoute.abbr || "",
    upRoute.page,
    upRoute.id || "",
    systemRoute.page,
  ].join(":");

  const authContextValue = useMemo(() => ({
    auth,
    can,
    canEdit,
    requireLogin,
    logout: handleLogout,
  }), [auth, can, canEdit, requireLogin, handleLogout]);

  const moduleContext: AppModuleContext = {
    apiAsset,
    apiAssetFilter,
    apiAssetRoute,
    apiAssetView,
    asset,
    auth,
    backToUpstreamList,
    businessAccessReady,
    catalogAccessDisabled,
    catalogExportEnabled: publicCatalogConfig.exportEnabled,
    can,
    canEdit,
    canManageMenus,
    canManageParams,
    canManageRoles,
    canManageSystem,
    canManageUsers,
    canViewMenus,
    canViewOperationLog,
    canViewParams,
    canViewRoles,
    canViewUsers,
    goToMapping,
    goToModuleWithQuery,
    indicator,
    indicatorFilter,
    indicatorRoute,
    indicatorView,
    lineageBootstrap,
    lineageRoute,
    manualCodeTable,
    mappingRoute,
    push,
    pushRoute,
    query,
    report,
    reportFilter,
    reportRoute,
    reportView,
    requireLogin,
    root,
    rootRoute,
    route,
    setApiAssetFilter,
    setApiAssetRoute,
    setApiAssetView,
    setAuthError,
    setIndicatorFilter,
    setIndicatorRoute,
    setIndicatorView,
    setLineageBootstrap,
    setLineageRoute,
    setMappingRoute,
    setPushRoute,
    setQuery,
    setReportFilter,
    setReportRoute,
    setReportView,
    setRootRoute,
    setSystemActionIntent,
    setSystemRoute,
    setUpRoute,
    statusOptions,
    systemActionIntent,
    systemRoute,
    upRoute,
    upstream,
    visibleModuleKeys,
  };
  const moduleContent = <ModuleContent module={module} context={moduleContext} />;
  const moduleSidebar = <ModuleSidebar module={module} context={moduleContext} />;

  return (
    <AuthContext.Provider value={authContextValue}>
      <AppShell>
        <header className={`topbar${isPortal ? " portal-topbar" : ""}`}>
          <div className="topbar-brand">
            {!isPortal ? (
              <IconButton
                ref={hamburgerRef}
                className="hamburger"
                type="button"
                variant="tertiary"
                size="sm"
                onClick={() => {
                  setMobileSearchOpen(false);
                  setSidebarOpen((prev) => !prev);
                }}
                aria-controls="mobile-sidebar"
                aria-expanded={sidebarOpen}
                aria-label={sidebarOpen ? "关闭导航" : "打开导航"}
                icon={<Icon name="menu" size={18} />}
              />
            ) : null}

            <div className="brand" onClick={() => switchModule("portal")}>
              <div className="brand-mark">
                <img src="/brand-icon.svg?v=20260609" alt="数据资产门户" />
              </div>
              <div className="brand-name">数据资产门户<small>Data Asset Portal</small></div>
            </div>
          </div>

          <div className="topbar-nav-slot" ref={navSlotRef}>
            <nav className="mainnav" aria-label="主导航">
              {currentNavMenuStatus === "loading" ? (
                <Button type="button" variant="tertiary" size="sm" disabled>菜单加载中…</Button>
              ) : currentNavMenuStatus === "error" ? (
                <Button
                  type="button"
                  variant="tertiary"
                  size="sm"
                  onClick={() => void loadMenus(navigationAuthKey)}
                >
                  菜单加载失败，点击重试
                </Button>
              ) : null}
              {primaryNavMenus.map((item) => (
                <Button
                  key={item.code}
                  type="button"
                  variant="tertiary"
                  size="sm"
                  className={module === item.code ? "active" : ""}
                  onClick={() => switchModuleFromMenu(item.code)}
                >
                  <Icon name={item.icon} size={15} />{item.name}
                </Button>
              ))}
              {moreNavMenus.length ? (
                <div className="more-nav">
                  <DropdownMenu open={moreNavOpen} onOpenChange={(open) => setMoreNavOpen(open)}>
                    <DropdownMenu.Trigger
                      render={(
                        <Button
                          variant="tertiary"
                          size="sm"
                          className={`more-nav-trigger${moreNavActive ? " active" : ""}${moreNavOpen ? " open" : ""}`}
                          type="button"
                          aria-expanded={moreNavOpen}
                          aria-controls="more-nav-menu"
                        />
                      )}
                    >
                      更多<Icon name="chevron" size={13} />
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Content id="more-nav-menu" className="more-nav-menu" align="end" side="bottom">
                      {moreNavMenus.map((item) => (
                        <DropdownMenu.Item
                          key={item.code}
                          className="more-nav-menu-item"
                          icon={<Icon name={item.icon} size={15} />}
                          selected={module === item.code}
                          aria-current={module === item.code ? "page" : undefined}
                          onClick={() => {
                            setMoreNavOpen(false);
                            switchModuleFromMenu(item.code);
                          }}
                        >
                          {item.name}
                        </DropdownMenu.Item>
                      ))}
                    </DropdownMenu.Content>
                  </DropdownMenu>
                </div>
              ) : null}
            </nav>

            <nav ref={navMeasureRef} className="mainnav mainnav-measure" aria-hidden="true" inert>
              {navigationPrimaryMenus.map((item) => (
                <Button
                  key={item.code}
                  type="button"
                  variant="tertiary"
                  size="sm"
                  className={module === item.code ? "active" : ""}
                  data-nav-measure-item={item.code}
                >
                  <Icon name={item.icon} size={15} />{item.name}
                </Button>
              ))}
              <div className="more-nav">
                <Button
                  type="button"
                  variant="tertiary"
                  size="sm"
                  className="more-nav-trigger active"
                  data-nav-measure-more=""
                >
                  更多<Icon name="chevron" size={13} />
                </Button>
              </div>
            </nav>
          </div>

          <div className="topbar-actions">
            {!isPortal ? (
              <button
                ref={searchToggleRef}
                className="mobile-search-toggle"
                type="button"
                onClick={() => {
                  setSidebarOpen(false);
                  setMobileSearchOpen((prev) => !prev);
                }}
                aria-controls="global-search"
                aria-expanded={mobileSearchOpen}
                aria-label={mobileSearchOpen ? "关闭搜索" : "打开搜索"}
              >
                <Icon name={mobileSearchOpen ? "close" : "search"} size={17} />
              </button>
            ) : null}
            {!isPortal ? (
              <div id="global-search" className={`search${query ? " has-val" : ""}${mobileSearchOpen ? " mobile-open" : ""}`}>
                <span className="ico-search"><Icon name="search" size={16} /></span>
                <Input
                  ref={searchInputRef}
                  aria-label="全局搜索"
                  className="search-input"
                  placeholder={searchPlaceholder}
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    if (!isPush && !isIndicator && !isReport && !isRoot && !isUpstream && !isMapping && route.page !== "home") assetBack();
                    if (isIndicator && indicatorRoute.page !== "list") indicatorBack();
                    if (isReport && reportRoute.page !== "list") reportBack();
                    if (isPush && pushRoute.page !== "systems") pushGoList();
                    if (isRoot && rootRoute.page !== "library") rootBack();
                    if (isUpstream && upRoute.page !== "list") upBack();
                  }}
                />
                <Button
                  type="button"
                  variant="tertiary"
                  size="sm"
                  className="clear"
                  aria-label="清除全局搜索"
                  onClick={() => setQuery("")}
                >
                  <Icon name="close" size={13} />
                </Button>
              </div>
            ) : null}

            <span className="theme-toggle-wrapper" title={themeToggleLabel}>
              <IconButton
                type="button"
                variant="secondary"
                size="sm"
                className="theme-toggle"
                onClick={toggleTheme}
                aria-label={themeToggleLabel}
                icon={<Icon name={theme === "dark" ? "sun" : "moon"} size={16} />}
              />
            </span>

            <AuthBar
              auth={auth}
              onLogin={() => {
                setAuthError("");
                setLoginOpen(true);
              }}
              onLogout={handleLogout}
            />
          </div>
        </header>

        <div className="body">
          {!isPortal ? (
            <>
              <div
                className={`sidebar-overlay${sidebarOpen ? " open" : ""}`}
                onClick={() => {
                  setSidebarOpen(false);
                  requestAnimationFrame(() => hamburgerRef.current?.focus());
                }}
                role="presentation"
              />
              <aside
                ref={sidebarRef}
                id="mobile-sidebar"
                className={`sidebar${sidebarOpen ? " open" : ""}`}
                aria-label="模块导航与筛选"
                tabIndex={-1}
                onClick={(event) => {
                  if (event.target instanceof Element && event.target.closest(".side-item")) {
                    setSidebarOpen(false);
                  }
                }}
              >
                <nav className="mobile-module-nav" aria-label="模块导航">
                  <div className="side-title">模块导航</div>
                  {currentNavMenuStatus === "loading" ? (
                    <Button className="mobile-module-link" type="button" variant="tertiary" size="sm" disabled>菜单加载中…</Button>
                  ) : currentNavMenuStatus === "error" ? (
                    <Button className="mobile-module-link" type="button" variant="tertiary" size="sm" onClick={() => void loadMenus(navigationAuthKey)}>
                      菜单加载失败，点击重试
                    </Button>
                  ) : null}
                  {visibleNavMenus.map((item) => (
                    <Button
                      key={item.code}
                      className={`mobile-module-link${module === item.code ? " active" : ""}`}
                      type="button"
                      variant="tertiary"
                      size="sm"
                      onClick={() => switchModuleFromMenu(item.code)}
                    >
                      <Icon name={item.icon} size={16} />{item.name}
                    </Button>
                  ))}
                </nav>
                <ModuleErrorBoundary
                  resetKey={sidebarResetKey}
                  title="侧边栏渲染失败"
                  desc="导航区域渲染异常，请刷新后重试。"
                  onRetry={() => window.location.reload()}
                >
                  {moduleSidebar}
                </ModuleErrorBoundary>
              </aside>
            </>
          ) : null}

          <main className="main">
            <div className="main-inner">
              <ModuleErrorBoundary
                resetKey={mainResetKey}
                title="模块渲染失败"
                desc="当前模块渲染异常，请稍后重试。"
                onRetry={() => window.location.reload()}
              >
                {moduleContent}
              </ModuleErrorBoundary>
            </div>
          </main>
        </div>

        <footer className="app-footer-shell">
          <div className="app-footer">
            <span className="app-footer-copy">数据资产管理与血缘分析平台 {APP_VERSION}</span>
            <span className="app-footer-separator" aria-hidden="true">·</span>
            <a
              className="app-footer-link"
              href="https://github.com/0verme/data-asset-portal-community"
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub ↗
            </a>
          </div>
        </footer>

        <LoginModal
          open={loginOpen}
          busy={authBusy}
          error={authError}
          onClose={() => {
            if (authBusy) return;
            setLoginOpen(false);
            setAuthError("");
          }}
          onSubmit={handleLoginSubmit}
        />

        <ConfirmDialogHost />
        <ToastHost />
      </AppShell>
    </AuthContext.Provider>
  );
}
