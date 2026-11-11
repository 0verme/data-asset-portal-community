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
  createIndicator,
  deleteIndicator,
  getIndicatorDimensions,
  getIndicatorDetail,
  getIndicatorPage,
  type IndicatorPageResult,
  updateIndicator,
  updateIndicatorStatus,
} from '../api/indicator.ts';
import type { IndicatorDimensionOption, MockIndicatorItem } from '../data/indicators.ts';
import {
  buildIndicatorDimensionOptions,
  type IndicatorDimensionCatalogEntry,
} from '../data/indicatorDimensions.ts';
import { isUnauthorizedError } from '../api/http.ts';
import { DEFAULT_INDICATOR_ROUTE } from '../config/defaults.ts';
import { getErrorMessage, scrollMainToTop } from '../utils/ui.ts';
import type { IndicatorFilter, IndicatorRoute } from '../routing/types.ts';

export interface IndicatorFacets {
  dimension: Record<string, number>;
  status: Record<string, number>;
}

export interface UseIndicatorModuleProps {
  active?: boolean | undefined;
  query: string;
  indicatorRoute: IndicatorRoute;
  setIndicatorRoute: (route: IndicatorRoute) => void;
  indicatorFilter: IndicatorFilter;
  canEdit: boolean;
  requireLogin: (action: () => void, permission?: string) => boolean;
  setAuthError: (error: string) => void;
  setLoginOpen: (open: boolean) => void;
}

export interface UseIndicatorModuleResult {
  indicators: MockIndicatorItem[];
  indicatorLoading: boolean;
  indicatorError: string;
  indicatorLoaded: boolean;
  indicatorTotal: number;
  indicatorCount: number;
  indicatorPage: number;
  setIndicatorPage: React.Dispatch<React.SetStateAction<number>>;
  indicatorPageSize: number;
  setIndicatorPageSize: React.Dispatch<React.SetStateAction<number>>;
  indicatorSort: string;
  setIndicatorSort: React.Dispatch<React.SetStateAction<string>>;
  indicatorDetailLoading: boolean;
  indicatorDetailError: string;
  retryIndicatorDetail: () => void;
  loadIndicatorData: () => Promise<void>;
  indicatorPendingIds: string[];
  indicatorSaveBusy: boolean;
  indicatorSaveError: string;
  setIndicatorSaveError: React.Dispatch<React.SetStateAction<string>>;
  indicatorActionError: string;
  setIndicatorActionError: React.Dispatch<React.SetStateAction<string>>;
  indicatorBack: () => void;
  indicatorCloseDetail: () => void;
  indicatorCreate: () => void;
  indicatorEdit: (indicatorId: string) => void;
  indicatorViewDetail: (indicatorId: string) => void;
  handleSaveIndicator: (payload: MockIndicatorItem) => Promise<void>;
  handleDeleteIndicator: (indicatorId?: string) => Promise<void>;
  handleToggleIndicatorStatus: (indicator: MockIndicatorItem) => Promise<void>;
  indicatorFacets: IndicatorFacets;
  indicatorDimensions: IndicatorDimensionOption[];
  filteredIndicators: MockIndicatorItem[];
  currentIndicatorEdit: MockIndicatorItem | null;
  currentIndicatorDetail: MockIndicatorItem | null;
  canEdit: boolean;
}

export function useIndicatorModule({
  active,
  query,
  indicatorRoute,
  setIndicatorRoute,
  indicatorFilter,
  canEdit,
  requireLogin,
  setAuthError,
  setLoginOpen,
}: UseIndicatorModuleProps): UseIndicatorModuleResult {
  const [indicators, setIndicators] = useState<MockIndicatorItem[]>([]);
  const [indicatorDimensionCatalog, setIndicatorDimensionCatalog] = useState<
    IndicatorDimensionCatalogEntry[]
  >([]);
  const [indicatorLoading, setIndicatorLoading] = useState(false);
  const [indicatorError, setIndicatorError] = useState('');
  const [indicatorLoaded, setIndicatorLoaded] = useState(false);
  const [indicatorPendingIds, setIndicatorPendingIds] = useState<string[]>([]);
  const [indicatorSaveBusy, setIndicatorSaveBusy] = useState(false);
  const [indicatorSaveError, setIndicatorSaveError] = useState('');
  const [indicatorActionError, setIndicatorActionError] = useState('');

  const [indicatorPage, setIndicatorPage] = useState(1);
  const [indicatorPageSize, setIndicatorPageSize] = useState(20);
  const [indicatorSort, setIndicatorSort] = useState('id:asc');
  const [pageData, setPageData] = useState<IndicatorPageResult | null>(null);
  const listSequence = useRef(0);
  const listKey = JSON.stringify([active, query, indicatorFilter, indicatorPage, indicatorPageSize, indicatorSort, canEdit]);
  const latestListKey = useRef(listKey);
  latestListKey.current = listKey;
  const [detail, setDetail] = useState<{ key: string; item: MockIndicatorItem | null; error: string }>({ key: '', item: null, error: '' });
  const [detailVersion, setDetailVersion] = useState(0);
  const detailKey = JSON.stringify([active, indicatorRoute.page, indicatorRoute.id, canEdit, detailVersion]);
  const latestDetailKey = useRef(detailKey);
  latestDetailKey.current = detailKey;
  const needsDetail = ['view', 'edit'].includes(indicatorRoute.page) && Boolean(indicatorRoute.id);
  const indicatorDetailLoading = needsDetail && detail.key !== detailKey;
  const indicatorDetailError = needsDetail && detail.key === detailKey ? detail.error : '';

  const loadIndicatorData = useCallback(async (): Promise<void> => {
    const sequence = ++listSequence.current;
    setIndicatorLoading(true);
    setIndicatorError('');
    try {
      const [result, dimensionCatalog] = await Promise.all([
        getIndicatorPage({
          keyword: query,
          dimension: indicatorFilter.dimension === 'all' || indicatorFilter.dimension === ''
            ? undefined
            : indicatorFilter.dimension,
          dimensionUnassigned: indicatorFilter.dimension === '',
          status: indicatorFilter.status === 'all' ? undefined : indicatorFilter.status,
          page: indicatorPage,
          pageSize: indicatorPageSize,
          sortKey: indicatorSort.split(':')[0],
          sortDirection: indicatorSort.split(':')[1],
        }),
        getIndicatorDimensions(),
      ]);
      if (sequence !== listSequence.current || latestListKey.current !== listKey) return;
      if (result.pageSize !== indicatorPageSize) setIndicatorPageSize(result.pageSize);
      const lastPage = Math.max(1, Math.ceil(result.total / result.pageSize));
      if (indicatorPage > lastPage) {
        setIndicators([]);
        setPageData(result);
        setIndicatorPage(lastPage);
        return;
      }
      setIndicators(result.items);
      setPageData(result);
      setIndicatorDimensionCatalog(dimensionCatalog);
      setIndicatorLoaded(true);
    } catch (error: unknown) {
      if (sequence === listSequence.current && latestListKey.current === listKey) {
        setIndicatorError(getErrorMessage(error, '指标数据加载失败。'));
      }
    } finally {
      if (sequence === listSequence.current && latestListKey.current === listKey) setIndicatorLoading(false);
    }
  }, [query, indicatorFilter, indicatorPage, indicatorPageSize, indicatorSort, listKey]);
  const reloadRef = useRef(loadIndicatorData);
  reloadRef.current = loadIndicatorData;

  useEffect(() => {
    if (active) void loadIndicatorData();
    return () => { listSequence.current += 1; };
  }, [active, loadIndicatorData]);

  useEffect(() => {
    setIndicatorPage(1);
  }, [query, indicatorFilter, indicatorPageSize, indicatorSort]);

  useEffect(() => {
    if (!active || !needsDetail || !indicatorRoute.id) return;
    let cancelled = false;
    void getIndicatorDetail(indicatorRoute.id).then((item) => {
      if (!cancelled && latestDetailKey.current === detailKey) {
        setDetail({ key: detailKey, item, error: '' });
      }
    }).catch((error: unknown) => {
      if (!cancelled && latestDetailKey.current === detailKey) {
        setDetail({ key: detailKey, item: null, error: getErrorMessage(error, '指标详情加载失败。') });
      }
    });
    return () => { cancelled = true; };
  }, [active, needsDetail, indicatorRoute.id, detailKey]);

  const indicatorBack = (): void => {
    setIndicatorRoute(DEFAULT_INDICATOR_ROUTE);
    scrollMainToTop();
  };

  const indicatorCloseDetail = (): void => {
    setIndicatorRoute(DEFAULT_INDICATOR_ROUTE);
  };

  const indicatorCreate = (): void => {
    requireLogin(() => {
      setIndicatorRoute({ page: 'new', id: null });
      scrollMainToTop();
    }, 'indicator:write');
  };

  const indicatorEdit = (indicatorId: string): void => {
    requireLogin(() => {
      setIndicatorRoute({ page: 'edit', id: indicatorId });
      scrollMainToTop();
    }, 'indicator:write');
  };

  const indicatorViewDetail = (indicatorId: string): void => {
    setIndicatorRoute({ page: 'view', id: indicatorId });
  };

  const handleSaveIndicator = async (payload: MockIndicatorItem): Promise<void> => {
    if (!canEdit) {
      setAuthError('');
      setLoginOpen(true);
      return;
    }
    if (indicatorSaveBusy) return;
    setIndicatorSaveError('');
    setIndicatorActionError('');
    setIndicatorSaveBusy(true);
    try {
      if (indicatorRoute.page === 'edit' && indicatorRoute.id) {
        await updateIndicator(indicatorRoute.id, payload);
      } else {
        await createIndicator(payload);
      }
      await reloadRef.current();
      setIndicatorSaveError('');
      setIndicatorRoute(DEFAULT_INDICATOR_ROUTE);
      scrollMainToTop();
    } catch (error: unknown) {
      if (!isUnauthorizedError(error)) {
        setIndicatorSaveError(getErrorMessage(error, '保存指标失败。'));
      }
    } finally {
      setIndicatorSaveBusy(false);
    }
  };

  const handleDeleteIndicator = async (indicatorId?: string): Promise<void> => {
    if (!indicatorId) return;
    if (!canEdit) {
      setAuthError('');
      setLoginOpen(true);
      return;
    }
    setIndicatorActionError('');
    try {
      await deleteIndicator(indicatorId);
      await reloadRef.current();
      if (indicatorRoute.id === indicatorId) {
        setIndicatorRoute(DEFAULT_INDICATOR_ROUTE);
      }
      scrollMainToTop();
    } catch (error: unknown) {
      if (!isUnauthorizedError(error)) {
        setIndicatorActionError(getErrorMessage(error, '删除指标失败。'));
      }
    }
  };

  const handleToggleIndicatorStatus = async (indicator: MockIndicatorItem): Promise<void> => {
    if (!canEdit) {
      setAuthError('');
      setLoginOpen(true);
      return;
    }
    setIndicatorActionError('');
    const nextStatus = indicator.status === 'enabled' ? 'disabled' : 'enabled';
    setIndicatorPendingIds((prev) => (prev.includes(indicator.id) ? prev : [...prev, indicator.id]));
    setIndicators((prev) => prev.map((item) => (item.id === indicator.id ? { ...item, status: nextStatus } : item)));

    try {
      const updated = await updateIndicatorStatus(indicator.id, nextStatus);
      setDetail((previous) => previous.item?.id === indicator.id ? { ...previous, item: updated } : previous);
      await reloadRef.current();
    } catch (error: unknown) {
      if (!isUnauthorizedError(error)) {
        setIndicatorActionError(getErrorMessage(error, '更新指标状态失败。'));
      }
      setIndicators((prev) => prev.map((item) => (item.id === indicator.id ? indicator : item)));
    } finally {
      setIndicatorPendingIds((prev) => prev.filter((id) => id !== indicator.id));
    }
  };

  const indicatorFacets = pageData?.facets || { dimension: {}, status: {} };
  const indicatorDimensions = useMemo(
    () => buildIndicatorDimensionOptions(indicatorDimensionCatalog, indicatorFacets.dimension),
    [indicatorDimensionCatalog, indicatorFacets.dimension],
  );
  const filteredIndicators = indicators;
  const current = detail.key === detailKey ? detail.item : null;
  const currentIndicatorEdit = indicatorRoute.page === 'edit' ? current : null;
  const currentIndicatorDetail = indicatorRoute.page === 'view' ? current : null;

  return {
    indicators,
    indicatorLoading,
    indicatorError,
    indicatorLoaded,
    indicatorTotal: pageData?.total || 0,
    indicatorCount: pageData?.stats.indicatorCount || 0,
    indicatorPage, setIndicatorPage, indicatorPageSize, setIndicatorPageSize,
    indicatorSort, setIndicatorSort, indicatorDetailLoading, indicatorDetailError,
    retryIndicatorDetail: () => setDetailVersion((version) => version + 1),
    loadIndicatorData,
    indicatorPendingIds,
    indicatorSaveBusy,
    indicatorSaveError,
    setIndicatorSaveError,
    indicatorActionError,
    setIndicatorActionError,
    indicatorBack,
    indicatorCloseDetail,
    indicatorCreate,
    indicatorEdit,
    indicatorViewDetail,
    handleSaveIndicator,
    handleDeleteIndicator,
    handleToggleIndicatorStatus,
    indicatorFacets,
    indicatorDimensions,
    filteredIndicators,
    currentIndicatorEdit,
    currentIndicatorDetail,
    canEdit,
  };
}
