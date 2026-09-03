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

import { createReport, deleteReport, getReportList, updateReport } from '../api/report.ts';
import type { MockReportItem } from '../data/reports.ts';
import { isUnauthorizedError } from '../api/http.ts';
import { DEFAULT_REPORT_FILTER, DEFAULT_REPORT_ROUTE } from '../config/defaults.ts';
import { getErrorMessage, scrollMainToTop } from '../utils/ui.ts';
import type { ReportFilter, ReportRoute } from '../routing/types.ts';

export interface EnrichedReportItem extends MockReportItem {
  relatedTableCount: number;
  relatedIndicatorCount: number;
}

function getRelatedTableCount(item: MockReportItem & { relatedTableCount?: number | undefined }): number {
  if (typeof item.relatedTableCount === 'number') return item.relatedTableCount;
  return Array.isArray(item.relatedTables) ? item.relatedTables.length : 0;
}

function getRelatedIndicatorCount(item: MockReportItem & { relatedIndicatorCount?: number | undefined }): number {
  if (typeof item.relatedIndicatorCount === 'number') return item.relatedIndicatorCount;
  return Array.isArray(item.relatedIndicators) ? item.relatedIndicators.length : 0;
}

export interface ReportFacets {
  type: Record<string, number>;
  status: Record<string, number>;
  ownerDept: Record<string, number>;
}

export interface UseReportModuleProps {
  active?: boolean | undefined;
  query: string;
  reportRoute: ReportRoute;
  setReportRoute: (route: ReportRoute) => void;
  reportFilter: ReportFilter;
  canEdit: boolean;
  requireLogin: (action: () => void, permission?: string) => boolean;
  setAuthError: (error: string) => void;
  setLoginOpen: (open: boolean) => void;
}

export interface UseReportModuleResult {
  reports: MockReportItem[];
  reportLoading: boolean;
  reportError: string;
  reportLoaded: boolean;
  loadReportData: () => Promise<void>;
  reportSaveBusy: boolean;
  reportSaveError: string;
  setReportSaveError: React.Dispatch<React.SetStateAction<string>>;
  reportActionError: string;
  setReportActionError: React.Dispatch<React.SetStateAction<string>>;
  reportBack: () => void;
  reportCloseDetail: () => void;
  reportCreate: () => void;
  reportEdit: (reportCode: string) => void;
  reportViewDetail: (reportCode: string) => void;
  handleSaveReport: (payload: MockReportItem) => Promise<void>;
  handleDeleteReport: (reportCode?: string) => Promise<void>;
  reportFacets: ReportFacets;
  filteredReports: EnrichedReportItem[];
  currentReportEdit: MockReportItem | null;
  currentReportDetail: EnrichedReportItem | null;
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
}: UseReportModuleProps): UseReportModuleResult {
  const [reports, setReports] = useState<MockReportItem[]>([]);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState('');
  const [reportLoaded, setReportLoaded] = useState(false);
  const [reportSaveBusy, setReportSaveBusy] = useState(false);
  const [reportSaveError, setReportSaveError] = useState('');
  const [reportActionError, setReportActionError] = useState('');

  const loadReportData = useCallback(async (): Promise<void> => {
    setReportLoading(true);
    setReportError('');
    try {
      const items = await getReportList();
      setReports(Array.isArray(items) ? items : []);
      setReportLoaded(true);
    } catch (error: unknown) {
      setReportError(error instanceof Error ? error.message : '加载报表资产失败。');
    } finally {
      setReportLoading(false);
    }
  }, []);

  useEffect(() => {
    if (active && !reportLoaded && !reportLoading) {
      loadReportData();
    }
  }, [active, reportLoaded, reportLoading, loadReportData]);

  const reportBack = (): void => {
    setReportRoute(DEFAULT_REPORT_ROUTE);
    scrollMainToTop();
  };

  const reportCloseDetail = (): void => {
    setReportRoute(DEFAULT_REPORT_ROUTE);
  };

  const reportCreate = (): void => {
    requireLogin(() => {
      setReportRoute({ page: 'new', code: null });
      scrollMainToTop();
    }, 'report:write');
  };

  const reportEdit = (reportCode: string): void => {
    requireLogin(() => {
      setReportRoute({ page: 'edit', code: reportCode });
      scrollMainToTop();
    }, 'report:write');
  };

  const reportViewDetail = (reportCode: string): void => {
    setReportRoute({ page: 'view', code: reportCode });
  };

  const handleSaveReport = async (payload: MockReportItem): Promise<void> => {
    if (!canEdit) {
      setAuthError('');
      setLoginOpen(true);
      return;
    }
    if (reportSaveBusy) return;
    setReportSaveError('');
    setReportActionError('');
    setReportSaveBusy(true);
    try {
      if (reportRoute.page === 'edit' && reportRoute.code) {
        await updateReport(reportRoute.code, payload);
      } else {
        await createReport(payload);
      }
      await loadReportData();
      setReportRoute(DEFAULT_REPORT_ROUTE);
      scrollMainToTop();
    } catch (error: unknown) {
      if (!isUnauthorizedError(error)) {
        setReportSaveError(getErrorMessage(error, '保存报表失败。'));
      }
    } finally {
      setReportSaveBusy(false);
    }
  };

  const handleDeleteReport = async (reportCode?: string): Promise<void> => {
    if (!reportCode) return;
    if (!canEdit) {
      setAuthError('');
      setLoginOpen(true);
      return;
    }
    setReportActionError('');
    try {
      await deleteReport(reportCode);
      await loadReportData();
      if (reportRoute.code === reportCode) {
        setReportRoute(DEFAULT_REPORT_ROUTE);
      }
      scrollMainToTop();
    } catch (error: unknown) {
      if (!isUnauthorizedError(error)) {
        setReportActionError(getErrorMessage(error, '删除报表失败。'));
      }
    }
  };

  const reportFacets = useMemo(
    () =>
      reports.reduce<ReportFacets>(
        (acc, item) => {
          if (item.type) {
            acc.type[item.type] = (acc.type[item.type] || 0) + 1;
          }
          if (item.status) {
            acc.status[item.status] = (acc.status[item.status] || 0) + 1;
          }
          if (item.ownerDept) {
            acc.ownerDept[item.ownerDept] = (acc.ownerDept[item.ownerDept] || 0) + 1;
          }
          return acc;
        },
        { type: {}, status: {}, ownerDept: {} },
      ),
    [reports],
  );

  const filteredReports = useMemo<EnrichedReportItem[]>(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return reports
      .filter((item) => {
        if (reportFilter.type !== DEFAULT_REPORT_FILTER.type && item.type !== reportFilter.type) return false;
        if (reportFilter.status !== DEFAULT_REPORT_FILTER.status && item.status !== reportFilter.status) return false;
        if (
          reportFilter.ownerDept !== DEFAULT_REPORT_FILTER.ownerDept &&
          item.ownerDept !== reportFilter.ownerDept
        ) {
          return false;
        }
        if (!normalizedQuery) return true;
        return [
          item.code,
          item.name,
          item.alias,
          item.ownerName,
          item.ownerDept,
          item.domain,
          item.purpose,
        ].some((value) => String(value || '').toLowerCase().includes(normalizedQuery));
      })
      .map((item) => ({
        ...item,
        relatedTableCount: getRelatedTableCount(item),
        relatedIndicatorCount: getRelatedIndicatorCount(item),
      }));
  }, [query, reportFilter, reports]);

  const currentReportEdit = useMemo(() => {
    if (reportRoute.page !== 'edit' || !reportRoute.code) return null;
    return reports.find((item) => item.code === reportRoute.code) || null;
  }, [reportRoute, reports]);

  const currentReportDetail = useMemo<EnrichedReportItem | null>(() => {
    if (reportRoute.page !== 'view' || !reportRoute.code) return null;
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
