import { useEffect, useRef } from "react";

import {
  buildNavigationLocation,
  resolveHistoryAction,
} from "../routing/location.ts";

function getRoutes(navigation) {
  return {
    asset: navigation.route,
    push: navigation.pushRoute,
    indicator: navigation.indicatorRoute,
    report: navigation.reportRoute,
    apiAsset: navigation.apiAssetRoute,
    root: navigation.rootRoute,
    upstream: navigation.upRoute,
    mapping: navigation.mappingRoute,
    lineage: navigation.lineageRoute,
    system: navigation.systemRoute,
  };
}

function getRuntimeUrlState({ navigation, asset, push, upstream }) {
  return {
    asset: {
      domain: asset.domain,
      selectedLayer: asset.selectedLayer,
      layout: asset.layout,
      detailTab: asset.detailTab,
    },
    indicator: {
      filter: navigation.indicatorFilter,
      view: navigation.indicatorView,
    },
    report: {
      filter: navigation.reportFilter,
      view: navigation.reportView,
    },
    apiAsset: {
      filter: navigation.apiAssetFilter,
      view: navigation.apiAssetView,
    },
    upstream: {
      filter: upstream.upFilter,
      view: upstream.upstreamView,
    },
    push: {
      filter: push.pushFilter,
      view: push.pushView,
    },
  };
}

function getRestoredUrlState(navigation) {
  return {
    asset: {
      domain: navigation.assetDomainFromUrl,
      selectedLayer: navigation.assetLayerFromUrl,
      layout: navigation.assetLayoutFromUrl,
      detailTab: navigation.assetDetailTabFromUrl,
    },
    indicator: {
      filter: navigation.indicatorFilter,
      view: navigation.indicatorView,
    },
    report: {
      filter: navigation.reportFilter,
      view: navigation.reportView,
    },
    apiAsset: {
      filter: navigation.apiAssetFilter,
      view: navigation.apiAssetView,
    },
    upstream: {
      filter: navigation.upFilterFromUrl,
      view: navigation.upstreamViewFromUrl,
    },
    push: {
      filter: navigation.pushFilterFromUrl,
      view: navigation.pushViewFromUrl,
    },
  };
}

export function useLocationSynchronization({ navigation, asset, push, upstream }) {
  const historyReadyRef = useRef(false);
  const lastPopstateRevisionRef = useRef(navigation.locationRevision);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const isPopstate = lastPopstateRevisionRef.current !== navigation.locationRevision;
    const nextLocation = buildNavigationLocation({
      module: navigation.module,
      routes: getRoutes(navigation),
      query: navigation.query,
      urlState: isPopstate
        ? getRestoredUrlState(navigation)
        : getRuntimeUrlState({ navigation, asset, push, upstream }),
    });
    const currentPathname = window.location.pathname;
    const currentUrl = `${currentPathname}${window.location.search}`;
    const action = resolveHistoryAction({
      currentUrl,
      currentPathname,
      nextUrl: nextLocation.url,
      nextPathname: nextLocation.pathname,
      historyReady: historyReadyRef.current,
      isPopstate,
    });

    if (action === "push") {
      window.history.pushState({}, "", nextLocation.url);
    } else if (action === "replace") {
      window.history.replaceState({}, "", nextLocation.url);
    }
    if (isPopstate) lastPopstateRevisionRef.current = navigation.locationRevision;
    historyReadyRef.current = true;
    // The dependency list intentionally tracks the primitive route and URL-state
    // values above instead of the render-scoped container objects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    asset.detailTab,
    asset.domain,
    asset.layout,
    asset.selectedLayer,
    navigation.apiAssetFilter,
    navigation.apiAssetRoute,
    navigation.apiAssetView,
    navigation.assetDetailTabFromUrl,
    navigation.assetDomainFromUrl,
    navigation.assetLayerFromUrl,
    navigation.assetLayoutFromUrl,
    navigation.indicatorFilter,
    navigation.indicatorRoute,
    navigation.indicatorView,
    navigation.lineageRoute,
    navigation.locationRevision,
    navigation.mappingRoute,
    navigation.module,
    navigation.pushFilterFromUrl,
    navigation.pushRoute,
    navigation.pushViewFromUrl,
    navigation.query,
    navigation.reportFilter,
    navigation.reportRoute,
    navigation.reportView,
    navigation.route,
    navigation.rootRoute,
    navigation.systemRoute,
    navigation.upFilterFromUrl,
    navigation.upRoute,
    navigation.upstreamViewFromUrl,
    push.pushFilter,
    push.pushView,
    upstream.upFilter,
    upstream.upstreamView,
  ]);
}
