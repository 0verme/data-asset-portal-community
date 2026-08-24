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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  deleteAssetTable,
  getAssetDDL,
  getAssetDetail,
  getAssetTablePage,
  getDomains,
  getLayers,
  saveAssetTable,
} from "../api/assets.js";
import { DOMAIN_ORDER, LAYER_OPTIONS } from "../config/assets.js";
import {
  DEFAULT_DETAIL_TAB,
  DEFAULT_LAYOUT,
} from "../config/defaults.js";
import {
  clearModuleNavigationState,
  getModuleDetailRoute,
  getModuleEditRoute,
  getModuleListRoute,
  MODULE_META,
  pushModuleNavigationState,
} from "../routing/navigation.js";
import { useSmartBack } from "./useSmartBack.js";
import { getAssetLayerValue } from "../utils/assetFilters.js";
import { getErrorMessage, scrollMainToTop } from "../utils/ui.js";

const ASSET_PAGE_SIZE = 20;

export function useAssetModule({
  active,
  query,
  setQuery,
  route,
  setRoute,
  initialLayout = DEFAULT_LAYOUT,
  initialDomain = null,
  initialSelectedLayer = null,
  initialDetailTab = DEFAULT_DETAIL_TAB,
  requireLogin,
  runProtectedMutation,
}) {
  const [tables, setTables] = useState([]);
  const [domains, setDomains] = useState([]);
  const [layers, setLayers] = useState([]);
  const [homeLoading, setHomeLoading] = useState(false);
  const [homeError, setHomeError] = useState("");
  const [page, setPage] = useState(1);
  const [totalTables, setTotalTables] = useState(0);
  const homeRequestRef = useRef(0);
  const facetCacheRef = useRef(new Map());

  const [detailAsset, setDetailAsset] = useState(null);
  const [detailFields, setDetailFields] = useState([]);
  const [detailDDL, setDetailDDL] = useState({
    ddl: "",
    ddlDialect: "postgresql",
    ddlDialectLabel: "PostgreSQL SQL",
  });
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");

  const [layout, setLayout] = useState(initialLayout);
  const [domain, setDomain] = useState(initialDomain);
  const [selectedLayer, setSelectedLayer] = useState(initialSelectedLayer);
  const [detailTab, setDetailTab] = useState(initialDetailTab);

  const buildNavigationSnapshot = useCallback(() => ({
    route,
    query,
    layout,
    domain,
    selectedLayer,
    detailTab,
  }), [detailTab, domain, layout, query, route, selectedLayer]);

  const restoreNavigationSnapshot = useCallback((snapshot) => {
    setQuery(snapshot?.query || "");
    setLayout(snapshot?.layout || DEFAULT_LAYOUT);
    setDomain(snapshot?.domain || null);
    setSelectedLayer(snapshot?.selectedLayer || null);
    setDetailTab(snapshot?.detailTab || DEFAULT_DETAIL_TAB);
    setRoute(snapshot?.route || MODULE_META.dwm.defaultRoute);
    scrollMainToTop();
  }, [setQuery, setRoute]);

  useEffect(() => {
    setLayout(initialLayout || DEFAULT_LAYOUT);
  }, [initialLayout]);

  useEffect(() => {
    setDomain(initialDomain || null);
  }, [initialDomain]);

  useEffect(() => {
    setSelectedLayer(initialSelectedLayer || null);
  }, [initialSelectedLayer]);

  useEffect(() => {
    setDetailTab(initialDetailTab || DEFAULT_DETAIL_TAB);
  }, [initialDetailTab]);

  const loadHomeData = useCallback(async () => {
    const requestId = ++homeRequestRef.current;
    setHomeLoading(true);
    setHomeError("");
    try {
      const facetKey = JSON.stringify([selectedLayer || "", domain || ""]);
      if (!facetCacheRef.current.has(facetKey)) {
        const facetPromise = Promise.all([
          getDomains({ layer: selectedLayer || undefined }),
          getLayers({ domain: domain || undefined }),
        ]).catch((error) => {
          facetCacheRef.current.delete(facetKey);
          throw error;
        });
        facetCacheRef.current.set(facetKey, facetPromise);
      }
      const [tablePage, [domainList, layerList]] = await Promise.all([
        getAssetTablePage({
          page,
          pageSize: ASSET_PAGE_SIZE,
          keyword: query.trim() || undefined,
          domain: domain || undefined,
          layer: selectedLayer || undefined,
        }),
        facetCacheRef.current.get(facetKey),
      ]);
      if (requestId !== homeRequestRef.current) return;
      setTables(tablePage.items);
      setTotalTables(tablePage.total);
      setDomains(domainList);
      setLayers(layerList);
    } catch (error) {
      if (requestId !== homeRequestRef.current) return;
      setHomeError(getErrorMessage(error, "资产元数据加载失败。"));
    } finally {
      if (requestId === homeRequestRef.current) setHomeLoading(false);
    }
  }, [domain, page, query, selectedLayer]);

  const loadDetailData = useCallback(async (tableName) => {
    setDetailLoading(true);
    setDetailError("");
    try {
      const [asset, ddlData] = await Promise.all([
        getAssetDetail(tableName),
        getAssetDDL(tableName),
      ]);
      setDetailAsset(asset);
      setDetailFields(asset.fields || []);
      setDetailDDL(ddlData);
    } catch (error) {
      setDetailAsset(null);
      setDetailFields([]);
      setDetailDDL({
        ddl: "",
        ddlDialect: "postgresql",
        ddlDialectLabel: "PostgreSQL SQL",
      });
      setDetailError(getErrorMessage(error, "资产详情加载失败。"));
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    setPage(1);
  }, [domain, query, selectedLayer]);

  useEffect(() => {
    if (!active) return undefined;
    const timer = setTimeout(loadHomeData, query.trim() ? 250 : 0);
    return () => clearTimeout(timer);
  }, [active, loadHomeData, query]);

  useEffect(() => {
    if (active && (route.page === "detail" || route.page === "edit") && route.table) {
      loadDetailData(route.table);
    } else {
      setDetailAsset(null);
      setDetailFields([]);
      setDetailDDL({
        ddl: "",
        ddlDialect: "postgresql",
        ddlDialectLabel: "PostgreSQL SQL",
      });
      setDetailError("");
      setDetailLoading(false);
    }
  }, [active, route, loadDetailData]);

  const assetBack = useSmartBack({
    moduleKey: "dwm",
    onRestore: restoreNavigationSnapshot,
    onFallback: () => {
      setQuery("");
      setRoute(getModuleListRoute("dwm"));
      scrollMainToTop();
    },
  });

  const assetOpen = (tableName) => {
    pushModuleNavigationState("dwm", buildNavigationSnapshot());
    setDetailTab(DEFAULT_DETAIL_TAB);
    setRoute(getModuleDetailRoute("dwm", tableName));
    scrollMainToTop();
  };

  const assetGoList = useCallback(() => {
    clearModuleNavigationState("dwm");
    setRoute(getModuleListRoute("dwm"));
    scrollMainToTop();
  }, [setRoute]);

  const assetGoDetail = useCallback((tableName) => {
    if (!tableName) {
      setRoute(getModuleListRoute("dwm"));
      scrollMainToTop();
      return;
    }
    setDetailTab(DEFAULT_DETAIL_TAB);
    setRoute(getModuleDetailRoute("dwm", tableName));
    scrollMainToTop();
  }, [setRoute]);

  const assetCreate = () => {
    requireLogin(() => {
      pushModuleNavigationState("dwm", buildNavigationSnapshot());
      setRoute(getModuleEditRoute("dwm"));
      scrollMainToTop();
    }, "asset:write");
  };

  const assetEdit = (tableName) => {
    requireLogin(() => {
      setRoute(getModuleEditRoute("dwm", tableName));
      scrollMainToTop();
    }, "asset:write");
  };

  const handleSaveTable = async (table, oldName) => {
    await runProtectedMutation(async () => {
      await saveAssetTable(table, oldName);
      facetCacheRef.current.clear();
      await loadHomeData();
      setRoute(getModuleDetailRoute("dwm", table.name));
      setDetailTab(DEFAULT_DETAIL_TAB);
      scrollMainToTop();
    }, "保存表失败。", "asset:write");
  };

  const handleDeleteTable = async (tableName) => {
    await runProtectedMutation(async () => {
      await deleteAssetTable(tableName);
      facetCacheRef.current.clear();
      await loadHomeData();
      clearModuleNavigationState("dwm");
      setQuery("");
      setRoute(getModuleListRoute("dwm"));
      scrollMainToTop();
    }, "删除表失败。", "asset:write");
  };

  const resetAssetNavigation = useCallback(() => {
    clearModuleNavigationState("dwm");
    setQuery("");
    setRoute(getModuleListRoute("dwm"));
    setLayout(DEFAULT_LAYOUT);
    setDomain(null);
    setSelectedLayer(null);
    setDetailTab(DEFAULT_DETAIL_TAB);
  }, [setQuery, setRoute]);

  const domainCounts = useMemo(() => domains.reduce((acc, item) => {
    const name = item.name || item;
    acc[name] = Number(item.count) || 0;
    return acc;
  }, {}), [domains]);

  const layerCounts = useMemo(() => layers.reduce((acc, item) => {
    const layer = getAssetLayerValue(item) || item.code;
    if (!layer) return acc;
    acc[layer] = Number(item.count) || 0;
    return acc;
  }, {}), [layers]);

  const filteredTables = tables;

  const visibleDomains = useMemo(() => {
    const domainNames = domains.map((item) => item.name || item);
    const allNames = new Set([...DOMAIN_ORDER, ...domainNames]);
    return [...allNames].filter((name) => domainCounts[name]);
  }, [domains, domainCounts]);

  const visibleLayers = useMemo(() => {
    const sourceLayers = layers.length
      ? layers.map((item) => ({
        ...item,
        code: getAssetLayerValue(item) || item.code,
      }))
      : LAYER_OPTIONS;

    return sourceLayers.map((item) => ({
      ...item,
      active: selectedLayer === item.code,
      count: layerCounts[item.code] || item.count || 0,
    }));
  }, [layers, layerCounts, selectedLayer]);

  const editingAsset = useMemo(() => {
    if (route.page !== "edit" || !route.table) return null;
    return detailAsset?.name === route.table
      ? detailAsset
      : tables.find((table) => table.name === route.table);
  }, [route, tables, detailAsset]);

  const existingNames = useMemo(() => tables.map((table) => table.name), [tables]);

  return {
    tables,
    domains,
    layers,
    homeLoading,
    homeError,
    page,
    pageCount: Math.max(1, Math.ceil(totalTables / ASSET_PAGE_SIZE)),
    setPage,
    totalTables,
    loadHomeData,
    detailAsset,
    detailFields,
    detailDDL,
    detailLoading,
    detailError,
    loadDetailData,
    layout,
    setLayout,
    domain,
    setDomain,
    selectedLayer,
    setSelectedLayer,
    detailTab,
    setDetailTab,
    assetBack,
    assetOpen,
    assetGoList,
    assetGoDetail,
    assetCreate,
    assetEdit,
    handleSaveTable,
    handleDeleteTable,
    resetAssetNavigation,
    domainCounts,
    layerCounts,
    filteredTables,
    visibleDomains,
    visibleLayers,
    editingAsset,
    existingNames,
  };
}
