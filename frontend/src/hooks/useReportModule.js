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

import { createReport, deleteReport, getReportList, updateReport } from "../api/report.js";
import { isUnauthorizedError } from "../api/http.js";
import { DEFAULT_REPORT_FILTER, DEFAULT_REPORT_ROUTE } from "../config/defaults.js";
import { getErrorMessage, scrollMainToTop } from "../utils/ui.js";

function getRelatedTableCount(item) {
  if (typeof item.relatedTableCount === "number") return item.relatedTableCount;
  return Array.isArray(item.relatedTables) ? item.relatedTables.length : 0;
}

function getRelatedIndicatorCount(item) {
  if (typeof item.relatedIndicatorCount === "number") return item.relatedIndicatorCount;
  return Array.isArray(item.relatedIndicators) ? item.relatedIndicators.length : 0;
}

export function useReportModule({
  active,
  query,
  reportRoute,
  setReportRoute,
  reportFilter,
  canEdit,
  requireLogin,
  setAuthError,
  setLoginOpen,
}) {
  const [reports, setReports] = useState([]);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState("");
  const [reportLoaded, setReportLoaded] = useState(false);
  const [reportSaveBusy, setReportSaveBusy] = useState(false);
  const [reportSaveError, setReportSaveError] = useState("");
  const [reportActionError, setReportActionError] = useState("");

  const loadReportData = useCallback(async () => {
    setReportLoading(true);
    setReportError("");
    try {
      const items = await getReportList();
      setReports(Array.isArray(items) ? items : []);
      setReportLoaded(true);
    } catch (error) {
      setReportError(error instanceof Error ? error.message : "加载报表资产失败。");
    } finally {
      setReportLoading(false);
    }
  }, []);

  useEffect(() => {
    if (active && !reportLoaded && !reportLoading) {
      loadReportData();
    }
  }, [active, reportLoaded, reportLoading, loadReportData]);

  const reportBack = () => {
    setReportRoute(DEFAULT_REPORT_ROUTE);
    scrollMainToTop();
  };

  const reportCloseDetail = () => {
    setReportRoute(DEFAULT_REPORT_ROUTE);
  };

  const reportCreate = () => {
    requireLogin(() => {
      setReportRoute({ page: "new", code: null });
      scrollMainToTop();
    });
  };

  const reportEdit = (reportCode) => {
    requireLogin(() => {
      setReportRoute({ page: "edit", code: reportCode });
      scrollMainToTop();
    });
  };

  const reportViewDetail = (reportCode) => {
    setReportRoute({ page: "view", code: reportCode });
  };

  const handleSaveReport = async (payload) => {
    if (!canEdit) {
      setAuthError("");
      setLoginOpen(true);
      return;
    }
    if (reportSaveBusy) return;
    setReportSaveError("");
    setReportActionError("");
    setReportSaveBusy(true);
    try {
      if (reportRoute.page === "edit" && reportRoute.code) {
        await updateReport(reportRoute.code, payload);
      } else {
        await createReport(payload);
      }
      await loadReportData();
      setReportRoute(DEFAULT_REPORT_ROUTE);
      scrollMainToTop();
    } catch (error) {
      if (!isUnauthorizedError(error)) {
        setReportSaveError(getErrorMessage(error, "保存报表失败。"));
      }
    } finally {
      setReportSaveBusy(false);
    }
  };

  const handleDeleteReport = async (reportCode) => {
    if (!reportCode) return;
    if (!canEdit) {
      setAuthError("");
      setLoginOpen(true);
      return;
    }
    setReportActionError("");
    try {
      await deleteReport(reportCode);
      await loadReportData();
      if (reportRoute.code === reportCode) {
        setReportRoute(DEFAULT_REPORT_ROUTE);
      }
      scrollMainToTop();
    } catch (error) {
      if (!isUnauthorizedError(error)) {
        setReportActionError(getErrorMessage(error, "删除报表失败。"));
      }
    }
  };

  const reportFacets = useMemo(() => reports.reduce((acc, item) => {
    acc.type[item.type] = (acc.type[item.type] || 0) + 1;
    acc.status[item.status] = (acc.status[item.status] || 0) + 1;
    acc.ownerDept[item.ownerDept] = (acc.ownerDept[item.ownerDept] || 0) + 1;
    return acc;
  }, { type: {}, status: {}, ownerDept: {} }), [reports]);

  const filteredReports = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return reports
      .filter((item) => {
        if (reportFilter.type !== DEFAULT_REPORT_FILTER.type && item.type !== reportFilter.type) return false;
        if (reportFilter.status !== DEFAULT_REPORT_FILTER.status && item.status !== reportFilter.status) return false;
        if (reportFilter.ownerDept !== DEFAULT_REPORT_FILTER.ownerDept && item.ownerDept !== reportFilter.ownerDept) return false;
        if (!normalizedQuery) return true;
        return [
          item.code,
          item.name,
          item.alias,
          item.ownerName,
          item.ownerDept,
          item.domain,
          item.purpose,
        ].some((value) => String(value || "").toLowerCase().includes(normalizedQuery));
      })
      .map((item) => ({
        ...item,
        relatedTableCount: getRelatedTableCount(item),
        relatedIndicatorCount: getRelatedIndicatorCount(item),
      }));
  }, [query, reportFilter, reports]);

  const currentReportEdit = useMemo(() => {
    if (reportRoute.page !== "edit" || !reportRoute.code) return null;
    return reports.find((item) => item.code === reportRoute.code) || null;
  }, [reportRoute, reports]);

  const currentReportDetail = useMemo(() => {
    if (reportRoute.page !== "view" || !reportRoute.code) return null;
    const item = reports.find((report) => report.code === reportRoute.code) || null;
    if (!item) return null;
    return {
      ...item,
      relatedTableCount: getRelatedTableCount(item),
      relatedIndicatorCount: getRelatedIndicatorCount(item),
    };
  }, [reportRoute, reports]);

  return {
    reports,
    reportLoading,
    reportError,
    reportLoaded,
    loadReportData,
    reportSaveBusy,
    reportSaveError,
    setReportSaveError,
    reportActionError,
    setReportActionError,
    reportBack,
    reportCloseDetail,
    reportCreate,
    reportEdit,
    reportViewDetail,
    handleSaveReport,
    handleDeleteReport,
    reportFacets,
    filteredReports,
    currentReportEdit,
    currentReportDetail,
  };
}
