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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  deleteAssetTable,
  getAssetDDL,
  getAssetDetail,
  getAssetTablePage,
  getDomains,
  getLayers,
  saveAssetTable,
  type AssetTableItem,
  type AssetTableField,
  type DomainCountItem,
  type LayerCountItem,
} from '../api/assets.ts';
import { DOMAIN_ORDER, LAYER_OPTIONS } from '../config/assets.ts';
import {
  DEFAULT_DETAIL_TAB,
  DEFAULT_LAYOUT,
} from '../config/defaults.ts';
import {
  clearModuleNavigationState,
  getModuleDetailRoute,
  getModuleEditRoute,
  getModuleListRoute,
  MODULE_META,
  pushModuleNavigationState,
} from '../routing/navigation.ts';
import { useSmartBack } from './useSmartBack.ts';
import { getAssetLayerValue } from '../utils/assetFilters.ts';
import { getErrorMessage, scrollMainToTop } from '../utils/ui.ts';
import type { DDLNormalizedResult } from '../utils/ddlDialect.ts';
import type { AssetRoute } from '../routing/types.ts';

const ASSET_PAGE_SIZE = 20;

export interface AssetNavigationSnapshot {
  route: AssetRoute;
  query: string;
  layout: string;
  domain: string | null;
  selectedLayer: string | null;
  detailTab: string;
}

export interface UseAssetModuleProps {
  active?: boolean | undefined;
  query: string;
  setQuery: (query: string) => void;
  route: AssetRoute;
  setRoute: (route: AssetRoute) => void;
  initialLayout?: string | undefined;
  initialDomain?: string | null | undefined;
  initialSelectedLayer?: string | null | undefined;
  initialDetailTab?: string | undefined;
  requireLogin: (action: () => void, permission?: string) => boolean;
  runProtectedMutation: (
    task: () => Promise<unknown>,
    fallbackMessage?: string,
    permission?: string,
  ) => Promise<boolean>;
}

export interface ActiveLayerCountItem extends LayerCountItem {
  active: boolean;
}

export interface UseAssetModuleResult {
  tables: AssetTableItem[];
  domains: DomainCountItem[];
  layers: LayerCountItem[];
  homeLoading: boolean;
  homeError: string;
  page: number;
  pageCount: number;
  setPage: React.Dispatch<React.SetStateAction<number>>;
  totalTables: number;
  loadHomeData: () => Promise<void>;
  detailAsset: AssetTableItem | null;
  detailFields: AssetTableField[];
  detailDDL: DDLNormalizedResult;
  detailLoading: boolean;
  detailError: string;
  loadDetailData: (tableName: string) => Promise<void>;
  layout: string;
  setLayout: React.Dispatch<React.SetStateAction<string>>;
  domain: string | null;
  setDomain: React.Dispatch<React.SetStateAction<string | null>>;
  selectedLayer: string | null;
  setSelectedLayer: React.Dispatch<React.SetStateAction<string | null>>;
  detailTab: string;
  setDetailTab: React.Dispatch<React.SetStateAction<string>>;
  assetBack: () => void;
  assetOpen: (tableName: string) => void;
  assetGoList: () => void;
  assetGoDetail: (tableName: string) => void;
  assetCreate: () => void;
  assetEdit: (tableName: string) => void;
  handleSaveTable: (table: AssetTableItem, oldName?: string) => Promise<void>;
  handleDeleteTable: (tableName: string) => Promise<void>;
  resetAssetNavigation: () => void;
  domainCounts: Record<string, number>;
  layerCounts: Record<string, number>;
  filteredTables: AssetTableItem[];
  visibleDomains: string[];
  visibleLayers: ActiveLayerCountItem[];
  editingAsset: AssetTableItem | null | undefined;
  existingNames: string[];
}

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
}: UseAssetModuleProps): UseAssetModuleResult {
  const [tables, setTables] = useState<AssetTableItem[]>([]);
  const [domains, setDomains] = useState<DomainCountItem[]>([]);
  const [layers, setLayers] = useState<LayerCountItem[]>([]);
  const [homeLoading, setHomeLoading] = useState(false);
  const [homeError, setHomeError] = useState('');
  const [page, setPage] = useState(1);
  const [totalTables, setTotalTables] = useState(0);
  const homeRequestRef = useRef(0);
  const facetCacheRef = useRef(new Map<string, Promise<[DomainCountItem[], LayerCountItem[]]>>());

  const [detailAsset, setDetailAsset] = useState<AssetTableItem | null>(null);
  const [detailFields, setDetailFields] = useState<AssetTableField[]>([]);
  const [detailDDL, setDetailDDL] = useState<DDLNormalizedResult>({
    ddl: '',
    ddlDialect: 'postgresql',
    ddlDialectLabel: 'PostgreSQL SQL',
  });
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

  const [layout, setLayout] = useState(initialLayout);
  const [domain, setDomain] = useState(initialDomain);
  const [selectedLayer, setSelectedLayer] = useState(initialSelectedLayer);
  const [detailTab, setDetailTab] = useState(initialDetailTab);

  const buildNavigationSnapshot = useCallback(
    (): AssetNavigationSnapshot => ({
      route,
      query,
      layout,
      domain,
      selectedLayer,
      detailTab,
    }),
    [detailTab, domain, layout, query, route, selectedLayer],
  );

  const restoreNavigationSnapshot = useCallback(
    (snapshot: AssetNavigationSnapshot) => {
      setQuery(snapshot?.query || '');
      setLayout(snapshot?.layout || DEFAULT_LAYOUT);
      setDomain(snapshot?.domain || null);
      setSelectedLayer(snapshot?.selectedLayer || null);
      setDetailTab(snapshot?.detailTab || DEFAULT_DETAIL_TAB);
      setRoute(snapshot?.route || (MODULE_META.dwm.defaultRoute as AssetRoute));
      scrollMainToTop();
    },
    [setQuery, setRoute],
  );

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

  const loadHomeData = useCallback(async (): Promise<void> => {
    const requestId = ++homeRequestRef.current;
    setHomeLoading(true);
    setHomeError('');
    try {
      const facetKey = JSON.stringify([selectedLayer || '', domain || '']);
      if (!facetCacheRef.current.has(facetKey)) {
        const facetPromise = Promise.all([
          getDomains({ layer: selectedLayer || undefined }),
          getLayers({ domain: domain || undefined }),
        ]).catch((error: unknown) => {
          facetCacheRef.current.delete(facetKey);
          throw error;
        });
        facetCacheRef.current.set(facetKey, facetPromise);
      }
      const facetCached = facetCacheRef.current.get(facetKey);
      const [tablePage, [domainList, layerList]] = await Promise.all([
        getAssetTablePage({
          page,
          pageSize: ASSET_PAGE_SIZE,
          keyword: query.trim() || undefined,
          domain: domain || undefined,
          layer: selectedLayer || undefined,
        }),
        facetCached || Promise.all([getDomains(), getLayers()]),
      ]);
      if (requestId !== homeRequestRef.current) return;
      setTables(tablePage.items);
      setTotalTables(tablePage.total);
      setDomains(domainList);
      setLayers(layerList);
    } catch (error: unknown) {
      if (requestId !== homeRequestRef.current) return;
      setHomeError(getErrorMessage(error, '资产元数据加载失败。'));
    } finally {
      if (requestId === homeRequestRef.current) setHomeLoading(false);
    }
  }, [domain, page, query, selectedLayer]);

  const loadDetailData = useCallback(async (tableName: string): Promise<void> => {
    setDetailLoading(true);
    setDetailError('');
    try {
      const [asset, ddlData] = await Promise.all([getAssetDetail(tableName), getAssetDDL(tableName)]);
      setDetailAsset(asset);
      setDetailFields(asset.fields || []);
      setDetailDDL(ddlData);
    } catch (error: unknown) {
      setDetailAsset(null);
      setDetailFields([]);
      setDetailDDL({
        ddl: '',
        ddlDialect: 'postgresql',
        ddlDialectLabel: 'PostgreSQL SQL',
      });
      setDetailError(getErrorMessage(error, '资产详情加载失败。'));
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
    if (active && (route.page === 'detail' || route.page === 'edit') && route.table) {
      loadDetailData(route.table);
    } else {
      setDetailAsset(null);
      setDetailFields([]);
      setDetailDDL({
        ddl: '',
        ddlDialect: 'postgresql',
        ddlDialectLabel: 'PostgreSQL SQL',
      });
      setDetailError('');
      setDetailLoading(false);
    }
  }, [active, route, loadDetailData]);

  const assetBack = useSmartBack<AssetNavigationSnapshot>({
    moduleKey: 'dwm',
    onRestore: restoreNavigationSnapshot,
    onFallback: () => {
      setQuery('');
      setRoute(getModuleListRoute('dwm') as AssetRoute);
      scrollMainToTop();
    },
  });

  const assetOpen = (tableName: string): void => {
    pushModuleNavigationState('dwm', buildNavigationSnapshot());
    setDetailTab(DEFAULT_DETAIL_TAB);
    setRoute(getModuleDetailRoute('dwm', tableName) as AssetRoute);
    scrollMainToTop();
  };

  const assetGoList = useCallback((): void => {
    clearModuleNavigationState('dwm');
    setRoute(getModuleListRoute('dwm') as AssetRoute);
    scrollMainToTop();
  }, [setRoute]);

  const assetGoDetail = useCallback(
    (tableName: string): void => {
      if (!tableName) {
        setRoute(getModuleListRoute('dwm') as AssetRoute);
        scrollMainToTop();
        return;
      }
      setDetailTab(DEFAULT_DETAIL_TAB);
      setRoute(getModuleDetailRoute('dwm', tableName) as AssetRoute);
      scrollMainToTop();
    },
    [setRoute],
  );

  const assetCreate = (): void => {
    requireLogin(() => {
      pushModuleNavigationState('dwm', buildNavigationSnapshot());
      setRoute(getModuleEditRoute('dwm') as AssetRoute);
      scrollMainToTop();
    }, 'asset:write');
  };

  const assetEdit = (tableName: string): void => {
    requireLogin(() => {
      setRoute(getModuleEditRoute('dwm', tableName) as AssetRoute);
      scrollMainToTop();
    }, 'asset:write');
  };

  const handleSaveTable = async (table: AssetTableItem, oldName?: string): Promise<void> => {
    await runProtectedMutation(
      async () => {
        await saveAssetTable(table, oldName);
        facetCacheRef.current.clear();
        await loadHomeData();
        setRoute(getModuleDetailRoute('dwm', table.name) as AssetRoute);
        setDetailTab(DEFAULT_DETAIL_TAB);
        scrollMainToTop();
      },
      '保存表失败。',
      'asset:write',
    );
  };

  const handleDeleteTable = async (tableName: string): Promise<void> => {
    await runProtectedMutation(
      async () => {
        await deleteAssetTable(tableName);
        facetCacheRef.current.clear();
        await loadHomeData();
        clearModuleNavigationState('dwm');
        setQuery('');
        setRoute(getModuleListRoute('dwm') as AssetRoute);
        scrollMainToTop();
      },
      '删除表失败。',
      'asset:write',
    );
  };

  const resetAssetNavigation = useCallback((): void => {
    clearModuleNavigationState('dwm');
    setQuery('');
    setRoute(getModuleListRoute('dwm') as AssetRoute);
    setLayout(DEFAULT_LAYOUT);
    setDomain(null);
    setSelectedLayer(null);
    setDetailTab(DEFAULT_DETAIL_TAB);
  }, [setQuery, setRoute]);

  const domainCounts = useMemo<Record<string, number>>(
    () =>
      domains.reduce<Record<string, number>>((acc, item) => {
        const name = item.name || '';
        acc[name] = Number(item.count) || 0;
        return acc;
      }, {}),
    [domains],
  );

  const layerCounts = useMemo<Record<string, number>>(
    () =>
      layers.reduce<Record<string, number>>((acc, item) => {
        const layer = getAssetLayerValue(item) || item.code;
        if (!layer) return acc;
        acc[layer] = Number(item.count) || 0;
        return acc;
      }, {}),
    [layers],
  );

  const filteredTables = tables;

  const visibleDomains = useMemo<string[]>(() => {
    const domainNames = domains.map((item) => item.name);
    const allNames = new Set([...DOMAIN_ORDER, ...domainNames]);
    return [...allNames].filter((name) => domainCounts[name]);
  }, [domains, domainCounts]);

  const visibleLayers = useMemo<ActiveLayerCountItem[]>(() => {
    const sourceLayers = layers.length
      ? layers.map((item) => ({
          ...item,
          code: getAssetLayerValue(item) || item.code,
        }))
      : LAYER_OPTIONS.map((layer) => ({ ...layer, count: 0 }));

    return sourceLayers.map((item) => ({
      ...item,
      active: selectedLayer === item.code,
      count: layerCounts[item.code] || item.count || 0,
    }));
  }, [layers, layerCounts, selectedLayer]);

  const editingAsset = useMemo(() => {
    if (route.page !== 'edit' || !route.table) return null;
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
