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
  deletePushJob,
  deletePushSystem,
  getPushSystemAdminDetail,
  getPushSystem,
  getPushSystemPage,
  type PushSystemPage,
  savePushJob,
  savePushSystem,
  type PublicPushSystem,
  type PublicPushJob,
} from '../api/push.ts';
import type { PushSystemItem, PushJobItem } from '../data/pushSystems.ts';
import {
  DEFAULT_PUSH_FILTER,
  DEFAULT_PUSH_VIEW,
} from '../config/defaults.ts';
import {
  clearModuleNavigationState,
  getModuleListRoute,
  getPushInterfaceDetailRoute,
  getPushInterfaceEditRoute,
  getPushSystemDetailRoute,
  getPushSystemEditRoute,
} from '../routing/navigation.ts';
import {
  DEFAULT_AUTH_OPTIONS,
  DEFAULT_DELIMITER_OPTIONS,
  DEFAULT_ENCODING_OPTIONS,
  DEFAULT_FREQ_TYPE_OPTIONS,
  DEFAULT_PROTOCOL_OPTIONS,
} from '../components/push/pushConstants.ts';
import { UPSTREAM_DEPT_OPTIONS } from '../data/commonCodes.ts';
import { normalizeDictOptions, type DictOption } from '../utils/optionUtils.ts';
import { getErrorMessage, scrollMainToTop } from '../utils/ui.ts';
import type { PushFilter, PushRoute } from '../routing/types.ts';

function fallbackOptions(values: readonly unknown[]): DictOption[] {
  const normalizedValues = values.filter(
    (value): value is string | Record<string, unknown> =>
      typeof value === 'string' || (typeof value === 'object' && value !== null),
  );
  const seen = new Set<string>();
  return normalizeDictOptions(normalizedValues).filter((item) => {
    if (seen.has(item.value)) return false;
    seen.add(item.value);
    return true;
  });
}

export interface PushFacets {
  status: Record<string, number>;
  protocol: Record<string, number>;
  dept: Record<string, number>;
  importanceLevel: Record<string, number>;
}

export interface UsePushModuleProps {
  active?: boolean | undefined;
  query: string;
  setQuery: (query: string) => void;
  pushRoute: PushRoute;
  setPushRoute: (route: PushRoute) => void;
  initialView?: string | undefined;
  initialFilter?: PushFilter | undefined;
  canEdit: boolean;
  requireLogin?: ((action: () => void, permission?: string) => boolean) | undefined;
  runProtectedMutation: (
    task: () => Promise<unknown>,
    fallbackMessage?: string,
    permission?: string,
  ) => Promise<boolean>;
}

export interface UsePushModuleResult {
  pushSystems: PublicPushSystem[];
  pushPage: number;
  pushPageSize: number;
  pushTotal: number;
  pushSystemCount: number;
  pushSort: string;
  setPushPage: React.Dispatch<React.SetStateAction<number>>;
  setPushPageSize: React.Dispatch<React.SetStateAction<number>>;
  setPushSort: React.Dispatch<React.SetStateAction<string>>;
  pushDetailLoading: boolean;
  loadPushDetail: () => Promise<void>;
  pushProtocolOptions: DictOption[];
  pushAuthOptions: DictOption[];
  pushDelimiterOptions: DictOption[];
  pushEncodingOptions: DictOption[];
  pushFreqTypeOptions: DictOption[];
  pushLoading: boolean;
  pushError: string;
  pushLoaded: boolean;
  loadPushData: () => Promise<void>;
  pushView: string;
  setPushView: React.Dispatch<React.SetStateAction<string>>;
  pushFilter: PushFilter;
  setPushFilter: React.Dispatch<React.SetStateAction<PushFilter>>;
  pushGoList: () => void;
  pushGoSystem: (systemId: string) => void;
  pushGoJob: (systemId: string, jobId: string) => void;
  pushGoSystemEdit: (systemId: string | null) => void;
  pushGoJobEdit: (systemId: string, jobId: string | null) => void;
  resetPushNavigation: () => void;
  pushOpenSystem: (systemId: string) => void;
  pushOpenJob: (systemId: string, jobId: string) => void;
  handleSavePushSystem: (system: PushSystemItem, oldId?: string) => Promise<void>;
  handleDeletePushSystem: (systemId: string) => Promise<void>;
  handleSavePushJob: (job: PushJobItem, oldId?: string) => Promise<void>;
  handleDeletePushJob: (jobId: string) => Promise<void>;
  filteredPushSystems: PublicPushSystem[];
  pushFacets: PushFacets;
  currentSystem: PublicPushSystem | null;
  currentJob: PublicPushJob | null;
  pushIds: string[];
  pushDepts: DictOption[];
  recentPushSystems: PublicPushSystem[];
  pushAdminDetail: PushSystemItem | null;
  pushAdminDetailLoading: boolean;
}

export function usePushModule({
  active,
  query,
  setQuery,
  pushRoute,
  setPushRoute,
  initialView = DEFAULT_PUSH_VIEW,
  initialFilter = DEFAULT_PUSH_FILTER,
  canEdit,
  requireLogin: _requireLogin,
  runProtectedMutation,
}: UsePushModuleProps): UsePushModuleResult {
  const [pushSystems, setPushSystems] = useState<PublicPushSystem[]>([]);
  const [pushProtocolOptions, setPushProtocolOptions] = useState<DictOption[]>([]);
  const [pushAuthOptions, setPushAuthOptions] = useState<DictOption[]>([]);
  const [pushDelimiterOptions, setPushDelimiterOptions] = useState<DictOption[]>([]);
  const [pushEncodingOptions, setPushEncodingOptions] = useState<DictOption[]>([]);
  const [pushFreqTypeOptions, setPushFreqTypeOptions] = useState<DictOption[]>([]);
  const [pushDeptOptions, setPushDeptOptions] = useState<DictOption[]>([]);
  const [pushLoading, setPushLoading] = useState(false);
  const [pushError, setPushError] = useState('');
  const [pushListError, setPushListError] = useState('');
  const [detailReloadVersion, setDetailReloadVersion] = useState(0);
  const [pushLoaded, setPushLoaded] = useState(false);
  const [pushView, setPushView] = useState(initialView);
  const [pushFilter, setPushFilter] = useState(initialFilter);
  const [recentSystems, setRecentSystems] = useState<string[]>([]);
  const [pushAdminDetail, setPushAdminDetail] = useState<PushSystemItem | null>(null);
  const [pushAdminDetailLoading, setPushAdminDetailLoading] = useState(false);
  const [pushPage, setPushPage] = useState(1);
  const [pushPageSize, setPushPageSize] = useState(20);
  const [pushSort, setPushSort] = useState('importanceLevel:asc');
  const [pushPageData, setPushPageData] = useState<PushSystemPage | null>(null);
  const [publicDetail, setPublicDetail] = useState<PublicPushSystem | null>(null);
  const [pushDetailLoading, setPushDetailLoading] = useState(false);
  const [recentSystemRecords, setRecentSystemRecords] = useState<PublicPushSystem[]>([]);
  const listSequence = useRef(0);
  const detailSequence = useRef(0);
  const listKey = JSON.stringify([query, pushFilter.status, pushFilter.protocol, pushFilter.dept,
    pushFilter.importanceLevel, pushPage, pushPageSize, pushSort, canEdit]);
  const latestListKey = useRef(listKey);
  latestListKey.current = listKey;

  const loadPushData = useCallback(async (): Promise<void> => {
    const sequence = ++listSequence.current;
    setPushLoading(true);
    setPushListError('');
    try {
      const result = await getPushSystemPage({
        keyword: query, status: pushFilter.status || undefined, protocol: pushFilter.protocol || undefined,
        dept: pushFilter.dept || undefined, importanceLevel: pushFilter.importanceLevel || undefined,
        page: pushPage, pageSize: pushPageSize, sortKey: pushSort.split(':')[0], sortDirection: pushSort.split(':')[1],
      });
      if (sequence !== listSequence.current || latestListKey.current !== listKey) return;
      if (result.pageSize !== pushPageSize) setPushPageSize(result.pageSize);
      const lastPage = Math.max(1, Math.ceil(result.total / result.pageSize));
      if (pushPage > lastPage) { setPushPage(lastPage); return; }
      const protocolItems = fallbackOptions([...DEFAULT_PROTOCOL_OPTIONS, ...result.options.protocols]);
      const authItems = fallbackOptions(DEFAULT_AUTH_OPTIONS);
      const delimiterItems = fallbackOptions(DEFAULT_DELIMITER_OPTIONS);
      const encodingItems = fallbackOptions(DEFAULT_ENCODING_OPTIONS);
      const freqTypeItems = fallbackOptions([
        ...DEFAULT_FREQ_TYPE_OPTIONS,
        ...result.options.freqTypes,
      ]);
      const deptItems = fallbackOptions(import.meta.env?.['VITE_API_MODE'] === 'mock' ? [...UPSTREAM_DEPT_OPTIONS, ...result.options.depts] : result.options.depts);
      setPushPageData(result);
      setPushSystems(result.items);
      setPushProtocolOptions(protocolItems);
      setPushAuthOptions(authItems);
      setPushDelimiterOptions(delimiterItems);
      setPushEncodingOptions(encodingItems);
      setPushFreqTypeOptions(freqTypeItems);
      setPushDeptOptions(deptItems);
      setPushLoaded(true);
    } catch (error: unknown) {
      if (sequence === listSequence.current && latestListKey.current === listKey) {
        setPushListError(getErrorMessage(error, '下游推送系统加载失败。'));
      }
    } finally {
      if (sequence === listSequence.current && latestListKey.current === listKey) setPushLoading(false);
    }
  }, [query, pushFilter.status, pushFilter.protocol, pushFilter.dept, pushFilter.importanceLevel,
    pushPage, pushPageSize, pushSort, listKey]);
  const pushReloadRef = useRef(loadPushData);
  pushReloadRef.current = loadPushData;
  const retryPushData = useCallback(async (): Promise<void> => {
    await pushReloadRef.current();
    setDetailReloadVersion((version) => version + 1);
  }, []);

  useEffect(() => {
    if (active) void loadPushData();
    return () => { listSequence.current += 1; };
  }, [active, loadPushData]);

  useEffect(() => {
    setPushPage(1);
  }, [query, pushFilter.status, pushFilter.protocol, pushFilter.dept, pushFilter.importanceLevel, pushPageSize, pushSort]);

  const loadPushDetail = useCallback(async (): Promise<void> => {
    const sequence = ++detailSequence.current;
    setPublicDetail(null);
    if (!active || !pushRoute.sys || pushRoute.page === 'systems') {
      setPushDetailLoading(false);
      return;
    }
    setPushDetailLoading(true);
    setPushError('');
    try {
      const detail = await getPushSystem(pushRoute.sys);
      if (sequence !== detailSequence.current) return;
      setPublicDetail(detail);
      setRecentSystemRecords((previous) => [
        { ...detail, jobCount: detail.jobs.length, jobs: [] },
        ...previous.filter((item) => item.id !== detail.id),
      ].slice(0, 6));
    } catch (error: unknown) {
      if (sequence === detailSequence.current) setPushError(getErrorMessage(error, '下游推送系统详情加载失败。'));
    } finally {
      if (sequence === detailSequence.current) setPushDetailLoading(false);
    }
  }, [active, pushRoute.sys, pushRoute.page]);

  useEffect(() => {
    void loadPushDetail();
    return () => { detailSequence.current += 1; };
  }, [loadPushDetail, canEdit, detailReloadVersion]);

  useEffect(() => {
    setPushView(initialView || DEFAULT_PUSH_VIEW);
  }, [initialView]);

  useEffect(() => {
    setPushFilter(initialFilter || DEFAULT_PUSH_FILTER);
  }, [initialFilter]);

  useEffect(() => {
    const needsAdminDetail =
      canEdit && active && ['sysEdit', 'jobEdit', 'fields'].includes(pushRoute.page || '') && Boolean(pushRoute.sys);
    if (!needsAdminDetail) {
      setPushAdminDetail(null);
      setPushAdminDetailLoading(false);
      return;
    }
    let alive = true;
    setPushAdminDetail(null);
    setPushAdminDetailLoading(true);
    setPushError('');
    if (pushRoute.sys) {
      getPushSystemAdminDetail(pushRoute.sys)
        .then((detail) => alive && setPushAdminDetail(detail))
        .catch((error: unknown) => alive && setPushError(getErrorMessage(error, '下游推送系统详情加载失败。')))
        .finally(() => alive && setPushAdminDetailLoading(false));
    }
    return () => {
      alive = false;
    };
  }, [active, canEdit, pushRoute.page, pushRoute.sys, detailReloadVersion]);

  const rememberSystem = (systemId: string): void => {
    setRecentSystems((prev) => [systemId, ...prev.filter((item) => item !== systemId)].slice(0, 6));
  };

  const pushGoList = useCallback((): void => {
    clearModuleNavigationState('push');
    setPushRoute(getModuleListRoute('push') as PushRoute);
    scrollMainToTop();
  }, [setPushRoute]);

  const pushGoSystem = useCallback(
    (systemId: string): void => {
      rememberSystem(systemId);
      setPushRoute(getPushSystemDetailRoute(systemId) as PushRoute);
      scrollMainToTop();
    },
    [setPushRoute],
  );

  const pushGoJob = useCallback(
    (systemId: string, jobId: string): void => {
      rememberSystem(systemId);
      setPushRoute(getPushInterfaceDetailRoute(systemId, jobId) as PushRoute);
      scrollMainToTop();
    },
    [setPushRoute],
  );

  const pushGoSystemEdit = useCallback(
    (systemId: string | null): void => {
      setPushRoute(getPushSystemEditRoute(systemId) as PushRoute);
      scrollMainToTop();
    },
    [setPushRoute],
  );

  const pushGoJobEdit = useCallback(
    (systemId: string, jobId: string | null): void => {
      setPushRoute(getPushInterfaceEditRoute(systemId, jobId) as PushRoute);
      scrollMainToTop();
    },
    [setPushRoute],
  );

  const resetPushNavigation = useCallback((): void => {
    clearModuleNavigationState('push');
    setQuery('');
    setPushView(DEFAULT_PUSH_VIEW);
    setPushFilter(DEFAULT_PUSH_FILTER);
    setPushRoute(getModuleListRoute('push') as PushRoute);
  }, [setPushRoute, setQuery]);

  const pushOpenSystem = (systemId: string): void => {
    pushGoSystem(systemId);
  };

  const pushOpenJob = (systemId: string, jobId: string): void => {
    pushGoJob(systemId, jobId);
  };

  const handleSavePushSystem = async (system: PushSystemItem, oldId?: string): Promise<void> => {
    await runProtectedMutation(
      async () => {
        await savePushSystem(system, oldId);
        await pushReloadRef.current();
        clearModuleNavigationState('push');
        setPushRoute(getPushSystemDetailRoute(system.id) as PushRoute);
        rememberSystem(system.id);
        scrollMainToTop();
      },
      '保存下游系统失败。',
      'push:write',
    );
  };

  const handleDeletePushSystem = async (systemId: string): Promise<void> => {
    await runProtectedMutation(
      async () => {
        await deletePushSystem(systemId);
        await pushReloadRef.current();
        clearModuleNavigationState('push');
        setPushRoute(getModuleListRoute('push') as PushRoute);
        scrollMainToTop();
      },
      '删除下游系统失败。',
      'push:write',
    );
  };

  const handleSavePushJob = async (job: PushJobItem, oldId?: string): Promise<void> => {
    if (!pushRoute.sys) return;
    await runProtectedMutation(
      async () => {
        await savePushJob(pushRoute.sys!, job, oldId);
        await pushReloadRef.current();
        clearModuleNavigationState('push');
        setPushRoute(getPushInterfaceDetailRoute(pushRoute.sys!, job.id) as PushRoute);
        scrollMainToTop();
      },
      '保存推送作业失败。',
      'push:write',
    );
  };

  const handleDeletePushJob = async (jobId: string): Promise<void> => {
    if (!pushRoute.sys) return;
    await runProtectedMutation(
      async () => {
        await deletePushJob(pushRoute.sys!, jobId);
        await pushReloadRef.current();
        setPushRoute(getPushSystemDetailRoute(pushRoute.sys!) as PushRoute);
        scrollMainToTop();
      },
      '删除推送作业失败。',
      'push:write',
    );
  };

  // Page membership must not determine detail access or global statistics.
  const filteredPushSystems = pushSystems;
  const pushFacets: PushFacets = pushPageData?.facets ?? { status: {}, protocol: {}, dept: {}, importanceLevel: {} };
  const currentSystem = publicDetail?.id === pushRoute.sys ? publicDetail : null;

  const currentJob = useMemo(() => {
    if (!currentSystem || !pushRoute.job) return null;
    return currentSystem.jobs.find((job) => job.id === pushRoute.job) || null;
  }, [currentSystem, pushRoute.job]);

  const pushIds = pushPageData?.options.systemIds ?? [];
  const pushDepts = useMemo(() => pushDeptOptions.filter((item) => item.value), [pushDeptOptions]);
  const recentPushSystems = useMemo(
    () =>
      recentSystems
        .map((id) => recentSystemRecords.find((system) => system.id === id))
        .filter((item): item is PublicPushSystem => Boolean(item)),
    [recentSystems, recentSystemRecords],
  );

  return {
    pushSystems,
    pushPage,
    pushPageSize,
    pushTotal: pushPageData?.total ?? 0,
    pushSystemCount: pushPageData?.stats.systemCount ?? 0,
    pushSort,
    setPushPage,
    setPushPageSize,
    setPushSort,
    pushDetailLoading,
    loadPushDetail,
    pushProtocolOptions,
    pushAuthOptions,
    pushDelimiterOptions,
    pushEncodingOptions,
    pushFreqTypeOptions,
    pushLoading,
    pushError: ['systems', 'sysNew'].includes(pushRoute.page) ? pushListError : pushError,
    pushLoaded,
    loadPushData: retryPushData,
    pushView,
    setPushView,
    pushFilter,
    setPushFilter,
    pushGoList,
    pushGoSystem,
    pushGoJob,
    pushGoSystemEdit,
    pushGoJobEdit,
    resetPushNavigation,
    pushOpenSystem,
    pushOpenJob,
    handleSavePushSystem,
    handleDeletePushSystem,
    handleSavePushJob,
    handleDeletePushJob,
    filteredPushSystems,
    pushFacets,
    currentSystem,
    currentJob,
    pushIds,
    pushDepts,
    recentPushSystems,
    pushAdminDetail,
    pushAdminDetailLoading,
  };
}
