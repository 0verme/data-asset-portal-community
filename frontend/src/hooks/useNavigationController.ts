import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';

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
} from '../config/defaults.ts';
import { createNavigationState } from '../routing/navigation.ts';
import { getPortalPushNavigation, type PortalTarget } from '../routing/portalNavigation.ts';
import { parseInitialLocation } from '../routing/location.ts';
import type {
  AssetRoute,
  ApiAssetFilter,
  ApiAssetRoute,
  IndicatorFilter,
  IndicatorRoute,
  LineageRoute,
  MappingRoute,
  ModuleId,
  NavigationState,
  PushRoute,
  ReportFilter,
  ReportRoute,
  RootRoute,
  SystemRoute,
  UpstreamRoute,
} from '../routing/types.ts';

export interface ExtendedNavigationState extends NavigationState {
  locationRevision: number;
}

function resetNavigationForModule(
  current: ExtendedNavigationState,
  nextModule: ModuleId,
  systemRoute?: SystemRoute,
): ExtendedNavigationState {
  const next: ExtendedNavigationState = {
    ...current,
    module: nextModule,
    query: '',
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

  if (nextModule === 'indicator') next.indicatorRoute = DEFAULT_INDICATOR_ROUTE;
  if (nextModule === 'report') {
    next.reportRoute = DEFAULT_REPORT_ROUTE;
    next.reportFilter = DEFAULT_REPORT_FILTER;
  }
  if (nextModule === 'apiAsset') {
    next.apiAssetRoute = DEFAULT_API_ASSET_ROUTE;
    next.apiAssetFilter = DEFAULT_API_ASSET_FILTER;
  }
  if (nextModule === 'mapping') next.mappingRoute = DEFAULT_MAPPING_ROUTE;
  if (nextModule === 'system') next.systemRoute = systemRoute || DEFAULT_SYSTEM_ROUTE;
  return next;
}

export interface UseNavigationControllerOptions {
  onPopState?: () => void;
}

export interface NavigationActions {
  switchModule: (nextModule: ModuleId, options?: { systemRoute?: SystemRoute }) => void;
  goToMapping: (nextMappingRoute?: Partial<MappingRoute>) => void;
  backToUpstreamList: () => void;
  goToModuleWithQuery: (
    target: ModuleId | (PortalTarget & { module?: ModuleId; mappingRoute?: MappingRoute }),
    nextQuery?: string,
    options?: { systemRoute?: SystemRoute },
  ) => void;
}

export interface UseNavigationControllerResult extends ExtendedNavigationState {
  setModule: (value: ModuleId | ((prev: ModuleId) => ModuleId)) => void;
  setQuery: (value: string | ((prev: string) => string)) => void;
  setRoute: (value: AssetRoute | ((prev: AssetRoute) => AssetRoute)) => void;
  setPushRoute: (value: PushRoute | ((prev: PushRoute) => PushRoute)) => void;
  setIndicatorRoute: (value: IndicatorRoute | ((prev: IndicatorRoute) => IndicatorRoute)) => void;
  setReportRoute: (value: ReportRoute | ((prev: ReportRoute) => ReportRoute)) => void;
  setApiAssetRoute: (value: ApiAssetRoute | ((prev: ApiAssetRoute) => ApiAssetRoute)) => void;
  setRootRoute: (value: RootRoute | ((prev: RootRoute) => RootRoute)) => void;
  setUpRoute: (value: UpstreamRoute | ((prev: UpstreamRoute) => UpstreamRoute)) => void;
  setMappingRoute: (value: MappingRoute | ((prev: MappingRoute) => MappingRoute)) => void;
  setLineageRoute: (value: LineageRoute | ((prev: LineageRoute) => LineageRoute)) => void;
  setSystemRoute: (value: SystemRoute | ((prev: SystemRoute) => SystemRoute)) => void;
  setIndicatorFilter: (value: IndicatorFilter | ((prev: IndicatorFilter) => IndicatorFilter)) => void;
  setIndicatorView: (value: string | ((prev: string) => string)) => void;
  setReportFilter: (value: ReportFilter | ((prev: ReportFilter) => ReportFilter)) => void;
  setReportView: (value: string | ((prev: string) => string)) => void;
  setApiAssetFilter: (value: ApiAssetFilter | ((prev: ApiAssetFilter) => ApiAssetFilter)) => void;
  setApiAssetView: (value: string | ((prev: string) => string)) => void;
  actions: NavigationActions;
}

export function useNavigationController({
  onPopState,
}: UseNavigationControllerOptions = {}): UseNavigationControllerResult {
  const [navigationState, setNavigationState] = useState<ExtendedNavigationState>(() => ({
    ...createNavigationState(parseInitialLocation()),
    locationRevision: 0,
  }));
  const onPopStateRef = useRef(onPopState);

  useEffect(() => {
    onPopStateRef.current = onPopState;
  }, [onPopState]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const handlePopState = (): void => {
      setNavigationState((current) => ({
        ...createNavigationState(parseInitialLocation()),
        // Root subroutes are intentionally not part of the URL contract;
        // preserve the existing in-module route across browser traversal.
        rootRoute: current.rootRoute,
        locationRevision: current.locationRevision + 1,
      }));
      onPopStateRef.current?.();
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const setNavigationField = useCallback(
    <K extends keyof ExtendedNavigationState>(
      field: K,
      value: SetStateAction<ExtendedNavigationState[K]>,
    ): void => {
      setNavigationState((current) => {
        const prev = current[field];
        const nextValue =
          typeof value === 'function'
            ? (value as (p: ExtendedNavigationState[K]) => ExtendedNavigationState[K])(prev)
            : value;
        return Object.is(nextValue, prev) ? current : { ...current, [field]: nextValue };
      });
    },
    [],
  );

  const setModule = useCallback((value: SetStateAction<ModuleId>) => setNavigationField('module', value), [setNavigationField]);
  const setQuery = useCallback((value: SetStateAction<string>) => setNavigationField('query', value), [setNavigationField]);
  const setRoute = useCallback((value: SetStateAction<AssetRoute>) => setNavigationField('route', value), [setNavigationField]);
  const setPushRoute = useCallback((value: SetStateAction<PushRoute>) => setNavigationField('pushRoute', value), [setNavigationField]);
  const setIndicatorRoute = useCallback((value: SetStateAction<IndicatorRoute>) => setNavigationField('indicatorRoute', value), [setNavigationField]);
  const setReportRoute = useCallback((value: SetStateAction<ReportRoute>) => setNavigationField('reportRoute', value), [setNavigationField]);
  const setApiAssetRoute = useCallback((value: SetStateAction<ApiAssetRoute>) => setNavigationField('apiAssetRoute', value), [setNavigationField]);
  const setRootRoute = useCallback((value: SetStateAction<RootRoute>) => setNavigationField('rootRoute', value), [setNavigationField]);
  const setUpRoute = useCallback((value: SetStateAction<UpstreamRoute>) => setNavigationField('upRoute', value), [setNavigationField]);
  const setMappingRoute = useCallback((value: SetStateAction<MappingRoute>) => setNavigationField('mappingRoute', value), [setNavigationField]);
  const setLineageRoute = useCallback((value: SetStateAction<LineageRoute>) => setNavigationField('lineageRoute', value), [setNavigationField]);
  const setSystemRoute = useCallback((value: SetStateAction<SystemRoute>) => setNavigationField('systemRoute', value), [setNavigationField]);
  const setIndicatorFilter = useCallback((value: SetStateAction<IndicatorFilter>) => setNavigationField('indicatorFilter', value), [setNavigationField]);
  const setIndicatorView = useCallback((value: SetStateAction<string>) => setNavigationField('indicatorView', value), [setNavigationField]);
  const setReportFilter = useCallback((value: SetStateAction<ReportFilter>) => setNavigationField('reportFilter', value), [setNavigationField]);
  const setReportView = useCallback((value: SetStateAction<string>) => setNavigationField('reportView', value), [setNavigationField]);
  const setApiAssetFilter = useCallback((value: SetStateAction<ApiAssetFilter>) => setNavigationField('apiAssetFilter', value), [setNavigationField]);
  const setApiAssetView = useCallback((value: SetStateAction<string>) => setNavigationField('apiAssetView', value), [setNavigationField]);

  const switchModule = useCallback(
    (nextModule: ModuleId, { systemRoute }: { systemRoute?: SystemRoute } = {}) => {
      setNavigationState((current) => resetNavigationForModule(current, nextModule, systemRoute));
    },
    [],
  );

  const goToMapping = useCallback((nextMappingRoute?: Partial<MappingRoute>) => {
    setNavigationState((current) => ({
      ...current,
      module: 'mapping',
      mappingRoute: { ...DEFAULT_MAPPING_ROUTE, ...nextMappingRoute },
    }));
  }, []);

  const backToUpstreamList = useCallback(() => {
    setNavigationState((current) => ({
      ...current,
      module: 'upstream',
      upRoute: DEFAULT_UP_ROUTE,
    }));
  }, []);

  const goToModuleWithQuery = useCallback(
    (
      target: ModuleId | (PortalTarget & { module?: ModuleId; mappingRoute?: MappingRoute }),
      nextQuery?: string,
      { systemRoute }: { systemRoute?: SystemRoute } = {},
    ) => {
      const nextModule: ModuleId | undefined =
        typeof target === 'string' ? (target as ModuleId) : target?.module;
      if (!nextModule) return;

      const pushNavigation =
        nextModule === 'push' ? getPortalPushNavigation(typeof target === 'object' ? target : null, DEFAULT_PUSH_ROUTE) : null;

      setNavigationState((current) => {
        const next: ExtendedNavigationState = {
          ...current,
          module: nextModule,
          query: (pushNavigation?.query ?? nextQuery) || '',
        };
        if (nextModule === 'indicator') next.indicatorRoute = DEFAULT_INDICATOR_ROUTE;
        if (nextModule === 'report') {
          next.reportRoute = DEFAULT_REPORT_ROUTE;
          next.reportFilter = DEFAULT_REPORT_FILTER;
        }
        if (nextModule === 'apiAsset') {
          next.apiAssetRoute = DEFAULT_API_ASSET_ROUTE;
          next.apiAssetFilter = DEFAULT_API_ASSET_FILTER;
        }
        if (nextModule === 'mapping') {
          next.mappingRoute = (typeof target === 'object' ? target.mappingRoute : undefined) || DEFAULT_MAPPING_ROUTE;
        }
        if (nextModule === 'system') next.systemRoute = systemRoute || DEFAULT_SYSTEM_ROUTE;
        if (nextModule === 'push' && pushNavigation) next.pushRoute = pushNavigation.route as PushRoute;
        return next;
      });
    },
    [],
  );

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
