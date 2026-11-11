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
                title={reportDetailLoading ? "加载报表详情" : "加载报表资产"}
                desc="正在准备报表清单、归属信息和关联引用。"
            />
        );
    }

    if (reportDetailError || (reportRoute.page === 'list' && reportError)) {
        return (
            <ErrorState
                title="报表资产加载失败"
                desc={reportDetailError || reportError}
                onRetry={reportDetailError ? retryReportDetail : loadReportData}
            />
        );
    }
    if (!canEdit && ["new", "edit"].includes(reportRoute.page)) {
        return (
            <EmptyState
                title="当前页面需要报表维护权限"
                desc="报表目录可以公开浏览，新增和编辑需要相应写权限。"
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
            return <EmptyState title="报表不存在" />;
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
                            typeLabel: "报表",
                            impact: "删除后会从台账中移除，并丢失当前维护的关联表和关联指标引用展示。",
                            consequences: [
                                "删除前以后端校验结果为准，不会绕过引用存在性检查。",
                                "若后端返回不可删除原因，页面会直接展示原始原因。",
                            ],
                            confirmKeyword: currentReportEdit.code,
                            confirmKeywordLabel: "请输入报表编码二次确认",
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
                    <span>排序</span>
                    <Select<string>
                        aria-label="报表排序"
                        className="table-list-sort"
                        value={reportSort}
                        onValueChange={(value) => setReportSort(value || 'code:asc')}
                        items={[
                            { label: '编码升序', value: 'code:asc' },
                            { label: '编码降序', value: 'code:desc' },
                            { label: '名称升序', value: 'name:asc' },
                            { label: '名称降序', value: 'name:desc' },
                        ]}
                    />
                </label>
                <TablePagination
                    page={reportPage}
                    pageSize={reportPageSize}
                    total={reportTotal}
                    onPageChange={setReportPage}
                    onPageSizeChange={setReportPageSize}
                    ariaLabel="报表分页"
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
                            typeLabel: "报表",
                            impact: "删除后会从台账中移除，并丢失当前维护的关联表和关联指标引用展示。",
                            consequences: [
                                "删除前以后端校验结果为准。",
                                "若报表已禁用但仍需历史留档，应优先保留而非删除。",
                            ],
                            confirmKeyword: reportCode,
                            confirmKeywordLabel: "请输入报表编码二次确认",
                        })
                    ) {
                        await handleDeleteReport(reportCode);
                    }
                }}
            />
        </>
    );
}
