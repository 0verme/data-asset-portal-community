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
import { useTranslation } from "react-i18next";

import type { LineageBootstrap, LineageNode } from "./api/lineage.ts";
import { getMenus, MENUS_CHANGED_EVENT } from "./api/menus.ts";
import type { MenuItem } from "./data/menus.ts";
import { isDbAuthMode } from "./auth.ts";
import { AuthBar, AuthContext, LoginModal } from "./components/AuthControls.tsx";
import { BrandLogo } from "./components/BrandLogo.tsx";
import { AppShell } from "./components/app/AppShell.tsx";
import { ModuleContent } from "./components/app/ModuleContent.tsx";
import { ModuleSidebar } from "./components/app/ModuleSidebar.tsx";
import type { AppModuleContext } from "./components/app/appTypes.ts";
import { ConfirmDialogHost, ModuleErrorBoundary } from "./components/common/index.ts";
import { Icon } from "./components/ui.tsx";
import { LanguageSwitcher } from "./i18n/LanguageSwitcher.tsx";
import { resolveMenuDisplayName } from "./routing/menuLabels.ts";
import { Button, DropdownMenu, IconButton, Input } from "./ui/index.ts";
import {
  APP_VERSION,
  DEFAULT_SYSTEM_ROUTE,
} from "./config/defaults.ts";
import { useAssetModule } from "./hooks/useAssetModule.ts";
import { useApiAssetModule } from "./hooks/useApiAssetModule.ts";
import { useAuthSession, type UseAuthSessionResult } from "./hooks/useAuthSession.ts";
import { AppearanceSettings } from "./appearance/AppearanceSettings.tsx";
import { useIndicatorModule } from "./hooks/useIndicatorModule.ts";
import { useManualCodeTableModule } from "./hooks/useManualCodeTableModule.ts";
import { usePublicCatalogConfig } from "./hooks/usePublicCatalogConfig.ts";
import { usePublicBrandingConfig } from "./hooks/usePublicBrandingConfig.ts";
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
  const { i18n } = useTranslation("common");
  const authSession = useAuthSession();
  const { config: branding } = usePublicBrandingConfig(i18n.resolvedLanguage || i18n.language);
  const publicCatalog = usePublicCatalogConfig();

  // Even publicly reachable URLs can return additional fields to a signed-in user.
  // Discard the old route's in-memory data when the identity or permissions change.
  return (
    <AppSession
      key={getNavigationAuthKey(authSession.auth)}
      authSession={authSession}
      branding={branding}
      publicCatalog={publicCatalog}
    />
  );
}

interface AppSessionProps {
  authSession: UseAuthSessionResult;
  branding: AppModuleContext["branding"];
  publicCatalog: ReturnType<typeof usePublicCatalogConfig>;
}

function AppSession({ authSession, branding, publicCatalog }: AppSessionProps): React.ReactElement {
  const { t: tCommon } = useTranslation("common");
  const { t: tNavigation } = useTranslation("navigation");
  const displayMenuName = (item: MenuItem): string => resolveMenuDisplayName(
    item,
    (key, defaultValue) => tNavigation(key, { defaultValue }),
  );
  const hamburgerRef = React.useRef<HTMLButtonElement | null>(null);
  const sidebarRef = React.useRef<HTMLElement | null>(null);
  const searchToggleRef = React.useRef<HTMLButtonElement | null>(null);
  const searchInputRef = React.useRef<HTMLInputElement | null>(null);
  const navSlotRef = useRef<HTMLDivElement | null>(null);
  const navMeasureRef = useRef<HTMLElement | null>(null);
  const navActionsRef = useRef<HTMLDivElement | null>(null);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [dismissedAnnouncementVersion, setDismissedAnnouncementVersion] = useState<string | null>(null);
  const [moreNavOpen, setMoreNavOpen] = useState(false);
  const [navigationFitSnapshot, setNavigationFitSnapshot] = useState<NavigationFitSnapshot | null>(null);
  const [lineageBootstrap, setLineageBootstrap] = useState<LineageBootstrap | null>(null);
  const [lineageNodes, setLineageNodes] = useState<LineageNode[]>([]);
  const [lineageSelectedNodeId, setLineageSelectedNodeId] = useState<string | null>(null);
  const [lineageSelectionSequence, setLineageSelectionSequence] = useState(0);
  const handleLineageSelectionChange = React.useCallback((nodeId: string | null): void => {
    setLineageSelectedNodeId(nodeId);
    setLineageSelectionSequence((current) => current + 1);
  }, []);
  const [lineageFocusRequest, setLineageFocusRequest] = useState<{ nodeId: string; sequence: number } | null>(null);
  const lineageFocusSequenceRef = useRef(0);
  const focusLineageNode = React.useCallback((nodeId: string): void => {
    handleLineageSelectionChange(nodeId);
    lineageFocusSequenceRef.current += 1;
    setLineageFocusRequest({ nodeId, sequence: lineageFocusSequenceRef.current });
  }, [handleLineageSelectionChange]);
  const handleLineageFocusRequestHandled = React.useCallback((sequence: number): void => {
    setLineageFocusRequest((current) => current?.sequence === sequence ? null : current);
  }, []);
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

  useEffect(() => {
    if (module === "lineage") return;
    setLineageBootstrap(null);
    setLineageNodes([]);
    setLineageSelectedNodeId(null);
    setLineageFocusRequest(null);
  }, [module]);

  const { theme, toggleTheme } = useTheme();
  const themeToggleLabel = theme === "dark" ? tCommon("theme.switchToLight") : tCommon("theme.switchToDark");
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
  } = authSession;
  // Wait for both identity and public policy before issuing business-data requests.
  const { config: publicCatalogConfig, ready: publicCatalogConfigReady } = publicCatalog;

  useEffect(() => {
    document.title = branding.site.title || tCommon("app.documentTitle");
    const favicon = branding.site.favicon_url || "/favicon.ico";
    const faviconUrl = new URL(favicon, window.location.origin);
    faviconUrl.searchParams.set("v", branding.version);
    const existingIcons = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]'));
    const icon = existingIcons[0] || document.createElement("link");
    icon.rel = "icon";
    icon.href = `${faviconUrl.pathname}${faviconUrl.search}`;
    icon.type = favicon.toLowerCase().endsWith(".svg")
      ? "image/svg+xml"
      : favicon.toLowerCase().endsWith(".png") ? "image/png" : "image/x-icon";
    icon.removeAttribute("sizes");
    if (!icon.isConnected) document.head.appendChild(icon);
    existingIcons.slice(1).forEach((item) => item.remove());
  }, [branding.site.favicon_url, branding.site.title, branding.version, tCommon]);

  const showAnnouncement = Boolean(branding.site.announcement)
    && dismissedAnnouncementVersion !== branding.version;
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

  const isHome = module === "portal";

  useEffect(() => {
    const desktopSidebarViewport = window.matchMedia(isHome ? "(min-width: 769px)" : "(min-width: 960px)");
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
  }, [isHome]);

  const visibleNavMenus = useMemo(
    () => getVisibleNavigationMenus(navMenus, { canManageSystem, canViewOperationLog }),
    [canManageSystem, canViewOperationLog, navMenus],
  );
  const navigationPrimaryMenus = visibleNavMenus.filter((item) => item.navPlacement === "primary");
  const navigationPrimaryMenuCount = navigationPrimaryMenus.length;
  const navigationMenuKey = JSON.stringify(navigationPrimaryMenus.map((item) => [item.code, displayMenuName(item), item.icon]));

  useLayoutEffect(() => {
    const actions = navActionsRef.current;
    const measureNavigation = (): void => {
      const slot = navSlotRef.current;
      const measure = navMeasureRef.current;
      if (isHome && actions) {
        // Reserve matching room on both sides of the centered navigation.
        slot?.parentElement?.style.setProperty("--portal-tools-width", `${actions.getBoundingClientRect().width}px`);
      }
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
    if (isHome && actions) observer.observe(actions);
    window.addEventListener("resize", measureNavigation);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measureNavigation);
    };
  }, [isHome, module, navigationMenuKey, navigationPrimaryMenuCount]);

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

  const writeRoutes: Partial<Record<ModuleId, { page: string; pages: string[]; permission: string }>> = {
    dwm: { page: route.page, pages: ["new", "edit"], permission: "asset:write" },
    push: { page: pushRoute.page, pages: ["sysNew", "sysEdit", "jobNew", "jobEdit"], permission: "push:write" },
    root: { page: rootRoute.page, pages: ["new", "edit", "import"], permission: "root:write" },
    upstream: { page: upRoute.page, pages: ["new", "edit"], permission: "upstream:write" },
    indicator: { page: indicatorRoute.page, pages: ["new", "edit"], permission: "indicator:write" },
    report: { page: reportRoute.page, pages: ["new", "edit"], permission: "report:write" },
    apiAsset: { page: apiAssetRoute.page, pages: ["new", "edit"], permission: "api_asset:write" },
  };
  const writeRoute = writeRoutes[module];
  const editorAccessDenied = Boolean(writeRoute?.pages.includes(writeRoute.page) && !can(writeRoute.permission));
  const activeCatalogModule = catalogDataAccessReady && !editorAccessDenied ? module : null;

  const asset = useAssetModule({
    active: activeCatalogModule === "dwm",
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
    active: activeCatalogModule === "root",
    query,
    setQuery,
    rootRoute,
    setRootRoute,
    runProtectedMutation,
  });

  const indicator = useIndicatorModule({
    active: activeCatalogModule === "indicator",
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
    active: activeCatalogModule === "report",
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
    active: activeCatalogModule === "apiAsset", query, route: apiAssetRoute, setRoute: setApiAssetRoute,
    filter: apiAssetFilter, canEdit: can("api_asset:write"), requireLogin, setAuthError, setLoginOpen,
  });

  const push = usePushModule({
    active: activeCatalogModule === "push",
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
    active: activeCatalogModule === "upstream",
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
    active: activeCatalogModule === "codeTable",
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

  const systemLandingRoute = useMemo<SystemRoute>(() => {
    if (canViewUsers) return { page: "users" };
    if (canViewRoles) return { page: "roles" };
    if (canViewMenus) return { page: "menus" };
    if (canViewParams) return { page: "param-dicts" };
    if (canViewOperationLog) return { page: "operation-logs" };
    return DEFAULT_SYSTEM_ROUTE;
  }, [canViewMenus, canViewOperationLog, canViewParams, canViewRoles, canViewUsers]);

  const currentSystemRoute = systemRoute.page === "landing" ? systemLandingRoute : systemRoute;

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
  const hasModuleSidebar = module !== "notFound";
  const isPortal = isHome || !hasModuleSidebar;

  useEffect(() => {
    setMoreNavOpen(false);
    const hiddenNavigation = window.matchMedia(isPortal ? "(max-width: 768px)" : "(max-width: 959px)");
    const closeWhenHidden = (): void => {
      if (hiddenNavigation.matches) setMoreNavOpen(false);
    };
    hiddenNavigation.addEventListener("change", closeWhenHidden);
    return () => hiddenNavigation.removeEventListener("change", closeWhenHidden);
  }, [isHome, isPortal]);

  const searchPlaceholder = isPush
    ? tCommon("search.placeholder.push")
    : isCodeTable
      ? tCommon("search.placeholder.codeTable")
      : isReport
        ? tCommon("search.placeholder.report")
        : isIndicator
          ? tCommon("search.placeholder.indicator")
          : isRoot
            ? tCommon("search.placeholder.root")
            : isSystem
              ? currentSystemRoute.page === "menus"
                ? tCommon("search.placeholder.systemMenus")
                : currentSystemRoute.page === "param-dicts"
                  ? tCommon("search.placeholder.systemParams")
                    : currentSystemRoute.page === "ai"
                      ? tCommon("search.placeholder.systemAi")
                      : currentSystemRoute.page === "branding"
                        ? tCommon("search.placeholder.systemBranding")
                  : currentSystemRoute.page === "roles"
                    ? tCommon("search.placeholder.systemRoles")
                    : currentSystemRoute.page === "operation-logs"
                      ? tCommon("search.placeholder.systemLogs")
                      : tCommon("search.placeholder.systemUsers")
              : isUpstream
                ? tCommon("search.placeholder.upstream")
                : isMapping
                  ? tCommon("search.placeholder.mapping")
                  : tCommon("search.placeholder.default");

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
    branding,
    apiAsset,
    apiAssetFilter,
    apiAssetRoute,
    apiAssetView,
    asset,
    auth,
    backToUpstreamList,
    businessAccessReady,
    catalogAccessDisabled,
    catalogDataAccessReady,
    catalogExportEnabled: publicCatalogConfig.exportEnabled,
    can,
    canEdit,
    canManageMenus,
    canManageParams,
    canManageRoles,
    canManageUsers,
    canViewMenus,
    canViewOperationLog,
    canViewParams,
    canViewRoles,
    canViewUsers,
    editorAccessDenied,
    goToMapping,
    goToModuleWithQuery,
    indicator,
    indicatorFilter,
    indicatorRoute,
    indicatorView,
    lineageBootstrap,
    lineageNodes,
    lineageSelectedNodeId,
    lineageSelectionSequence,
    handleLineageSelectionChange,
    lineageFocusRequest,
    handleLineageFocusRequestHandled,
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
    setLineageNodes,
    setLineageSelectedNodeId,
    focusLineageNode,
    setLineageFocusRequest,
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
    systemRoute: currentSystemRoute,
    upRoute,
    upstream,
    visibleModuleKeys,
  };
  const moduleContent = <ModuleContent module={module} context={moduleContext} />;
  const moduleSidebar = editorAccessDenied ? null : <ModuleSidebar module={module} context={moduleContext} />;

  const footer = (
    <footer className={isHome ? "app-footer-shell portal-home-footer" : "app-footer-shell"} role="contentinfo">
      <div className="app-footer">
        <span className="app-footer-copy">{isHome ? branding.site.display_name : branding.site.title} {APP_VERSION}</span>
        <span className="app-footer-separator" aria-hidden="true">{isHome ? null : "·"}</span>
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
  );

  return (
    <AuthContext.Provider value={authContextValue}>
      <AppShell>
        <header className={`topbar${isPortal ? " portal-topbar" : ""}${isHome ? " portal-home-topbar" : ""}`}>
          <div className="topbar-brand">
            {hasModuleSidebar ? (
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
                aria-label={sidebarOpen ? tCommon("navigation.close") : tCommon("navigation.open")}
                icon={<Icon name="menu" size={18} />}
              />
            ) : null}

            <div className="brand" onClick={() => switchModule("portal")}>
              <div className="brand-mark">
                <BrandLogo src={branding.site.logo_url} alt={branding.site.display_name} />
              </div>
              <div className="brand-name">{branding.site.display_name}<small>{tCommon("app.brandTagline")}</small></div>
            </div>
          </div>

          <div className="topbar-nav-slot" ref={navSlotRef}>
            <nav className="mainnav" aria-label={tCommon("navigation.main")}>
              {currentNavMenuStatus === "loading" ? (
                <Button type="button" variant="tertiary" size="sm" disabled className="navigation-message">{tCommon("navigation.loadingMenus")}</Button>
              ) : currentNavMenuStatus === "error" ? (
                <Button
                  type="button"
                  variant="tertiary"
                  size="sm"
                  className="navigation-message"
                  onClick={() => void loadMenus(navigationAuthKey)}
                >
                  {tCommon("navigation.menuLoadFailed")}
                </Button>
              ) : catalogDataAccessReady && visibleNavMenus.length === 0 ? (
                <span className="navigation-status" role="status">{tCommon("navigation.noMenus")}</span>
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
                  <Icon name={item.icon} size={15} />{displayMenuName(item)}
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
                          aria-label={tCommon("navigation.more")}
                          aria-controls="more-nav-menu"
                        />
                      )}
                    >
                      {tCommon("navigation.more")}
                      <Icon name="chevron" size={13} />
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Content
                      id="more-nav-menu"
                      className={isHome ? "more-nav-menu portal-more-nav-menu" : "more-nav-menu"}
                      align="end"
                      side="bottom"
                    >
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
                          {displayMenuName(item)}
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
                  <Icon name={item.icon} size={15} />{displayMenuName(item)}
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
                  {tCommon("navigation.more")}<Icon name="chevron" size={13} />
                </Button>
              </div>
            </nav>
          </div>

          <div className="topbar-actions" ref={navActionsRef}>
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
                aria-label={mobileSearchOpen ? tCommon("search.closeMobile") : tCommon("search.openMobile")}
              >
                <Icon name={mobileSearchOpen ? "close" : "search"} size={17} />
              </button>
            ) : null}
            {!isPortal ? (
              <div id="global-search" className={`search${query ? " has-val" : ""}${mobileSearchOpen ? " mobile-open" : ""}`}>
                <span className="ico-search"><Icon name="search" size={16} /></span>
                <Input
                  ref={searchInputRef}
                  aria-label={tCommon("search.global")}
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
                  aria-label={tCommon("search.clear")}
                  onClick={() => setQuery("")}
                >
                  <Icon name="close" size={13} />
                </Button>
              </div>
            ) : null}

            <LanguageSwitcher />
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

            <AppearanceSettings />

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

        {showAnnouncement ? (
          <aside className="app-announcement" role="status">
            <span className="app-announcement-text">{branding.site.announcement}</span>
            <button
              className="app-announcement-close"
              type="button"
              aria-label={tCommon("branding.closeAnnouncement")}
              onClick={() => setDismissedAnnouncementVersion(branding.version)}
            >
              <Icon name="close" size={15} />
            </button>
          </aside>
        ) : null}

        <div className="body">
          {hasModuleSidebar ? (
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
                key={isHome ? "portal" : "module"}
                ref={sidebarRef}
                id="mobile-sidebar"
                className={`sidebar${sidebarOpen ? " open" : ""}`}
                aria-label={tCommon("navigation.moduleAndFilters")}
                tabIndex={-1}
                onClick={(event) => {
                  if (event.target instanceof Element && event.target.closest(".side-item")) {
                    setSidebarOpen(false);
                  }
                }}
              >
                {!isPortal ? <div className="sidebar-language-switcher"><LanguageSwitcher /></div> : null}
                <nav className="mobile-module-nav" aria-label={tCommon("navigation.module")}>
                  <div className="side-title">{tCommon("navigation.module")}</div>
                  {currentNavMenuStatus === "loading" ? (
                    <Button className="mobile-module-link" type="button" variant="tertiary" size="sm" disabled>{tCommon("navigation.loadingMenus")}</Button>
                  ) : currentNavMenuStatus === "error" ? (
                    <Button className="mobile-module-link" type="button" variant="tertiary" size="sm" onClick={() => void loadMenus(navigationAuthKey)}>
                      {tCommon("navigation.menuLoadFailed")}
                    </Button>
                  ) : catalogDataAccessReady && visibleNavMenus.length === 0 ? (
                    <span className="navigation-status" role="status">{tCommon("navigation.noMenus")}</span>
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
                      <Icon name={item.icon} size={16} />{displayMenuName(item)}
                    </Button>
                  ))}
                </nav>
                <ModuleErrorBoundary
                  resetKey={sidebarResetKey}
                  title={tCommon("navigation.sidebarErrorTitle")}
                  desc={tCommon("navigation.sidebarErrorDescription")}
                  onRetry={() => window.location.reload()}
                >
                  {moduleSidebar}
                </ModuleErrorBoundary>
              </aside>
            </>
          ) : null}

          <main className={isHome ? "main portal-home-main" : "main"}>
            <div className="main-inner">
              <ModuleErrorBoundary
                resetKey={mainResetKey}
                title={tCommon("navigation.moduleErrorTitle")}
                desc={tCommon("navigation.moduleErrorDescription")}
                onRetry={() => window.location.reload()}
              >
                {moduleContent}
              </ModuleErrorBoundary>
            </div>
            {isHome ? footer : null}
          </main>
        </div>

        {!isHome ? footer : null}

        <LoginModal
          open={loginOpen}
          busy={authBusy}
          error={authError}
          branding={{
            logoUrl: branding.site.logo_url,
            displayName: branding.site.display_name,
            hint: branding.login.hint,
          }}
          onClose={() => {
            if (authBusy) return;
            setLoginOpen(false);
            setAuthError("");
          }}
          onSubmit={handleLoginSubmit}
        />

        <ConfirmDialogHost />
      </AppShell>
    </AuthContext.Provider>
  );
}
