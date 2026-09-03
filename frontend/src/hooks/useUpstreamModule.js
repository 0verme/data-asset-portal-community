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

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  deleteUpstreamSystem,
  getUpstreamSystem,
  getUpstreamSystemAdminDetail,
  getUpstreamSystems,
  patchUpstreamStatus,
  saveUpstreamSystem,
} from "../api/upstream.js";
import { isUnauthorizedError } from "../api/http.js";
import { toast } from "../components/common/index.js";
import {
  DEFAULT_UP_FILTER,
  DEFAULT_UP_VIEW,
} from "../config/defaults.ts";
import {
  clearModuleNavigationState,
  getModuleDetailRoute,
  getModuleEditRoute,
  getModuleListRoute,
  MODULE_META,
  pushModuleNavigationState,
} from "../routing/navigation.ts";
import { useSmartBack } from "./useSmartBack.js";
import { DEFAULT_UPSTREAM_DEPTS } from "../config/defaults.ts";
import { DB_TYPE_OPTIONS } from "../data/upstreamSystems.ts";
import { normalizeDictOptions } from "../utils/optionUtils.ts";
import { getErrorMessage, scrollMainToTop } from "../utils/ui.ts";

function fallbackOptions(values) {
  const seen = new Set();
  return normalizeDictOptions(values).filter((item) => {
    if (seen.has(item.value)) return false;
    seen.add(item.value);
    return true;
  });
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
}) {
  const [upstreamSystems, setUpstreamSystems] = useState([]);
  const [upstreamDbTypes, setUpstreamDbTypes] = useState([]);
  const [upstreamDeptOptions, setUpstreamDeptOptions] = useState([]);
  const [currentUpstream, setCurrentUpstream] = useState(null);
  const [upstreamPendingIds, setUpstreamPendingIds] = useState([]);
  const [upstreamLoading, setUpstreamLoading] = useState(false);
  const [upstreamDetailLoading, setUpstreamDetailLoading] = useState(false);
  const [upstreamError, setUpstreamError] = useState("");
  const [upstreamSaveError, setUpstreamSaveError] = useState("");
  const [upstreamLoaded, setUpstreamLoaded] = useState(false);
  const [upstreamView, setUpstreamView] = useState(initialView);
  const [upFilter, setUpFilter] = useState(initialFilter);

  const buildNavigationSnapshot = useCallback(() => ({
    query,
    upRoute,
    upFilter,
    upstreamView,
  }), [query, upFilter, upRoute, upstreamView]);

  const restoreNavigationSnapshot = useCallback((snapshot) => {
    setQuery(snapshot?.query || "");
    setUpFilter(snapshot?.upFilter || DEFAULT_UP_FILTER);
    setUpstreamView(snapshot?.upstreamView || DEFAULT_UP_VIEW);
    setUpRoute(snapshot?.upRoute || MODULE_META.upstream.defaultRoute);
    setUpstreamSaveError("");
    scrollMainToTop();
  }, [setQuery, setUpRoute]);

  const loadUpstreamData = useCallback(async () => {
    setUpstreamLoading(true);
    setUpstreamError("");
    try {
      const systems = await getUpstreamSystems();
      setUpstreamSystems(systems);
      setUpstreamDbTypes(fallbackOptions([
        ...DB_TYPE_OPTIONS,
        ...systems.map((item) => item.dbType),
      ]));
      setUpstreamDeptOptions(fallbackOptions([
        ...DEFAULT_UPSTREAM_DEPTS,
        ...systems.map((item) => item.dept),
      ]));
      setUpstreamLoaded(true);
    } catch (error) {
      setUpstreamError(getErrorMessage(error, "上游卸数系统加载失败。"));
    } finally {
      setUpstreamLoading(false);
    }
  }, []);

  const loadUpstreamDetail = useCallback(async (systemId) => {
    setUpstreamDetailLoading(true);
    setUpstreamError("");
    try {
      setCurrentUpstream(await (upRoute.page === "edit" ? getUpstreamSystemAdminDetail(systemId) : getUpstreamSystem(systemId)));
    } catch (error) {
      setCurrentUpstream(null);
      setUpstreamError(getErrorMessage(error, "上游卸数系统详情加载失败。"));
    } finally {
      setUpstreamDetailLoading(false);
    }
  }, [upRoute.page]);

  useEffect(() => {
    if (active && !upstreamLoaded && !upstreamLoading) {
      loadUpstreamData();
    }
  }, [active, upstreamLoaded, upstreamLoading, loadUpstreamData]);

  useEffect(() => {
    setUpstreamLoaded(false);
  }, [canEdit]);

  useEffect(() => {
    setUpstreamView(initialView || DEFAULT_UP_VIEW);
  }, [initialView]);

  useEffect(() => {
    setUpFilter(initialFilter || DEFAULT_UP_FILTER);
  }, [initialFilter]);

  useEffect(() => {
    if (active && (upRoute.page === "detail" || upRoute.page === "edit") && upRoute.id) {
      loadUpstreamDetail(upRoute.id);
    } else {
      setCurrentUpstream(null);
      setUpstreamDetailLoading(false);
    }
  }, [active, upRoute, loadUpstreamDetail]);

  const upBack = useSmartBack({
    moduleKey: "upstream",
    onRestore: restoreNavigationSnapshot,
    onFallback: () => {
      setQuery("");
      setUpFilter(DEFAULT_UP_FILTER);
      setUpstreamSaveError("");
      setUpRoute(getModuleListRoute("upstream"));
      scrollMainToTop();
    },
  });
  const resetUpstreamNavigation = useCallback(() => {
    clearModuleNavigationState("upstream");
    setQuery("");
    setUpstreamView(DEFAULT_UP_VIEW);
    setUpFilter(DEFAULT_UP_FILTER);
    setUpstreamSaveError("");
    setUpRoute(getModuleListRoute("upstream"));
  }, [setQuery, setUpRoute]);
  const upGoList = useCallback(() => {
    clearModuleNavigationState("upstream");
    setUpstreamSaveError("");
    setUpRoute(getModuleListRoute("upstream"));
    scrollMainToTop();
  }, [setUpRoute]);
  const upGoDetail = useCallback((systemId) => {
    setUpstreamSaveError("");
    setUpRoute(getModuleDetailRoute("upstream", systemId));
    scrollMainToTop();
  }, [setUpRoute]);
  const upGoEdit = useCallback((systemId) => {
    setUpstreamSaveError("");
    setUpRoute(getModuleEditRoute("upstream", systemId));
    scrollMainToTop();
  }, [setUpRoute]);
  const upOpen = (systemId) => {
    pushModuleNavigationState("upstream", buildNavigationSnapshot());
    setUpstreamSaveError("");
    setUpRoute(getModuleDetailRoute("upstream", systemId));
    scrollMainToTop();
  };

  const handleSaveUpstream = async (system, oldId) => {
    if (!canEdit) {
      setAuthError("");
      setLoginOpen(true);
      return false;
    }
    setUpstreamSaveError("");
    try {
      await saveUpstreamSystem(system, oldId);
      await loadUpstreamData();
      clearModuleNavigationState("upstream");
      setUpRoute(getModuleDetailRoute("upstream", system.id));
      await loadUpstreamDetail(system.id);
      scrollMainToTop();
      return true;
    } catch (error) {
      if (isUnauthorizedError(error)) return false;
      setUpstreamSaveError(getErrorMessage(error, "保存上游系统失败。"));
      return false;
    }
  };
  // 二次确认由调用方（列表 RowActions / 详情 / 编辑器）通过 confirmDelete 负责。
  const handleDeleteUpstream = async (systemId) => {
    await runProtectedMutation(async () => {
      await deleteUpstreamSystem(systemId);
      await loadUpstreamData();
      clearModuleNavigationState("upstream");
      setQuery("");
      setUpFilter(DEFAULT_UP_FILTER);
      setUpstreamSaveError("");
      setUpRoute(getModuleListRoute("upstream"));
      scrollMainToTop();
    }, "删除上游系统失败。", "upstream:write");
  };
  const handleToggleUpstream = async (systemId, status) => {
    if (!canEdit) {
      setAuthError("");
      setLoginOpen(true);
      return;
    }
    const previousSystem = upstreamSystems.find((item) => item.id === systemId);
    if (!previousSystem) return;

    setUpstreamPendingIds((prev) => (prev.includes(systemId) ? prev : [...prev, systemId]));
    setUpstreamSystems((prev) => prev.map((item) => (
      item.id === systemId ? { ...item, status } : item
    )));
    setCurrentUpstream((prev) => (
      prev?.id === systemId ? { ...prev, status } : prev
    ));

    try {
      const updatedSystem = await patchUpstreamStatus(systemId, status);
      setUpstreamSystems((prev) => prev.map((item) => (
        item.id === systemId ? { ...item, ...updatedSystem } : item
      )));
      setCurrentUpstream((prev) => (
        prev?.id === systemId ? { ...prev, ...updatedSystem } : prev
      ));
    } catch (error) {
      if (!isUnauthorizedError(error)) {
        toast.error(getErrorMessage(error, "更新上游系统状态失败。"));
      }
      setUpstreamSystems((prev) => prev.map((item) => (
        item.id === systemId ? previousSystem : item
      )));
      setCurrentUpstream((prev) => (
        prev?.id === systemId ? previousSystem : prev
      ));
    } finally {
      setUpstreamPendingIds((prev) => prev.filter((id) => id !== systemId));
    }
  };

  const filteredUpstreamSystems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return upstreamSystems.filter((item) => {
      if (upFilter.status && item.status !== upFilter.status) return false;
      if (upFilter.dbType && item.dbType !== upFilter.dbType) return false;
      if (!normalizedQuery) return true;
      return [item.id, item.abbr, item.name, item.owner, item.dept, item.desc].some((value) =>
        String(value || "").toLowerCase().includes(normalizedQuery),
      );
    });
  }, [upstreamSystems, query, upFilter]);

  const currentUpstreamEdit = useMemo(() => {
    if (upRoute.page !== "edit" || !upRoute.id) return null;
    return currentUpstream || upstreamSystems.find((item) => item.id === upRoute.id);
  }, [upRoute, upstreamSystems, currentUpstream]);

  return {
    upstreamSystems,
    upstreamDbTypes,
    upstreamDeptOptions,
    currentUpstream,
    upstreamPendingIds,
    upstreamLoading,
    upstreamDetailLoading,
    upstreamError,
    upstreamSaveError,
    setUpstreamSaveError,
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
