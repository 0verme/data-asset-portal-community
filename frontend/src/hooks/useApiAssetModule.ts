import { useCallback, useEffect, useRef, useState } from 'react';
import {
  deleteApiAsset,
  getApiAsset,
  getApiAssetPage,
  getApiDownstreamSystems,
  saveApiAsset,
  setApiAssetStatus,
} from '../api/apiAssets.ts';
import type { ApiAssetFacets } from '../api/apiAssets.ts';
import type { MockApiAsset } from '../data/apiAssets.ts';
import {
  normalizeApiAssetSaveFailure,
  type ApiAssetFieldErrors,
} from '../api/apiAssetValidation.ts';
import type { MockSystem } from '../data/systems.ts';
import { DEFAULT_API_ASSET_ROUTE } from '../config/defaults.ts';
import { getErrorMessage, scrollMainToTop } from '../utils/ui.ts';
import { toast } from '../components/common/index.ts';
import { runOptimisticStatusMutation } from '../utils/statusMutation.ts';
import type { ApiAssetFilter, ApiAssetRoute } from '../routing/types.ts';

export interface UseApiAssetModuleProps {
  active?: boolean | undefined;
  query: string;
  route: ApiAssetRoute;
  setRoute: (route: ApiAssetRoute) => void;
  filter: ApiAssetFilter;
  canEdit: boolean;
  requireLogin: (action: () => void, permission?: string) => boolean;
  setAuthError: (error: string) => void;
  setLoginOpen: (open: boolean) => void;
}

export interface UseApiAssetModuleResult {
  items: MockApiAsset[];
  total: number;
  globalTotal: number;
  page: number;
  pageSize: number;
  setPage: React.Dispatch<React.SetStateAction<number>>;
  setPageSize: React.Dispatch<React.SetStateAction<number>>;
  systems: MockSystem[];
  loading: boolean;
  detailLoading: boolean;
  detailError: string;
  error: string;
  load: () => Promise<void>;
  loadDetail: () => Promise<void>;
  filtered: MockApiAsset[];
  facets: ApiAssetFacets;
  current: MockApiAsset | null;
  saveError: string;
  saveFieldErrors: ApiAssetFieldErrors;
  saveFailureRevision: number;
  clearSaveErrors: (fieldPrefix?: string) => void;
  pendingIds: string[];
  create: () => void;
  edit: (code: string) => void;
  view: (code: string) => void;
  back: () => void;
  save: (payload: MockApiAsset) => Promise<void>;
  remove: (code: string) => Promise<void>;
  toggle: (item: MockApiAsset) => Promise<void>;
}

export function useApiAssetModule({
  active,
  query,
  route,
  setRoute,
  filter,
  canEdit,
  requireLogin,
  setAuthError,
  setLoginOpen,
}: UseApiAssetModuleProps): UseApiAssetModuleResult {
  const [items, setItems] = useState<MockApiAsset[]>([]);
  const [total, setTotal] = useState(0);
  const [globalTotal, setGlobalTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [facets, setFacets] = useState<ApiAssetFacets>({ status: {}, method: {}, downstreamSystemId: {} });
  const [currentRecord, setCurrentRecord] = useState<{ code: string; item: MockApiAsset } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [systems, setSystems] = useState<MockSystem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const requestSequence = useRef(0);
  const detailSequence = useRef(0);
  const previousFilterKey = useRef<string | null>(null);
  const [saveError, setSaveError] = useState('');
  const [saveFieldErrors, setSaveFieldErrors] = useState<ApiAssetFieldErrors>({});
  const [saveFailureRevision, setSaveFailureRevision] = useState(0);
  const clearSaveErrors = (fieldPrefix?: string): void => {
    setSaveError('');
    setSaveFailureRevision(0);
    setSaveFieldErrors((current) => {
      if (!fieldPrefix) return {};
      return Object.fromEntries(
        Object.entries(current).filter(
          ([field]) => field !== fieldPrefix && !field.startsWith(`${fieldPrefix}.`),
        ),
      );
    });
  };
  const [pendingIds, setPendingIds] = useState<string[]>([]);
  const pendingRef = useRef(new Set<string>());

  const load = useCallback(async (): Promise<void> => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    try {
      const [result, nextSystems] = await Promise.all([
        getApiAssetPage({
          keyword: query,
          status: filter.status || undefined,
          method: filter.method || undefined,
          downstreamSystemId: filter.downstreamSystemId || undefined,
          page,
          pageSize,
        }),
        getApiDownstreamSystems(),
      ]);
      if (sequence !== requestSequence.current) return;
      setItems(result.items);
      setTotal(result.total);
      setGlobalTotal(result.stats.total);
      setFacets(result.facets);
      setSystems(nextSystems);
      if (result.page !== page) setPage(result.page);
      setError('');
    } catch (e: unknown) {
      if (sequence === requestSequence.current) {
        setError(e instanceof Error && e.message ? e.message : '加载 API 资产失败');
      }
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [filter.downstreamSystemId, filter.method, filter.status, page, pageSize, query]);

  const filterKey = JSON.stringify([query.trim(), filter.status || '', filter.method || '', filter.downstreamSystemId || '']);
  useEffect(() => {
    if (!active) return;
    if (previousFilterKey.current !== filterKey) {
      previousFilterKey.current = filterKey;
      if (page !== 1) {
        setPage(1);
        return;
      }
    }
    void load();
  }, [active, filterKey, load, page]);

  const loadDetail = useCallback(async (): Promise<void> => {
    const code = route.code;
    if (!['view', 'edit'].includes(route.page) || !code) {
      setCurrentRecord(null);
      setDetailError('');
      setDetailLoading(false);
      return;
    }
    const sequence = ++detailSequence.current;
    setCurrentRecord(null);
    setDetailLoading(true);
    setDetailError('');
    try {
      const item = await getApiAsset(code);
      if (sequence === detailSequence.current) setCurrentRecord({ code, item });
    } catch (e: unknown) {
      if (sequence === detailSequence.current) setDetailError(e instanceof Error && e.message ? e.message : '加载 API 资产详情失败');
    } finally {
      if (sequence === detailSequence.current) setDetailLoading(false);
    }
  }, [route.code, route.page]);

  useEffect(() => {
    void loadDetail();
    return () => { detailSequence.current += 1; };
  }, [loadDetail]);

  const filtered = items;
  const current = currentRecord?.code === route.code ? currentRecord.item : null;
  const guard = (fn: () => void): void => {
    requireLogin(() => fn());
  };

  const save = async (payload: MockApiAsset): Promise<void> => {
    if (!canEdit) {
      setAuthError('');
      setLoginOpen(true);
      return;
    }
    clearSaveErrors();
    try {
      await saveApiAsset(route.page === 'edit' ? route.code : null, payload);
      await load();
      clearSaveErrors();
      setRoute(DEFAULT_API_ASSET_ROUTE);
      scrollMainToTop();
    } catch (e: unknown) {
      const failure = normalizeApiAssetSaveFailure(e, payload);
      setSaveError(failure.summary);
      setSaveFieldErrors(failure.fieldErrors);
      setSaveFailureRevision((revision) => revision + 1);
    }
  };

  const toggle = async (item: MockApiAsset): Promise<void> => {
    if (!canEdit) {
      setAuthError('');
      setLoginOpen(true);
      return;
    }
    if (pendingRef.current.has(item.code)) return;
    pendingRef.current.add(item.code);
    const nextStatus = item.status === 'enabled' ? 'disabled' : 'enabled';
    setPendingIds((currentIds) => [...currentIds, item.code]);
    let updated = false;
    await runOptimisticStatusMutation({
      apply: () =>
        setItems((currentItems) =>
          currentItems.map((row) => (row.code === item.code ? { ...row, status: nextStatus } : row)),
        ),
      request: async () => {
        const result = await setApiAssetStatus(item.code, nextStatus);
        updated = true;
        return result;
      },
      rollback: () =>
        setItems((currentItems) => currentItems.map((row) => (row.code === item.code ? item : row))),
      onError: (e) => toast.error(getErrorMessage(e, '更新 API 资产状态失败。')),
    });
    pendingRef.current.delete(item.code);
    setPendingIds((currentIds) => currentIds.filter((code) => code !== item.code));
    if (updated) await load();
  };

  return {
    items,
    total,
    globalTotal,
    page,
    pageSize,
    setPage,
    setPageSize,
    systems,
    loading,
    detailLoading,
    detailError,
    error,
    load,
    loadDetail,
    filtered,
    facets,
    current,
    saveError,
    saveFieldErrors,
    saveFailureRevision,
    clearSaveErrors,
    pendingIds,
    create: () => guard(() => {
      clearSaveErrors();
      setRoute({ page: 'new', code: null });
    }),
    edit: (code: string) => guard(() => {
      clearSaveErrors();
      setRoute({ page: 'edit', code });
    }),
    view: (code: string) => setRoute({ page: 'view', code }),
    back: () => {
      clearSaveErrors();
      setRoute(DEFAULT_API_ASSET_ROUTE);
      scrollMainToTop();
    },
    save,
    remove: async (code: string) => {
      await deleteApiAsset(code);
      await load();
      setRoute(DEFAULT_API_ASSET_ROUTE);
    },
    toggle,
  };
}
