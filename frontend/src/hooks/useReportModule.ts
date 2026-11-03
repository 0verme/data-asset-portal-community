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

import { createReport, deleteReport, getReportDetail, getReportPage, updateReport, type ReportPageResult } from '../api/report.ts';
import type { MockReportItem } from '../data/reports.ts';
import { isUnauthorizedError } from '../api/http.ts';
import { normalizeApiError } from '../api/errorNormalizer.ts';
import { DEFAULT_REPORT_ROUTE } from '../config/defaults.ts';
import { getErrorMessage, scrollMainToTop } from '../utils/ui.ts';
import { clearFormFieldErrors } from '../ui/formErrors.ts';
import { toast } from '../ui/index.ts';
import { mapReportApiFieldErrors } from '../components/report/reportFormErrors.ts';
import type { ReportFilter, ReportRoute } from '../routing/types.ts';
import type { FormFieldErrors } from '../ui/formErrors.ts';

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
  reportTotal: number;
  reportCount: number;
  reportPage: number;
  setReportPage: React.Dispatch<React.SetStateAction<number>>;
  reportPageSize: number;
  setReportPageSize: React.Dispatch<React.SetStateAction<number>>;
  reportSort: string;
  setReportSort: React.Dispatch<React.SetStateAction<string>>;
  reportDetailLoading: boolean;
  reportDetailError: string;
  retryReportDetail: () => void;
  loadReportData: () => Promise<void>;
  reportSaveBusy: boolean;
  reportSaveFieldErrors: FormFieldErrors;
  reportSaveFieldErrorFocusRequest: FormFieldErrors | null;
  clearReportSaveFieldError: (field: string) => void;
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
  const [reportSaveFieldErrors, setReportSaveFieldErrors] = useState<FormFieldErrors>({});
  const [reportSaveFieldErrorFocusRequest, setReportSaveFieldErrorFocusRequest] =
    useState<FormFieldErrors | null>(null);
  const reportSaveInFlight = useRef(false);

  const [reportPage, setReportPage] = useState(1);
  const [reportPageSize, setReportPageSize] = useState(20);
  const [reportSort, setReportSort] = useState('code:asc');
  const [pageData, setPageData] = useState<ReportPageResult | null>(null);
  const listSequence = useRef(0);
  const listKey = JSON.stringify([active, query, reportFilter, reportPage, reportPageSize, reportSort, canEdit]);
  const latestListKey = useRef(listKey);
  latestListKey.current = listKey;
  const [detail, setDetail] = useState<{ key: string; item: MockReportItem | null; error: string }>({ key: '', item: null, error: '' });
  const [detailVersion, setDetailVersion] = useState(0);
  const detailKey = JSON.stringify([active, reportRoute.page, reportRoute.code, canEdit, detailVersion]);
  const latestDetailKey = useRef(detailKey);
  latestDetailKey.current = detailKey;
  const needsDetail = ['view', 'edit'].includes(reportRoute.page) && Boolean(reportRoute.code);
  const reportDetailLoading = needsDetail && detail.key !== detailKey;
  const reportDetailError = needsDetail && detail.key === detailKey ? detail.error : '';

  const loadReportData = useCallback(async (): Promise<void> => {
    const sequence = ++listSequence.current;
    setReportLoading(true);
    setReportError('');
    try {
      const result = await getReportPage({
        keyword: query, type: reportFilter.type === 'all' ? undefined : reportFilter.type || undefined,
        status: reportFilter.status === 'all' ? undefined : reportFilter.status || undefined,
        ownerDept: reportFilter.ownerDept === 'all' ? undefined : reportFilter.ownerDept || undefined,
        page: reportPage, pageSize: reportPageSize,
        sortKey: reportSort.split(':')[0], sortDirection: reportSort.split(':')[1],
      });
      if (sequence !== listSequence.current || latestListKey.current !== listKey) return;
      if (result.pageSize !== reportPageSize) setReportPageSize(result.pageSize);
      const lastPage = Math.max(1, Math.ceil(result.total / result.pageSize));
      if (reportPage > lastPage) { setReportPage(lastPage); return; }
      setReports(result.items);
      setPageData(result);
      setReportLoaded(true);
    } catch (error: unknown) {
      if (sequence === listSequence.current && latestListKey.current === listKey) {
        setReportError(getErrorMessage(error, '加载报表资产失败。'));
      }
    } finally {
      if (sequence === listSequence.current && latestListKey.current === listKey) setReportLoading(false);
    }
  }, [query, reportFilter, reportPage, reportPageSize, reportSort, listKey]);
  const reloadRef = useRef(loadReportData);
  reloadRef.current = loadReportData;

  useEffect(() => {
    if (active) void loadReportData();
    return () => { listSequence.current += 1; };
  }, [active, loadReportData]);

  useEffect(() => {
    setReportPage(1);
  }, [query, reportFilter, reportPageSize, reportSort]);

  useEffect(() => {
    if (!active || !needsDetail || !reportRoute.code) return;
    let cancelled = false;
    void getReportDetail(reportRoute.code).then((item) => {
      if (!cancelled && latestDetailKey.current === detailKey) {
        setDetail({ key: detailKey, item, error: '' });
      }
    }).catch((error: unknown) => {
      if (!cancelled && latestDetailKey.current === detailKey) {
        setDetail({ key: detailKey, item: null, error: getErrorMessage(error, '报表详情加载失败。') });
      }
    });
    return () => { cancelled = true; };
  }, [active, needsDetail, reportRoute.code, detailKey]);

  const clearReportSaveFieldError = (field: string): void => {
    setReportSaveFieldErrors((current) => clearFormFieldErrors(current, field));
  };

  const reportBack = (): void => {
    setReportSaveFieldErrors({});
    setReportSaveFieldErrorFocusRequest(null);
    setReportRoute(DEFAULT_REPORT_ROUTE);
    scrollMainToTop();
  };

  const reportCloseDetail = (): void => {
    setReportRoute(DEFAULT_REPORT_ROUTE);
  };

  const reportCreate = (): void => {
    requireLogin(() => {
      setReportSaveFieldErrors({});
      setReportSaveFieldErrorFocusRequest(null);
      setReportRoute({ page: 'new', code: null });
      scrollMainToTop();
    }, 'report:write');
  };

  const reportEdit = (reportCode: string): void => {
    requireLogin(() => {
      setReportSaveFieldErrors({});
      setReportSaveFieldErrorFocusRequest(null);
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
    if (reportSaveInFlight.current) return;
    reportSaveInFlight.current = true;
    const isEditing = reportRoute.page === 'edit' && Boolean(reportRoute.code);
    setReportSaveFieldErrors({});
    setReportSaveFieldErrorFocusRequest(null);
    setReportSaveBusy(true);
    try {
      if (isEditing && reportRoute.code) {
        await updateReport(reportRoute.code, payload);
      } else {
        await createReport(payload);
      }
      await reloadRef.current();
      toast.success(isEditing ? '报表已更新' : '报表已创建');
      setReportSaveFieldErrors({});
      setReportSaveFieldErrorFocusRequest(null);
      setReportRoute(DEFAULT_REPORT_ROUTE);
      scrollMainToTop();
    } catch (error: unknown) {
      if (isUnauthorizedError(error)) return;
      const mappedErrors = mapReportApiFieldErrors(error);
      const hasFieldErrors = Object.keys(mappedErrors.fieldErrors).length > 0;
      if (hasFieldErrors) {
        setReportSaveFieldErrors(mappedErrors.fieldErrors);
        setReportSaveFieldErrorFocusRequest(mappedErrors.fieldErrors);
      }
      if (!hasFieldErrors || mappedErrors.hasUnmappedErrors) {
        toast.error(normalizeApiError(error).safeMessage);
      }
    } finally {
      reportSaveInFlight.current = false;
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
    try {
      await deleteReport(reportCode);
      await reloadRef.current();
      if (reportRoute.code === reportCode) {
        setReportRoute(DEFAULT_REPORT_ROUTE);
      }
      toast.success('报表已删除');
      scrollMainToTop();
    } catch (error: unknown) {
      if (!isUnauthorizedError(error)) toast.error(normalizeApiError(error).safeMessage);
    }
  };

  const reportFacets = pageData?.facets || { type: {}, status: {}, ownerDept: {} };
  const filteredReports = useMemo<EnrichedReportItem[]>(() => reports.map((item) => ({
    ...item, relatedTableCount: getRelatedTableCount(item), relatedIndicatorCount: getRelatedIndicatorCount(item),
  })), [reports]);
  const current = detail.key === detailKey ? detail.item : null;
  const currentReportEdit = reportRoute.page === 'edit' ? current : null;
  const currentReportDetail: EnrichedReportItem | null = reportRoute.page === 'view' && current ? {
    ...current, relatedTableCount: getRelatedTableCount(current), relatedIndicatorCount: getRelatedIndicatorCount(current),
  } : null;

  return {
    reports,
    reportLoading,
    reportError,
    reportLoaded,
    reportTotal: pageData?.total || 0, reportCount: pageData?.stats.reportCount || 0,
    reportPage, setReportPage, reportPageSize, setReportPageSize, reportSort, setReportSort,
    reportDetailLoading, reportDetailError, retryReportDetail: () => setDetailVersion((version) => version + 1),
    loadReportData,
    reportSaveBusy,
    reportSaveFieldErrors,
    reportSaveFieldErrorFocusRequest,
    clearReportSaveFieldError,
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
