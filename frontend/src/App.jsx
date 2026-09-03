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

import React, { useEffect, useMemo, useRef, useState } from "react";

import { getMenus, MENUS_CHANGED_EVENT } from "./api/menus.ts";
import { isDbAuthMode } from "./auth.ts";
import { AuthBar, AuthContext, LoginModal } from "./components/AuthControls.tsx";
import { AppShell } from "./components/app/AppShell.jsx";
import { ModuleContent } from "./components/app/ModuleContent.jsx";
import { ModuleSidebar } from "./components/app/ModuleSidebar.jsx";
import { ConfirmDialogHost, ModuleErrorBoundary, ToastHost } from "./components/common/index.ts";
import { Icon } from "./components/ui.tsx";
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
import { usePushModule } from "./hooks/usePushModule.ts";
import { useReportModule } from "./hooks/useReportModule.ts";
import { useRootModule } from "./hooks/useRootModule.ts";
import { useStatusOptions } from "./hooks/useStatusOptions.ts";
import { useTheme } from "./hooks/useTheme.ts";
import { useUpstreamModule } from "./hooks/useUpstreamModule.ts";
import { loadCapabilities } from "./capabilities/capabilities.ts";
import { loadNavigationMenus } from "./routing/navigationMenus.ts";
import { splitNavigationMenus } from "./routing/navigationMenuGrouping.ts";
import { useLocationSynchronization } from "./hooks/useLocationSynchronization.ts";
import { useNavigationController } from "./hooks/useNavigationController.ts";
import { scrollMainToTop } from "./utils/ui.ts";

export default function App() {
  const hamburgerRef = React.useRef(null);
  const sidebarRef = React.useRef(null);
  const searchToggleRef = React.useRef(null);
  const searchInputRef = React.useRef(null);
  const moreNavRef = useRef(null);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [moreNavOpen, setMoreNavOpen] = useState(false);
  const [lineageBootstrap, setLineageBootstrap] = useState(null);
  const [systemActionIntent, setSystemActionIntent] = useState("");
  const [navMenus, setNavMenus] = useState([]);
  const [navMenuStatus, setNavMenuStatus] = useState("loading");
  const navMenuRequestRef = useRef(0);

  const handlePopState = React.useCallback(() => {
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
  const { statusOptions } = useStatusOptions();
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
  // `/auth/me` is an identity probe. A 401 means anonymous, not that the
  // public catalog must be disabled; wait only for the probe to settle.
  const businessAccessReady = !isDbAuthMode() || authReady;
  const canManageUsers = can("system:user:write");
  const canManageMenus = can("system:menu:write");
  const canManageParams = can("system:param:write");

  const loadMenus = React.useCallback(async () => {
    const requestId = navMenuRequestRef.current + 1;
    navMenuRequestRef.current = requestId;
    setNavMenuStatus("loading");
    try {
      const menus = await loadNavigationMenus(getMenus);
      if (requestId !== navMenuRequestRef.current) return;
      setNavMenus(menus);
      setNavMenuStatus("ready");
    } catch (error) {
      if (requestId !== navMenuRequestRef.current) return;
      console.error("Failed to load navigation menus.", error);
      setNavMenus([]);
      setNavMenuStatus("error");
    }
  }, []);

  const refreshCapabilities = React.useCallback(async () => {
    try {
      // The capability contract load is observed for diagnostics only. Its
      // HTTP load state must never control module navigation or deep links.
      await loadCapabilities();
    } catch (error) {
      console.error("Failed to load the repository-module capability contract.", error);
    }
  }, []);

  useEffect(() => {
    if (!businessAccessReady) {
      navMenuRequestRef.current += 1;
      setNavMenus([]);
      setNavMenuStatus(authReady ? "ready" : "loading");
      return undefined;
    }
    loadMenus();
    window.addEventListener(MENUS_CHANGED_EVENT, loadMenus);
    return () => {
      navMenuRequestRef.current += 1;
      window.removeEventListener(MENUS_CHANGED_EVENT, loadMenus);
    };
  }, [authReady, businessAccessReady, loadMenus]);

  useEffect(() => {
    refreshCapabilities();
    return undefined;
  }, [refreshCapabilities]);

  useEffect(() => {
    if (!sidebarOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event) => {
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
    const closeOnEscape = (event) => {
      if (event.key !== "Escape") return;
      setMobileSearchOpen(false);
      requestAnimationFrame(() => searchToggleRef.current?.focus());
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [mobileSearchOpen]);

  useEffect(() => {
    if (!moreNavOpen) return undefined;
    const closeOnEscape = (event) => {
      if (event.key !== "Escape") return;
      setMoreNavOpen(false);
    };
    const closeOnOutsideClick = (event) => {
      if (!moreNavRef.current?.contains(event.target)) setMoreNavOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOnOutsideClick);
    };
  }, [moreNavOpen]);

  useEffect(() => {
    const desktopViewport = window.matchMedia("(min-width: 769px)");
    const closeMobilePanels = (event) => {
      if (!event.matches) return;
      setSidebarOpen(false);
      setMobileSearchOpen(false);
    };
    desktopViewport.addEventListener("change", closeMobilePanels);
    return () => desktopViewport.removeEventListener("change", closeMobilePanels);
  }, []);

  const visibleNavMenus = useMemo(() => {
    return navMenus
      .filter((item) => item.status !== "disabled")
      .filter((item) => !item.adminOnly || canManageSystem || (item.code === "system" && canViewOperationLog))
      .map((item) => item.code === "system" && canViewOperationLog && !canManageSystem
        ? { ...item, name: "操作日志", icon: "file", path: "/system-management/operation-logs" }
        : item)
      .slice()
      .sort((a, b) => (a.order - b.order) || String(a.id).localeCompare(String(b.id)));
  }, [canManageSystem, canViewOperationLog, navMenus]);

  const { primary: primaryNavMenus, more: moreNavMenus } = useMemo(
    () => splitNavigationMenus(visibleNavMenus),
    [visibleNavMenus],
  );
  const moreNavActive = moreNavMenus.some((item) => item.code === module);

  const visibleModuleKeys = useMemo(
    () => visibleNavMenus.map((item) => item.code),
    [visibleNavMenus],
  );

  const asset = useAssetModule({
    active: businessAccessReady && module === "dwm",
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
    active: businessAccessReady && module === "root",
    query,
    setQuery,
    rootRoute,
    setRootRoute,
    runProtectedMutation,
  });

  const indicator = useIndicatorModule({
    active: businessAccessReady && module === "indicator",
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
    active: businessAccessReady && module === "report",
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
    active: businessAccessReady && module === "apiAsset", query, route: apiAssetRoute, setRoute: setApiAssetRoute,
    filter: apiAssetFilter, canEdit: can("api_asset:write"), requireLogin, setAuthError, setLoginOpen,
  });

  const push = usePushModule({
    active: businessAccessReady && module === "push",
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
    active: businessAccessReady && module === "upstream",
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
    active: businessAccessReady && module === "codeTable",
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

  const systemLandingRoute = useMemo(() => {
    if (canViewUsers) return { page: "users" };
    if (canViewRoles) return { page: "roles" };
    if (canViewMenus) return { page: "menus" };
    if (canViewParams) return { page: "param-dicts" };
    if (canViewOperationLog) return { page: "operation-logs" };
    return DEFAULT_SYSTEM_ROUTE;
  }, [canViewMenus, canViewOperationLog, canViewParams, canViewRoles, canViewUsers]);

  useEffect(() => {
    if (!authReady || module !== "system") return;
    const accessible = {
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

  const switchModule = (nextModule) => {
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

  const goToMapping = (nextMappingRoute) => {
    navigateToMapping(nextMappingRoute);
    setSidebarOpen(false);
    scrollMainToTop();
  };

  const backToUpstreamList = () => {
    navigateBackToUpstreamList();
    setSidebarOpen(false);
    scrollMainToTop();
  };

  const goToModuleWithQuery = (target, nextQuery) => {
    const nextModule = target?.module || target;
    if (!nextModule) return;
    navigateToModuleWithQuery(target, nextQuery, { systemRoute: systemLandingRoute });
    setSidebarOpen(false);
    setSystemActionIntent("");
    scrollMainToTop();
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

  const moduleContent = (
    <ModuleContent
      module={module}
      context={{
        apiAsset, apiAssetRoute, apiAssetView, asset, auth, backToUpstreamList, businessAccessReady, can,
        canEdit, canManageMenus, canManageParams, canManageRoles, canManageSystem, canManageUsers,
        canViewMenus, canViewOperationLog, canViewParams,
        canViewRoles, canViewUsers, goToMapping, goToModuleWithQuery, indicator, indicatorFilter,
        indicatorRoute, indicatorView, lineageRoute, manualCodeTable, mappingRoute,
        push, pushRoute, query, report, reportRoute, reportView, requireLogin, root,
        rootRoute, route, setApiAssetView, setIndicatorFilter, setIndicatorRoute,
        setIndicatorView, setLineageBootstrap, setLineageRoute, setMappingRoute,
        setPushRoute, setQuery, setReportView, setRootRoute, setSystemActionIntent,
        setUpRoute, statusOptions, systemActionIntent, systemRoute, upRoute, upstream,
        visibleModuleKeys,
      }}
    />
  );
  const moduleSidebar = (
    <ModuleSidebar
      module={module}
      context={{
        apiAsset, apiAssetFilter, asset, can, canEdit, canManageMenus, canManageParams, canManageRoles,
        canManageSystem, canManageUsers, canViewMenus,
        canViewOperationLog, canViewParams, canViewRoles, canViewUsers, indicator,
        indicatorFilter, lineageBootstrap, manualCodeTable, push, pushRoute, report,
        reportFilter, requireLogin, root, setApiAssetFilter, setIndicatorFilter,
        setIndicatorRoute, setPushRoute, setReportFilter, setReportRoute, setRootRoute,
        setSystemActionIntent, setSystemRoute, setUpRoute, statusOptions, systemRoute,
        upstream,
      }}
    />
  );

  return (
    <AuthContext.Provider value={authContextValue}>
      <AppShell>
        <header className="topbar">
          {!isPortal ? (
            <button
              ref={hamburgerRef}
              className="hamburger"
              type="button"
              onClick={() => {
                setMobileSearchOpen(false);
                setSidebarOpen((prev) => !prev);
              }}
              aria-controls="mobile-sidebar"
              aria-expanded={sidebarOpen}
              aria-label={sidebarOpen ? "关闭导航" : "打开导航"}
            >
              <Icon name="menu" size={18} />
            </button>
          ) : null}

          <div className="brand" onClick={() => switchModule("portal")}>
            <div className="brand-mark">
              <img src="/brand-icon.svg?v=20260609" alt="数据资产门户" />
            </div>
            <div className="brand-name">数据资产门户<small>Data Asset Portal</small></div>
          </div>

          <div className="mainnav">
            {navMenuStatus === "loading" ? (
              <button type="button" disabled>菜单加载中…</button>
            ) : navMenuStatus === "error" ? (
              <button type="button" onClick={loadMenus}>菜单加载失败，点击重试</button>
            ) : null}
            {primaryNavMenus.map((item) => (
              <button
                key={item.code}
                className={module === item.code ? "active" : ""}
                onClick={() => switchModule(item.code)}
              >
                <Icon name={item.icon} size={15} />{item.name}
              </button>
            ))}
            {moreNavMenus.length ? (
              <div className="more-nav" ref={moreNavRef}>
                <button
                  className={`more-nav-trigger${moreNavActive ? " active" : ""}`}
                  type="button"
                  aria-expanded={moreNavOpen}
                  aria-controls="more-nav-menu"
                  onClick={() => setMoreNavOpen((prev) => !prev)}
                >
                  更多<Icon name="chevron" size={13} />
                </button>
                {moreNavOpen ? (
                  <div id="more-nav-menu" className="more-nav-menu" role="menu">
                    {moreNavMenus.map((item) => (
                      <button
                        key={item.code}
                        className={module === item.code ? "active" : ""}
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMoreNavOpen(false);
                          switchModule(item.code);
                        }}
                      >
                        <Icon name={item.icon} size={15} />{item.name}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="topbar-spacer"></div>
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
              <input
                ref={searchInputRef}
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
              <button className="clear" onClick={() => setQuery("")}><Icon name="close" size={13} /></button>
            </div>
          ) : null}

          <button
            className="theme-toggle"
            type="button"
            onClick={toggleTheme}
            aria-label={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"}
            title={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"}
          >
            <Icon name={theme === "dark" ? "sun" : "moon"} size={16} />
          </button>

          <AuthBar
            auth={auth}
            onLogin={() => {
              setAuthError("");
              setLoginOpen(true);
            }}
            onLogout={handleLogout}
          />
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
                  if (event.target.closest(".side-item")) setSidebarOpen(false);
                }}
              >
                <nav className="mobile-module-nav" aria-label="模块导航">
                  <div className="side-title">模块导航</div>
                  {navMenuStatus === "loading" ? (
                    <button className="mobile-module-link" type="button" disabled>菜单加载中…</button>
                  ) : navMenuStatus === "error" ? (
                    <button className="mobile-module-link" type="button" onClick={loadMenus}>
                      菜单加载失败，点击重试
                    </button>
                  ) : null}
                  {visibleNavMenus.map((item) => (
                    <button
                      key={item.code}
                      className={`mobile-module-link${module === item.code ? " active" : ""}`}
                      type="button"
                      onClick={() => switchModule(item.code)}
                    >
                      <Icon name={item.icon} size={16} />{item.name}
                    </button>
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
