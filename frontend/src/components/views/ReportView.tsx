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

import { useTranslation } from "react-i18next";

import type { UseReportModuleResult } from "../../hooks/useReportModule.ts";
import type { ReportRoute } from "../../routing/types.ts";
import type { ViewMode } from "../common/ViewModeSwitcher.tsx";
import { Select, TablePagination } from "../../ui/index.ts";
import {
    confirmDeleteAction,
    EmptyState,
    ErrorState,
    LoadingState,
} from "../common/index.ts";
import {
    ReportDetailDrawer,
    ReportEditor,
    ReportList,
} from "../ReportPages.tsx";

export interface ReportViewProps {
    report: UseReportModuleResult;
    query: string;
    reportRoute: ReportRoute;
    view: ViewMode;
    onChangeView: (view: ViewMode) => void;
    canEdit?: boolean | undefined;
}

export function ReportView({
    report,
    query,
    reportRoute,
    view,
    onChangeView,
    canEdit = false,
}: ReportViewProps) {
    const { t } = useTranslation("report");
    const {
        reportLoading,
        reportError,
        reportTotal, reportPage, setReportPage, reportPageSize, setReportPageSize,
        reportSort, setReportSort, reportDetailLoading, reportDetailError, retryReportDetail,
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
        filteredReports,
        currentReportEdit,
        currentReportDetail,
    } = report;

    if (reportDetailLoading || (reportRoute.page === 'list' && reportLoading)) {
        return (
            <LoadingState
                title={reportDetailLoading ? t("view.loadingDetail") : t("view.loadingList")}
                desc={t("view.loadingDescription")}
            />
        );
    }

    if (reportDetailError || (reportRoute.page === 'list' && reportError)) {
        return (
            <ErrorState
                title={t("view.loadError")}
                desc={reportDetailError || reportError}
                onRetry={reportDetailError ? retryReportDetail : loadReportData}
            />
        );
    }
    if (!canEdit && ["new", "edit"].includes(reportRoute.page)) {
        return (
            <EmptyState
                title={t("view.permissionTitle")}
                desc={t("view.permissionDescription")}
            />
        );
    }

    if (reportRoute.page === "new") {
        return (
            <ReportEditor
                mode="new"
                initial={null}
                onSave={handleSaveReport}
                onCancel={reportBack}
                onDelete={() => undefined}
                saveBusy={reportSaveBusy}
                serverFieldErrors={reportSaveFieldErrors}
                serverFieldErrorFocusRequest={reportSaveFieldErrorFocusRequest}
                onClearServerFieldError={clearReportSaveFieldError}
            />
        );
    }

    if (reportRoute.page === "edit") {
        if (!currentReportEdit) {
            return <EmptyState title={t("view.missing")} />;
        }

        return (
            <ReportEditor
                mode="edit"
                initial={currentReportEdit}
                onSave={handleSaveReport}
                onCancel={reportBack}
                onDelete={async () => {
                    if (
                        await confirmDeleteAction({
                            name: currentReportEdit.code,
                            typeLabel: t("deleteConfirm.typeLabel"),
                            impact: t("deleteConfirm.impact"),
                            consequences: [
                                t("deleteConfirm.serverCheck"),
                                t("deleteConfirm.serverReason"),
                            ],
                            confirmKeyword: currentReportEdit.code,
                            confirmKeywordLabel: t("deleteConfirm.keywordLabel"),
                        })
                    ) {
                        await handleDeleteReport(currentReportEdit.code);
                    }
                }}
                saveBusy={reportSaveBusy}
                serverFieldErrors={reportSaveFieldErrors}
                serverFieldErrorFocusRequest={reportSaveFieldErrorFocusRequest}
                onClearServerFieldError={clearReportSaveFieldError}
            />
        );
    }

    return (
        <>
            <ReportList
                reports={filteredReports}
                total={reportTotal}
                query={query}
                view={view}
                onChangeView={onChangeView}
                onView={reportViewDetail}
                onEdit={reportEdit}
                onNew={reportCreate}
                canEdit={canEdit}
            />

            <div className="catalog-pagination-footer">
                <label className="catalog-list-sort">
                    <span>{t("view.sort")}</span>
                    <Select<string>
                        aria-label={t("view.sortLabel")}
                        className="table-list-sort"
                        value={reportSort}
                        onValueChange={(value) => setReportSort(value || 'code:asc')}
                        items={[
                            { label: t("view.sortCodeAsc"), value: 'code:asc' },
                            { label: t("view.sortCodeDesc"), value: 'code:desc' },
                            { label: t("view.sortNameAsc"), value: 'name:asc' },
                            { label: t("view.sortNameDesc"), value: 'name:desc' },
                        ]}
                    />
                </label>
                <TablePagination
                    page={reportPage}
                    pageSize={reportPageSize}
                    total={reportTotal}
                    onPageChange={setReportPage}
                    onPageSizeChange={setReportPageSize}
                    ariaLabel={t("view.pagination")}
                />
            </div>

            <ReportDetailDrawer
                open={Boolean(currentReportDetail)}
                report={currentReportDetail}
                onClose={reportCloseDetail}
                canEdit={canEdit}
                onEdit={reportEdit}
                onDelete={async (reportCode) => {
                    if (
                        await confirmDeleteAction({
                            name: reportCode,
                            typeLabel: t("deleteConfirm.typeLabel"),
                            impact: t("deleteConfirm.impact"),
                            consequences: [
                                t("deleteConfirm.serverCheckShort"),
                                t("deleteConfirm.keepHistory"),
                            ],
                            confirmKeyword: reportCode,
                            confirmKeywordLabel: t("deleteConfirm.keywordLabel"),
                        })
                    ) {
                        await handleDeleteReport(reportCode);
                    }
                }}
            />
        </>
    );
}
