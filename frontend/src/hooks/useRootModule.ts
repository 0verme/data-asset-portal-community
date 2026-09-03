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

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  deleteRoot,
  getRootCategories,
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
  rootLoading: boolean;
  rootError: string;
  rootLoaded: boolean;
  loadRootData: () => Promise<void>;
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
  const [rootLoading, setRootLoading] = useState(false);
  const [rootError, setRootError] = useState('');
  const [rootLoaded, setRootLoaded] = useState(false);
  const [rootCategory, setRootCategory] = useState<string | null>(DEFAULT_ROOT_CATEGORY);

  const restoreNavigationSnapshot = useCallback(
    (snapshot: RootNavigationSnapshot) => {
      setQuery(snapshot?.query || '');
      setRootCategory(snapshot?.rootCategory || DEFAULT_ROOT_CATEGORY);
      setRootRoute(snapshot?.rootRoute || (MODULE_META.root.defaultRoute as RootRoute));
      scrollMainToTop();
    },
    [setQuery, setRootRoute],
  );

  const loadRootData = useCallback(async (): Promise<void> => {
    setRootLoading(true);
    setRootError('');
    try {
      const [rootList, categoryList] = await Promise.all([getRoots(), getRootCategories()]);
      setRoots(rootList);
      setRootCategories(categoryList);
      setRootLoaded(true);
    } catch (error: unknown) {
      setRootError(getErrorMessage(error, '词根数据加载失败。'));
    } finally {
      setRootLoading(false);
    }
  }, []);

  useEffect(() => {
    if (active && !rootLoaded && !rootLoading) {
      loadRootData();
    }
  }, [active, rootLoaded, rootLoading, loadRootData]);

  const rootBack = useSmartBack<RootNavigationSnapshot>({
    moduleKey: 'root',
    onRestore: restoreNavigationSnapshot,
    onFallback: () => {
      setQuery('');
      setRootCategory(DEFAULT_ROOT_CATEGORY);
      setRootRoute(DEFAULT_ROOT_ROUTE);
      scrollMainToTop();
    },
  });

  const resetRootNavigation = useCallback((): void => {
    clearModuleNavigationState('root');
    setQuery('');
    setRootCategory(DEFAULT_ROOT_CATEGORY);
    setRootRoute(DEFAULT_ROOT_ROUTE);
  }, [setQuery, setRootRoute]);

  const handleSaveRoot = async (root: unknown, oldAbbr?: string): Promise<void> => {
    await runProtectedMutation(
      async () => {
        await saveRoot(root, oldAbbr);
        await loadRootData();
        clearModuleNavigationState('root');
        setQuery('');
        setRootCategory(DEFAULT_ROOT_CATEGORY);
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
        await loadRootData();
        clearModuleNavigationState('root');
        setQuery('');
        setRootCategory(DEFAULT_ROOT_CATEGORY);
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
        await loadRootData();
        rootBack();
      },
      '导入词根失败。',
      'root:write',
    );
  };

  const filteredRoots = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return roots.filter((item) => {
      if (rootCategory && item.cat !== rootCategory) return false;
      if (!normalizedQuery) return true;
      return [item.abbr, item.en, item.cn, item.desc].some((value) =>
        String(value || '').toLowerCase().includes(normalizedQuery),
      );
    });
  }, [roots, query, rootCategory]);

  const currentRoot = useMemo(
    () => (rootRoute.abbr ? roots.find((item) => item.abbr === rootRoute.abbr) || null : null),
    [rootRoute.abbr, roots],
  );

  const rootAbbrs = useMemo(() => roots.map((item) => item.abbr), [roots]);

  return {
    roots,
    rootCategories,
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
    filteredRoots,
    currentRoot,
    rootAbbrs,
  };
}
