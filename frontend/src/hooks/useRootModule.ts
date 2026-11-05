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

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  deleteRoot,
  getRootAbbreviations,
  getRootCategories,
  getRootDetail,
  getRootPage,
  getRoots,
  importRoots,
  saveRoot,
  type RootCategoryItem,
  type SanitizedWordRoot,
} from '../api/root.ts';
import { DEFAULT_ROOT_CATEGORY, DEFAULT_ROOT_ROUTE } from '../config/defaults.ts';
import { clearModuleNavigationState, MODULE_META } from '../routing/navigation.ts';
import { useSmartBack } from './useSmartBack.ts';
import { getErrorMessage, scrollMainToTop } from '../utils/ui.ts';
import type { RootRoute } from '../routing/types.ts';

export interface RootNavigationSnapshot {
  query?: string | undefined;
  rootCategory?: string | undefined;
  rootRoute?: RootRoute | undefined;
}

export interface UseRootModuleProps {
  active?: boolean | undefined;
  query: string;
  setQuery: (query: string) => void;
  rootRoute: RootRoute;
  setRootRoute: (route: RootRoute) => void;
  runProtectedMutation: (
    task: () => Promise<unknown>,
    fallbackMessage?: string,
    permission?: string,
  ) => Promise<boolean>;
}

export interface UseRootModuleResult {
  roots: SanitizedWordRoot[];
  rootCategories: RootCategoryItem[];
  rootTotal: number;
  rootGlobalTotal: number;
  rootPage: number;
  rootPageSize: number;
  setRootPage: React.Dispatch<React.SetStateAction<number>>;
  setRootPageSize: React.Dispatch<React.SetStateAction<number>>;
  rootLoading: boolean;
  rootError: string;
  rootLoaded: boolean;
  loadRootData: (options?: { page?: number; keyword?: string; cat?: string | null }) => Promise<void>;
  rootCategory: string | null;
  setRootCategory: React.Dispatch<React.SetStateAction<string | null>>;
  rootBack: () => void;
  resetRootNavigation: () => void;
  handleSaveRoot: (root: unknown, oldAbbr?: string) => Promise<void>;
  handleDeleteRoot: (abbr: string) => Promise<void>;
  handleImportRoots: (items: unknown[]) => Promise<void>;
  filteredRoots: SanitizedWordRoot[];
  currentRoot: SanitizedWordRoot | null;
  rootAbbrs: string[];
  rootImportCandidates: SanitizedWordRoot[];
  rootImportLoading: boolean;
  rootImportError: string;
  loadRootImportCandidates: () => Promise<void>;
  rootDetailLoading: boolean;
  rootDetailError: string;
  loadRootDetail: () => Promise<void>;
}

export function useRootModule({
  active,
  query,
  setQuery,
  rootRoute,
  setRootRoute,
  runProtectedMutation,
}: UseRootModuleProps): UseRootModuleResult {
  const [roots, setRoots] = useState<SanitizedWordRoot[]>([]);
  const [rootCategories, setRootCategories] = useState<RootCategoryItem[]>([]);
  const [rootAbbrs, setRootAbbrs] = useState<string[]>([]);
  const [rootTotal, setRootTotal] = useState(0);
  const [rootGlobalTotal, setRootGlobalTotal] = useState(0);
  const [rootPage, setRootPage] = useState(1);
  const [rootPageSize, setRootPageSize] = useState(20);
  const [rootLoading, setRootLoading] = useState(false);
  const [rootError, setRootError] = useState('');
  const [rootLoaded, setRootLoaded] = useState(false);
  const [rootCategory, setRootCategory] = useState<string | null>(DEFAULT_ROOT_CATEGORY);
  const [currentRoot, setCurrentRoot] = useState<SanitizedWordRoot | null>(null);
  const [rootDetailLoading, setRootDetailLoading] = useState(false);
  const [rootDetailError, setRootDetailError] = useState('');
  const [rootImportCandidates, setRootImportCandidates] = useState<SanitizedWordRoot[]>([]);
  const [rootImportLoading, setRootImportLoading] = useState(false);
  const [rootImportError, setRootImportError] = useState('');
  const requestSequence = useRef(0);
  const detailSequence = useRef(0);
  const importSequence = useRef(0);
  const previousFilterKey = useRef<string | null>(null);

  const restoreNavigationSnapshot = useCallback(
    (snapshot: RootNavigationSnapshot) => {
      setQuery(snapshot?.query || '');
      setRootCategory(snapshot?.rootCategory || DEFAULT_ROOT_CATEGORY);
      setRootRoute(snapshot?.rootRoute || (MODULE_META.root.defaultRoute as RootRoute));
      scrollMainToTop();
    },
    [setQuery, setRootRoute],
  );

  const loadRootData = useCallback(async (options?: {
    page?: number;
    keyword?: string;
    cat?: string | null;
  }): Promise<void> => {
    const sequence = ++requestSequence.current;
    const requestedPage = options?.page ?? rootPage;
    const keyword = options?.keyword ?? query;
    const category = options?.cat === undefined ? rootCategory : options.cat;
    setRootLoading(true);
    setRootError('');
    try {
      const [pageData, categoryList, abbreviations] = await Promise.all([
        getRootPage({ keyword, cat: category || undefined, page: requestedPage, pageSize: rootPageSize }),
        getRootCategories(),
        getRootAbbreviations(),
      ]);
      if (sequence !== requestSequence.current) return;
      setRoots(pageData.items);
      setRootTotal(pageData.total);
      setRootGlobalTotal(pageData.stats.total);
      setRootPage(pageData.page);
      setRootPageSize(pageData.pageSize);
      setRootCategories(categoryList);
      setRootAbbrs(abbreviations);
      setRootLoaded(true);
    } catch (error: unknown) {
      if (sequence === requestSequence.current) {
        setRootError(getErrorMessage(error, '词根数据加载失败。'));
      }
    } finally {
      if (sequence === requestSequence.current) setRootLoading(false);
    }
  }, [query, rootCategory, rootPage, rootPageSize]);

  const loadRootDetail = useCallback(async (): Promise<void> => {
    const sequence = ++detailSequence.current;
    const abbr = rootRoute.abbr;
    if (!active || rootRoute.page !== 'edit' || !abbr) {
      setCurrentRoot(null);
      setRootDetailError('');
      setRootDetailLoading(false);
      return;
    }
    setCurrentRoot(null);
    setRootDetailLoading(true);
    setRootDetailError('');
    try {
      const item = await getRootDetail(abbr);
      if (sequence === detailSequence.current) setCurrentRoot(item);
    } catch (error: unknown) {
      if (sequence === detailSequence.current) {
        setRootDetailError(getErrorMessage(error, '词根详情加载失败。'));
      }
    } finally {
      if (sequence === detailSequence.current) setRootDetailLoading(false);
    }
  }, [active, rootRoute.abbr, rootRoute.page]);

  const loadRootImportCandidates = useCallback(async (): Promise<void> => {
    const sequence = ++importSequence.current;
    if (!active) {
      setRootImportCandidates([]);
      setRootImportError('');
      setRootImportLoading(false);
      return;
    }
    setRootImportLoading(true);
    setRootImportError('');
    try {
      const candidates = await getRoots();
      if (sequence === importSequence.current) setRootImportCandidates(candidates);
    } catch (error: unknown) {
      if (sequence === importSequence.current) {
        setRootImportError(getErrorMessage(error, '读取词根导入候选失败。'));
      }
    } finally {
      if (sequence === importSequence.current) setRootImportLoading(false);
    }
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const filterKey = JSON.stringify([query.trim(), rootCategory || '']);
    if (previousFilterKey.current !== filterKey) {
      previousFilterKey.current = filterKey;
      if (rootPage !== 1) {
        setRootPage(1);
        return;
      }
    }
    void loadRootData();
  }, [active, loadRootData, query, rootCategory, rootPage]);

  useEffect(() => {
    void loadRootDetail();
    return () => { detailSequence.current += 1; };
  }, [loadRootDetail]);

  useEffect(() => {
    if (active && rootRoute.page === 'import') void loadRootImportCandidates();
    return () => { importSequence.current += 1; };
  }, [active, loadRootImportCandidates, rootRoute.page]);

  const rootBack = useSmartBack<RootNavigationSnapshot>({
    moduleKey: 'root',
    onRestore: restoreNavigationSnapshot,
    onFallback: () => {
      setQuery('');
      setRootCategory(DEFAULT_ROOT_CATEGORY);
      setRootPage(1);
      setRootRoute(DEFAULT_ROOT_ROUTE);
      scrollMainToTop();
    },
  });

  const resetRootNavigation = useCallback((): void => {
    clearModuleNavigationState('root');
    setQuery('');
    setRootCategory(DEFAULT_ROOT_CATEGORY);
    setRootPage(1);
    setRootRoute(DEFAULT_ROOT_ROUTE);
  }, [setQuery, setRootRoute]);

  const handleSaveRoot = async (root: unknown, oldAbbr?: string): Promise<void> => {
    await runProtectedMutation(
      async () => {
        await saveRoot(root, oldAbbr);
        setQuery('');
        setRootCategory(DEFAULT_ROOT_CATEGORY);
        setRootPage(1);
        await loadRootData({ page: 1, keyword: '', cat: DEFAULT_ROOT_CATEGORY });
        clearModuleNavigationState('root');
        setRootRoute(DEFAULT_ROOT_ROUTE);
        scrollMainToTop();
      },
      '保存词根失败。',
      'root:write',
    );
  };

  const handleDeleteRoot = async (abbr: string): Promise<void> => {
    await runProtectedMutation(
      async () => {
        await deleteRoot(abbr);
        setQuery('');
        setRootCategory(DEFAULT_ROOT_CATEGORY);
        setRootPage(1);
        await loadRootData({ page: 1, keyword: '', cat: DEFAULT_ROOT_CATEGORY });
        clearModuleNavigationState('root');
        setRootRoute(DEFAULT_ROOT_ROUTE);
        scrollMainToTop();
      },
      '删除词根失败。',
      'root:write',
    );
  };

  const handleImportRoots = async (items: unknown[]): Promise<void> => {
    await runProtectedMutation(
      async () => {
        await importRoots(items);
        setQuery('');
        setRootCategory(DEFAULT_ROOT_CATEGORY);
        setRootPage(1);
        await loadRootData({ page: 1, keyword: '', cat: DEFAULT_ROOT_CATEGORY });
        await loadRootImportCandidates();
        rootBack();
      },
      '导入词根失败。',
      'root:write',
    );
  };

  return {
    roots,
    rootCategories,
    rootTotal,
    rootGlobalTotal,
    rootPage,
    rootPageSize,
    setRootPage,
    setRootPageSize,
    rootLoading,
    rootError,
    rootLoaded,
    loadRootData,
    rootCategory,
    setRootCategory,
    rootBack,
    resetRootNavigation,
    handleSaveRoot,
    handleDeleteRoot,
    handleImportRoots,
    filteredRoots: roots,
    currentRoot,
    rootAbbrs,
    rootImportCandidates,
    rootImportLoading,
    rootImportError,
    loadRootImportCandidates,
    rootDetailLoading,
    rootDetailError,
    loadRootDetail,
  };
}
