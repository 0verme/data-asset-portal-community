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
  deleteUpstreamSystem,
  getUpstreamSystem,
  getUpstreamSystemAdminDetail,
  getUpstreamSystemPage,
  type UpstreamSystemPage,
  patchUpstreamStatus,
  saveUpstreamSystem,
  type PublicUpstreamSystem,
} from '../api/upstream.ts';
import type { MockUpstreamSystem } from '../data/upstreamSystems.ts';
import { isUnauthorizedError } from '../api/http.ts';
import { toast } from '../components/common/index.ts';
import {
  DEFAULT_UP_FILTER,
  DEFAULT_UP_VIEW,
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
import {
  UPSTREAM_DB_TYPE_OPTIONS,
  UPSTREAM_DEPT_OPTIONS,
} from '../data/commonCodes.ts';
import { normalizeDictOptions, type DictOption } from '../utils/optionUtils.ts';
import { getErrorMessage, scrollMainToTop } from '../utils/ui.ts';
import {
  isSameUpstreamField,
  normalizeUpstreamApiError,
  type UpstreamFormError,
} from '../components/upstream/upstreamFormErrors.ts';
import type { UpstreamFilter, UpstreamRoute } from '../routing/types.ts';

function fallbackOptions(values: readonly unknown[]): DictOption[] {
  const seen = new Set<string>();
  return normalizeDictOptions(values as string[]).filter((item) => {
    if (seen.has(item.value)) return false;
    seen.add(item.value);
    return true;
  });
}

export interface UpstreamNavigationSnapshot {
  query?: string | undefined;
  upRoute?: UpstreamRoute | undefined;
  upFilter?: UpstreamFilter | undefined;
  upstreamView?: string | undefined;
}

export interface UseUpstreamModuleProps {
  active?: boolean | undefined;
  query: string;
  setQuery: (query: string) => void;
  upRoute: UpstreamRoute;
  setUpRoute: (route: UpstreamRoute) => void;
  initialView?: string | undefined;
  initialFilter?: UpstreamFilter | undefined;
  canEdit: boolean;
  requireLogin?: ((action: () => void, permission?: string) => boolean) | undefined;
  runProtectedMutation: (
    task: () => Promise<unknown>,
    fallbackMessage?: string,
    permission?: string,
  ) => Promise<boolean>;
  setAuthError: (error: string) => void;
  setLoginOpen: (open: boolean) => void;
}

export interface UseUpstreamModuleResult {
  upstreamSystems: PublicUpstreamSystem[];
  upstreamPage: number;
  upstreamPageSize: number;
  upstreamTotal: number;
  upstreamSystemCount: number;
  upstreamFacets: UpstreamSystemPage['facets'];
  upstreamSort: string;
  setUpstreamPage: React.Dispatch<React.SetStateAction<number>>;
  setUpstreamPageSize: React.Dispatch<React.SetStateAction<number>>;
  setUpstreamSort: React.Dispatch<React.SetStateAction<string>>;
  upstreamDbTypes: DictOption[];
  upstreamDeptOptions: DictOption[];
  currentUpstream: PublicUpstreamSystem | MockUpstreamSystem | null;
  upstreamPendingIds: string[];
  upstreamLoading: boolean;
  upstreamDetailLoading: boolean;
  upstreamError: string;
  upstreamSaveError: string;
  upstreamSaveFieldErrors: UpstreamFormError[];
  clearUpstreamSaveError: (field?: string) => void;
  upstreamLoaded: boolean;
  upstreamView: string;
  setUpstreamView: React.Dispatch<React.SetStateAction<string>>;
  loadUpstreamData: () => Promise<void>;
  loadUpstreamDetail: (systemId: string) => Promise<void>;
  upFilter: UpstreamFilter;
  setUpFilter: React.Dispatch<React.SetStateAction<UpstreamFilter>>;
  upBack: () => void;
  upGoList: () => void;
  upGoDetail: (systemId: string) => void;
  upGoEdit: (systemId: string) => void;
  upOpen: (systemId: string) => void;
  resetUpstreamNavigation: () => void;
  handleSaveUpstream: (system: MockUpstreamSystem, oldId?: string) => Promise<boolean>;
  handleDeleteUpstream: (systemId: string) => Promise<void>;
  handleToggleUpstream: (systemId: string, status: string) => Promise<void>;
  filteredUpstreamSystems: PublicUpstreamSystem[];
  currentUpstreamEdit: PublicUpstreamSystem | MockUpstreamSystem | null | undefined;
}

export function useUpstreamModule({
  active,
  query,
  setQuery,
  upRoute,
  setUpRoute,
  initialView = DEFAULT_UP_VIEW,
  initialFilter = DEFAULT_UP_FILTER,
  canEdit,
  requireLogin: _requireLogin,
  runProtectedMutation,
  setAuthError,
  setLoginOpen,
}: UseUpstreamModuleProps): UseUpstreamModuleResult {
  const [upstreamSystems, setUpstreamSystems] = useState<PublicUpstreamSystem[]>([]);
  const [upstreamDbTypes, setUpstreamDbTypes] = useState<DictOption[]>([]);
  const [upstreamDeptOptions, setUpstreamDeptOptions] = useState<DictOption[]>([]);
  const [currentUpstream, setCurrentUpstream] = useState<PublicUpstreamSystem | MockUpstreamSystem | null>(null);
  const [upstreamPendingIds, setUpstreamPendingIds] = useState<string[]>([]);
  const [upstreamLoading, setUpstreamLoading] = useState(false);
  const [upstreamDetailLoading, setUpstreamDetailLoading] = useState(false);
  const [upstreamDetailPage, setUpstreamDetailPage] = useState<string | null>(null);
  const [upstreamError, setUpstreamError] = useState('');
  const [upstreamListError, setUpstreamListError] = useState('');
  const [upstreamSaveError, setUpstreamSaveError] = useState('');
  const [upstreamSaveFieldErrors, setUpstreamSaveFieldErrors] = useState<UpstreamFormError[]>([]);
  const upstreamSaveRawErrorRef = useRef('');
  const clearUpstreamSaveError = useCallback((field?: string): void => {
    setUpstreamSaveError('');
    upstreamSaveRawErrorRef.current = '';
    setUpstreamSaveFieldErrors((previous) => {
      if (!field) return [];
      return previous.filter((item) => !isSameUpstreamField(item.field, field));
    });
  }, []);
  const [upstreamLoaded, setUpstreamLoaded] = useState(false);
  const [upstreamView, setUpstreamView] = useState(initialView);
  const [upFilter, setUpFilter] = useState(initialFilter);
  const [upstreamPage, setUpstreamPage] = useState(1);
  const [upstreamPageSize, setUpstreamPageSize] = useState(20);
  const [upstreamSort, setUpstreamSort] = useState('abbr:asc');
  const [upstreamPageData, setUpstreamPageData] = useState<UpstreamSystemPage | null>(null);
  const upstreamListSequence = useRef(0);
  const upstreamDetailSequence = useRef(0);
  const listKey = JSON.stringify([query, upFilter.status, upFilter.dbType, upstreamPage, upstreamPageSize, upstreamSort, canEdit]);
  const latestListKey = useRef(listKey);
  latestListKey.current = listKey;

  const buildNavigationSnapshot = useCallback(
    (): UpstreamNavigationSnapshot => ({
      query,
      upRoute,
      upFilter,
      upstreamView,
    }),
    [query, upFilter, upRoute, upstreamView],
  );

  const restoreNavigationSnapshot = useCallback(
    (snapshot: UpstreamNavigationSnapshot) => {
      setQuery(snapshot?.query || '');
      setUpFilter(snapshot?.upFilter || DEFAULT_UP_FILTER);
      setUpstreamView(snapshot?.upstreamView || DEFAULT_UP_VIEW);
      setUpRoute(snapshot?.upRoute || (MODULE_META.upstream.defaultRoute as UpstreamRoute));
      clearUpstreamSaveError();
      scrollMainToTop();
    },
    [clearUpstreamSaveError, setQuery, setUpRoute],
  );

  const loadUpstreamData = useCallback(async (): Promise<void> => {
    const sequence = ++upstreamListSequence.current;
    setUpstreamLoading(true);
    setUpstreamListError('');
    try {
      const result = await getUpstreamSystemPage({
        keyword: query, status: upFilter.status || undefined, dbType: upFilter.dbType || undefined,
        page: upstreamPage, pageSize: upstreamPageSize,
        sortKey: upstreamSort.split(':')[0], sortDirection: upstreamSort.split(':')[1],
      });
      if (sequence !== upstreamListSequence.current || latestListKey.current !== listKey) return;
      if (result.pageSize !== upstreamPageSize) setUpstreamPageSize(result.pageSize);
      const lastPage = Math.max(1, Math.ceil(result.total / result.pageSize));
      if (upstreamPage > lastPage) {
        setUpstreamPage(lastPage);
        return;
      }
      setUpstreamPageData(result);
      setUpstreamSystems(result.items);
      setUpstreamDbTypes(fallbackOptions([...UPSTREAM_DB_TYPE_OPTIONS, ...result.options.dbTypes]));
      setUpstreamDeptOptions(fallbackOptions(import.meta.env.VITE_API_MODE === 'mock' ? [...UPSTREAM_DEPT_OPTIONS, ...result.options.depts] : result.options.depts));
      setUpstreamLoaded(true);
    } catch (error: unknown) {
      if (sequence === upstreamListSequence.current && latestListKey.current === listKey) {
        setUpstreamListError(getErrorMessage(error, '上游卸数系统加载失败。'));
      }
    } finally {
      if (sequence === upstreamListSequence.current && latestListKey.current === listKey) setUpstreamLoading(false);
    }
  }, [query, upFilter.status, upFilter.dbType, upstreamPage, upstreamPageSize, upstreamSort, listKey]);
  const upstreamReloadRef = useRef(loadUpstreamData);
  upstreamReloadRef.current = loadUpstreamData;

  const loadUpstreamDetail = useCallback(
    async (systemId: string): Promise<void> => {
      const sequence = ++upstreamDetailSequence.current;
      setCurrentUpstream(null);
      setUpstreamDetailPage(null);
      setUpstreamDetailLoading(true);
      setUpstreamError('');
      try {
        const detail = await (upRoute.page === 'edit'
          ? getUpstreamSystemAdminDetail(systemId)
          : getUpstreamSystem(systemId));
        if (sequence === upstreamDetailSequence.current) {
          setCurrentUpstream(detail);
          setUpstreamDetailPage(upRoute.page);
        }
      } catch (error: unknown) {
        if (sequence === upstreamDetailSequence.current) {
          setCurrentUpstream(null);
          setUpstreamError(getErrorMessage(error, '上游卸数系统详情加载失败。'));
        }
      } finally {
        if (sequence === upstreamDetailSequence.current) setUpstreamDetailLoading(false);
      }
    },
    [upRoute.page],
  );

  useEffect(() => {
    if (active) void loadUpstreamData();
    return () => { upstreamListSequence.current += 1; };
  }, [active, loadUpstreamData]);

  useEffect(() => {
    setUpstreamPage(1);
  }, [query, upFilter.status, upFilter.dbType, upstreamPageSize, upstreamSort]);

  useEffect(() => {
    setUpstreamView(initialView || DEFAULT_UP_VIEW);
  }, [initialView]);

  useEffect(() => {
    setUpFilter(initialFilter || DEFAULT_UP_FILTER);
  }, [initialFilter]);

  useEffect(() => {
    if (active && (upRoute.page === 'detail' || upRoute.page === 'edit') && upRoute.id) {
      loadUpstreamDetail(upRoute.id);
    } else {
      setCurrentUpstream(null);
      setUpstreamDetailLoading(false);
    }
    return () => { upstreamDetailSequence.current += 1; };
  }, [active, upRoute, loadUpstreamDetail, canEdit]);

  const upBack = useSmartBack<UpstreamNavigationSnapshot>({
    moduleKey: 'upstream',
    onRestore: restoreNavigationSnapshot,
    onFallback: () => {
      setQuery('');
      setUpFilter(DEFAULT_UP_FILTER);
      clearUpstreamSaveError();
      setUpRoute(getModuleListRoute('upstream') as UpstreamRoute);
      scrollMainToTop();
    },
  });

  const resetUpstreamNavigation = useCallback((): void => {
    clearModuleNavigationState('upstream');
    setQuery('');
    setUpstreamView(DEFAULT_UP_VIEW);
    setUpFilter(DEFAULT_UP_FILTER);
    clearUpstreamSaveError();
    setUpRoute(getModuleListRoute('upstream') as UpstreamRoute);
  }, [clearUpstreamSaveError, setQuery, setUpRoute]);

  const upGoList = useCallback((): void => {
    clearModuleNavigationState('upstream');
    clearUpstreamSaveError();
    setUpRoute(getModuleListRoute('upstream') as UpstreamRoute);
    scrollMainToTop();
  }, [clearUpstreamSaveError, setUpRoute]);

  const upGoDetail = useCallback(
    (systemId: string): void => {
      clearUpstreamSaveError();
      setUpRoute(getModuleDetailRoute('upstream', systemId) as UpstreamRoute);
      scrollMainToTop();
    },
    [clearUpstreamSaveError, setUpRoute],
  );

  const upGoEdit = useCallback(
    (systemId: string): void => {
      clearUpstreamSaveError();
      setUpRoute(getModuleEditRoute('upstream', systemId) as UpstreamRoute);
      scrollMainToTop();
    },
    [clearUpstreamSaveError, setUpRoute],
  );

  const upOpen = (systemId: string): void => {
    pushModuleNavigationState('upstream', buildNavigationSnapshot());
    clearUpstreamSaveError();
    setUpRoute(getModuleDetailRoute('upstream', systemId) as UpstreamRoute);
    scrollMainToTop();
  };

  const handleSaveUpstream = async (system: MockUpstreamSystem, oldId?: string): Promise<boolean> => {
    if (!canEdit) {
      setAuthError('');
      setLoginOpen(true);
      return false;
    }
    clearUpstreamSaveError();
    try {
      await saveUpstreamSystem(system, oldId);
      await upstreamReloadRef.current();
      clearModuleNavigationState('upstream');
      setUpRoute(getModuleDetailRoute('upstream', system.id) as UpstreamRoute);
      await loadUpstreamDetail(system.id);
      scrollMainToTop();
      return true;
    } catch (error: unknown) {
      if (isUnauthorizedError(error)) return false;
      const normalizedError = normalizeUpstreamApiError(error);
      upstreamSaveRawErrorRef.current = normalizedError.rawMessage;
      setUpstreamSaveError(normalizedError.message);
      setUpstreamSaveFieldErrors(normalizedError.fieldErrors);
      toast.error(normalizedError.fieldErrors.length
        ? `保存失败，还有 ${normalizedError.fieldErrors.length} 项需要修改`
        : normalizedError.message);
      return false;
    }
  };

  // 二次确认由调用方（列表 RowActions / 详情 / 编辑器）通过 confirmDelete 负责。
  const handleDeleteUpstream = async (systemId: string): Promise<void> => {
    await runProtectedMutation(
      async () => {
        await deleteUpstreamSystem(systemId);
        await upstreamReloadRef.current();
        clearModuleNavigationState('upstream');
        clearUpstreamSaveError();
        setUpRoute(getModuleListRoute('upstream') as UpstreamRoute);
        scrollMainToTop();
      },
      '删除上游系统失败。',
      'upstream:write',
    );
  };

  const handleToggleUpstream = async (systemId: string, status: string): Promise<void> => {
    if (!canEdit) {
      setAuthError('');
      setLoginOpen(true);
      return;
    }
    const previousSystem = upstreamSystems.find((item) => item.id === systemId)
      || (currentUpstream?.id === systemId ? currentUpstream : null);
    if (!previousSystem) return;

    setUpstreamPendingIds((prev) => (prev.includes(systemId) ? prev : [...prev, systemId]));
    setUpstreamSystems((prev) => prev.map((item) => (item.id === systemId ? { ...item, status } : item)));
    setCurrentUpstream((prev) => (prev?.id === systemId ? { ...prev, status } : prev));

    try {
      const updatedSystem = await patchUpstreamStatus(systemId, status);
      if (updatedSystem) {
        setUpstreamSystems((prev) => prev.map((item) => (item.id === systemId ? { ...item, ...updatedSystem } : item)));
        setCurrentUpstream((prev) => (prev?.id === systemId ? { ...prev, ...updatedSystem } : prev));
      }
    } catch (error: unknown) {
      if (!isUnauthorizedError(error)) {
        toast.error(getErrorMessage(error, '更新上游系统状态失败。'));
      }
      setUpstreamSystems((prev) => prev.map((item) => (item.id === systemId ? previousSystem : item)));
      setCurrentUpstream((prev) => (prev?.id === systemId ? previousSystem : prev));
    } finally {
      setUpstreamPendingIds((prev) => prev.filter((id) => id !== systemId));
      await upstreamReloadRef.current();
    }
  };

  // Filtering and ordering are performed before COUNT/LIMIT by the API.
  const filteredUpstreamSystems = upstreamSystems;

  const currentUpstreamEdit = useMemo(() => {
    if (upRoute.page !== 'edit' || !upRoute.id) return null;
    return upstreamDetailPage === 'edit' && currentUpstream?.id === upRoute.id ? currentUpstream : null;
  }, [upRoute, upstreamDetailPage, currentUpstream]);

  return {
    upstreamSystems,
    upstreamPage,
    upstreamPageSize,
    upstreamTotal: upstreamPageData?.total ?? 0,
    upstreamSystemCount: upstreamPageData?.stats.systemCount ?? 0,
    upstreamFacets: upstreamPageData?.facets ?? { status: {}, dbType: {}, dept: {} },
    upstreamSort,
    setUpstreamPage,
    setUpstreamPageSize,
    setUpstreamSort,
    upstreamDbTypes,
    upstreamDeptOptions,
    currentUpstream,
    upstreamPendingIds,
    upstreamLoading,
    upstreamDetailLoading,
    upstreamError: ['detail', 'edit'].includes(upRoute.page) ? upstreamError : upstreamListError,
    upstreamSaveError,
    upstreamSaveFieldErrors,
    clearUpstreamSaveError,
    upstreamLoaded,
    upstreamView,
    setUpstreamView,
    loadUpstreamData,
    loadUpstreamDetail,
    upFilter,
    setUpFilter,
    upBack,
    upGoList,
    upGoDetail,
    upGoEdit,
    upOpen,
    resetUpstreamNavigation,
    handleSaveUpstream,
    handleDeleteUpstream,
    handleToggleUpstream,
    filteredUpstreamSystems,
    currentUpstreamEdit,
  };
}
