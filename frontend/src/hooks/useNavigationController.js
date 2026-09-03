import { useCallback, useEffect, useRef, useState } from "react";

import {
  DEFAULT_ASSET_ROUTE,
  DEFAULT_API_ASSET_FILTER,
  DEFAULT_API_ASSET_ROUTE,
  DEFAULT_INDICATOR_ROUTE,
  DEFAULT_MAPPING_ROUTE,
  DEFAULT_PUSH_FILTER,
  DEFAULT_PUSH_ROUTE,
  DEFAULT_REPORT_FILTER,
  DEFAULT_REPORT_ROUTE,
  DEFAULT_ROOT_ROUTE,
  DEFAULT_SYSTEM_ROUTE,
  DEFAULT_UP_FILTER,
  DEFAULT_UP_ROUTE,
  DEFAULT_LAYOUT,
  DEFAULT_DETAIL_TAB,
  DEFAULT_PUSH_VIEW,
  DEFAULT_UP_VIEW,
} from "../config/defaults.ts";
import { createNavigationState } from "../routing/navigation.ts";
import { getPortalPushNavigation } from "../routing/portalNavigation.js";
import { parseInitialLocation } from "../routing/location.ts";

function resetNavigationForModule(current, nextModule, systemRoute) {
  const next = {
    ...current,
    module: nextModule,
    query: "",
    route: DEFAULT_ASSET_ROUTE,
    pushRoute: DEFAULT_PUSH_ROUTE,
    rootRoute: DEFAULT_ROOT_ROUTE,
    upRoute: DEFAULT_UP_ROUTE,
    assetLayoutFromUrl: DEFAULT_LAYOUT,
    assetDomainFromUrl: null,
    assetLayerFromUrl: null,
    assetDetailTabFromUrl: DEFAULT_DETAIL_TAB,
    pushViewFromUrl: DEFAULT_PUSH_VIEW,
    pushFilterFromUrl: DEFAULT_PUSH_FILTER,
    upFilterFromUrl: DEFAULT_UP_FILTER,
    upstreamViewFromUrl: DEFAULT_UP_VIEW,
  };

  if (nextModule === "indicator") next.indicatorRoute = DEFAULT_INDICATOR_ROUTE;
  if (nextModule === "report") {
    next.reportRoute = DEFAULT_REPORT_ROUTE;
    next.reportFilter = DEFAULT_REPORT_FILTER;
  }
  if (nextModule === "apiAsset") {
    next.apiAssetRoute = DEFAULT_API_ASSET_ROUTE;
    next.apiAssetFilter = DEFAULT_API_ASSET_FILTER;
  }
  if (nextModule === "mapping") next.mappingRoute = DEFAULT_MAPPING_ROUTE;
  if (nextModule === "system") next.systemRoute = systemRoute || DEFAULT_SYSTEM_ROUTE;
  return next;
}

export function useNavigationController({ onPopState } = {}) {
  const [navigationState, setNavigationState] = useState(() => ({
    ...createNavigationState(parseInitialLocation()),
    locationRevision: 0,
  }));
  const onPopStateRef = useRef(onPopState);

  useEffect(() => {
    onPopStateRef.current = onPopState;
  }, [onPopState]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const handlePopState = () => {
      setNavigationState((current) => ({
        ...createNavigationState(parseInitialLocation()),
        // Root subroutes are intentionally not part of the URL contract;
        // preserve the existing in-module route across browser traversal.
        rootRoute: current.rootRoute,
        locationRevision: current.locationRevision + 1,
      }));
      onPopStateRef.current?.();
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const setNavigationField = useCallback((field, value) => {
    setNavigationState((current) => {
      const nextValue = typeof value === "function" ? value(current[field]) : value;
      return Object.is(nextValue, current[field])
        ? current
        : { ...current, [field]: nextValue };
    });
  }, []);

  const setModule = useCallback((value) => setNavigationField("module", value), [setNavigationField]);
  const setQuery = useCallback((value) => setNavigationField("query", value), [setNavigationField]);
  const setRoute = useCallback((value) => setNavigationField("route", value), [setNavigationField]);
  const setPushRoute = useCallback((value) => setNavigationField("pushRoute", value), [setNavigationField]);
  const setIndicatorRoute = useCallback((value) => setNavigationField("indicatorRoute", value), [setNavigationField]);
  const setReportRoute = useCallback((value) => setNavigationField("reportRoute", value), [setNavigationField]);
  const setApiAssetRoute = useCallback((value) => setNavigationField("apiAssetRoute", value), [setNavigationField]);
  const setRootRoute = useCallback((value) => setNavigationField("rootRoute", value), [setNavigationField]);
  const setUpRoute = useCallback((value) => setNavigationField("upRoute", value), [setNavigationField]);
  const setMappingRoute = useCallback((value) => setNavigationField("mappingRoute", value), [setNavigationField]);
  const setLineageRoute = useCallback((value) => setNavigationField("lineageRoute", value), [setNavigationField]);
  const setSystemRoute = useCallback((value) => setNavigationField("systemRoute", value), [setNavigationField]);
  const setIndicatorFilter = useCallback((value) => setNavigationField("indicatorFilter", value), [setNavigationField]);
  const setIndicatorView = useCallback((value) => setNavigationField("indicatorView", value), [setNavigationField]);
  const setReportFilter = useCallback((value) => setNavigationField("reportFilter", value), [setNavigationField]);
  const setReportView = useCallback((value) => setNavigationField("reportView", value), [setNavigationField]);
  const setApiAssetFilter = useCallback((value) => setNavigationField("apiAssetFilter", value), [setNavigationField]);
  const setApiAssetView = useCallback((value) => setNavigationField("apiAssetView", value), [setNavigationField]);

  const switchModule = useCallback((nextModule, { systemRoute } = {}) => {
    setNavigationState((current) => resetNavigationForModule(current, nextModule, systemRoute));
  }, []);

  const goToMapping = useCallback((nextMappingRoute) => {
    setNavigationState((current) => ({
      ...current,
      module: "mapping",
      mappingRoute: { ...DEFAULT_MAPPING_ROUTE, ...nextMappingRoute },
    }));
  }, []);

  const backToUpstreamList = useCallback(() => {
    setNavigationState((current) => ({
      ...current,
      module: "upstream",
      upRoute: DEFAULT_UP_ROUTE,
    }));
  }, []);

  const goToModuleWithQuery = useCallback((target, nextQuery, { systemRoute } = {}) => {
    const nextModule = target?.module || target;
    if (!nextModule) return;

    const pushNavigation = nextModule === "push"
      ? getPortalPushNavigation(target, DEFAULT_PUSH_ROUTE)
      : null;

    setNavigationState((current) => {
      const next = {
        ...current,
        module: nextModule,
        query: (pushNavigation?.query ?? nextQuery) || "",
      };
      if (nextModule === "indicator") next.indicatorRoute = DEFAULT_INDICATOR_ROUTE;
      if (nextModule === "report") {
        next.reportRoute = DEFAULT_REPORT_ROUTE;
        next.reportFilter = DEFAULT_REPORT_FILTER;
      }
      if (nextModule === "apiAsset") {
        next.apiAssetRoute = DEFAULT_API_ASSET_ROUTE;
        next.apiAssetFilter = DEFAULT_API_ASSET_FILTER;
      }
      if (nextModule === "mapping") next.mappingRoute = target?.mappingRoute || DEFAULT_MAPPING_ROUTE;
      if (nextModule === "system") next.systemRoute = systemRoute || DEFAULT_SYSTEM_ROUTE;
      if (nextModule === "push") next.pushRoute = pushNavigation.route;
      return next;
    });
  }, []);

  return {
    ...navigationState,
    setModule,
    setQuery,
    setRoute,
    setPushRoute,
    setIndicatorRoute,
    setReportRoute,
    setApiAssetRoute,
    setRootRoute,
    setUpRoute,
    setMappingRoute,
    setLineageRoute,
    setSystemRoute,
    setIndicatorFilter,
    setIndicatorView,
    setReportFilter,
    setReportView,
    setApiAssetFilter,
    setApiAssetView,
    actions: {
      switchModule,
      goToMapping,
      backToUpstreamList,
      goToModuleWithQuery,
    },
  };
}
