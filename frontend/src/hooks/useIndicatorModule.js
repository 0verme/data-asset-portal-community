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
  createIndicator,
  deleteIndicator,
  getIndicatorList,
  updateIndicator,
  updateIndicatorStatus,
} from "../api/indicator.js";
import { isUnauthorizedError } from "../api/http.js";
import { DEFAULT_INDICATOR_ROUTE } from "../config/defaults.ts";
import { getErrorMessage, scrollMainToTop } from "../utils/ui.ts";

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
}) {
  const [indicators, setIndicators] = useState([]);
  const [indicatorLoading, setIndicatorLoading] = useState(false);
  const [indicatorError, setIndicatorError] = useState("");
  const [indicatorLoaded, setIndicatorLoaded] = useState(false);
  const [indicatorPendingIds, setIndicatorPendingIds] = useState([]);
  const [indicatorSaveBusy, setIndicatorSaveBusy] = useState(false);
  const [indicatorSaveError, setIndicatorSaveError] = useState("");
  const [indicatorActionError, setIndicatorActionError] = useState("");

  const loadIndicatorData = useCallback(async () => {
    setIndicatorLoading(true);
    setIndicatorError("");
    try {
      setIndicators(await getIndicatorList());
      setIndicatorLoaded(true);
    } catch (error) {
      setIndicatorError(getErrorMessage(error, "指标数据加载失败。"));
    } finally {
      setIndicatorLoading(false);
    }
  }, []);

  useEffect(() => {
    if (active && !indicatorLoaded && !indicatorLoading) {
      loadIndicatorData();
    }
  }, [active, indicatorLoaded, indicatorLoading, loadIndicatorData]);

  const indicatorBack = () => {
    setIndicatorRoute(DEFAULT_INDICATOR_ROUTE);
    scrollMainToTop();
  };

  const indicatorCloseDetail = () => {
    setIndicatorRoute(DEFAULT_INDICATOR_ROUTE);
  };

  const indicatorCreate = () => {
    requireLogin(() => {
      setIndicatorRoute({ page: "new", id: null });
      scrollMainToTop();
    }, "indicator:write");
  };

  const indicatorEdit = (indicatorId) => {
    requireLogin(() => {
      setIndicatorRoute({ page: "edit", id: indicatorId });
      scrollMainToTop();
    }, "indicator:write");
  };

  const indicatorViewDetail = (indicatorId) => {
    setIndicatorRoute({ page: "view", id: indicatorId });
  };

  const handleSaveIndicator = async (payload) => {
    if (!canEdit) {
      setAuthError("");
      setLoginOpen(true);
      return;
    }
    if (indicatorSaveBusy) return;
    setIndicatorSaveError("");
    setIndicatorActionError("");
    setIndicatorSaveBusy(true);
    try {
      if (indicatorRoute.page === "edit" && indicatorRoute.id) {
        await updateIndicator(indicatorRoute.id, payload);
      } else {
        await createIndicator(payload);
      }
      await loadIndicatorData();
      setIndicatorSaveError("");
      setIndicatorRoute(DEFAULT_INDICATOR_ROUTE);
      scrollMainToTop();
    } catch (error) {
      if (!isUnauthorizedError(error)) {
        setIndicatorSaveError(getErrorMessage(error, "保存指标失败。"));
      }
    } finally {
      setIndicatorSaveBusy(false);
    }
  };

  // 二次确认由调用方（列表 RowActions / 编辑器）通过 confirmDelete 负责，此处直接执行删除。
  const handleDeleteIndicator = async (indicatorId) => {
    if (!indicatorId) return;
    if (!canEdit) {
      setAuthError("");
      setLoginOpen(true);
      return;
    }
    setIndicatorActionError("");
    try {
      await deleteIndicator(indicatorId);
      await loadIndicatorData();
      if (indicatorRoute.id === indicatorId) {
        setIndicatorRoute(DEFAULT_INDICATOR_ROUTE);
      }
      scrollMainToTop();
    } catch (error) {
      if (!isUnauthorizedError(error)) {
        setIndicatorActionError(getErrorMessage(error, "删除指标失败。"));
      }
    }
  };

  const handleToggleIndicatorStatus = async (indicator) => {
    if (!canEdit) {
      setAuthError("");
      setLoginOpen(true);
      return;
    }
    setIndicatorActionError("");
    const nextStatus = indicator.status === "enabled" ? "disabled" : "enabled";
    setIndicatorPendingIds((prev) => (prev.includes(indicator.id) ? prev : [...prev, indicator.id]));
    setIndicators((prev) => prev.map((item) => (item.id === indicator.id ? { ...item, status: nextStatus } : item)));

    try {
      await updateIndicatorStatus(indicator.id, nextStatus);
      await loadIndicatorData();
    } catch (error) {
      if (!isUnauthorizedError(error)) {
        setIndicatorActionError(getErrorMessage(error, "更新指标状态失败。"));
      }
      setIndicators((prev) => prev.map((item) => (item.id === indicator.id ? indicator : item)));
    } finally {
      setIndicatorPendingIds((prev) => prev.filter((id) => id !== indicator.id));
    }
  };

  const indicatorFacets = useMemo(() => indicators.reduce((acc, item) => {
    acc.dimension[item.dimension] = (acc.dimension[item.dimension] || 0) + 1;
    acc.status[item.status] = (acc.status[item.status] || 0) + 1;
    return acc;
  }, { dimension: {}, status: {} }), [indicators]);

  const filteredIndicators = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return indicators.filter((item) => {
      if (indicatorFilter.dimension !== "all" && item.dimension !== indicatorFilter.dimension) return false;
      if (indicatorFilter.status !== "all" && item.status !== indicatorFilter.status) return false;
      if (!normalizedQuery) return true;
      return [
        item.id,
        item.name,
        item.meaning,
        item.resultTableName,
        item.resultFieldName,
        item.caliber,
        item.path,
      ].some((value) => String(value || "").toLowerCase().includes(normalizedQuery));
    });
  }, [indicators, indicatorFilter, query]);

  const currentIndicatorEdit = useMemo(() => {
    if (indicatorRoute.page !== "edit" || !indicatorRoute.id) return null;
    return indicators.find((item) => item.id === indicatorRoute.id) || null;
  }, [indicatorRoute, indicators]);

  const currentIndicatorDetail = useMemo(() => {
    if (indicatorRoute.page !== "view" || !indicatorRoute.id) return null;
    return indicators.find((item) => item.id === indicatorRoute.id) || null;
  }, [indicatorRoute, indicators]);

  return {
    indicators,
    indicatorLoading,
    indicatorError,
    indicatorLoaded,
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
    filteredIndicators,
    currentIndicatorEdit,
    currentIndicatorDetail,
    canEdit,
  };
}
