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


import { ActionErrorBanner, confirmDeleteAction, EmptyState, ErrorState, LoadingState } from "../common/index.js";
import { ReportDetailDrawer, ReportEditor, ReportList } from "../ReportPages.jsx";

export function ReportView({ report, query, reportRoute, view, onChangeView, canEdit = false }) {
  const {
    reportLoading,
    reportError,
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
    filteredReports,
    currentReportEdit,
    currentReportDetail,
  } = report;

  if (reportLoading) {
    return <LoadingState title="加载报表资产" desc="正在准备报表清单、归属信息和关联引用。" />;
  }

  if (reportError) {
    return <ErrorState title="报表资产加载失败" desc={reportError} onRetry={loadReportData} />;
  }
  if (!canEdit && ["new", "edit"].includes(reportRoute.page)) {
    return <EmptyState title="当前页面需要报表维护权限" desc="报表目录可以公开浏览，新增和编辑需要相应写权限。" />;
  }

  if (reportRoute.page === "new") {
    return (
      <ReportEditor
        mode="new"
        onSave={handleSaveReport}
        onCancel={reportBack}
        saveBusy={reportSaveBusy}
        saveError={reportSaveError}
        onClearSaveError={() => setReportSaveError("")}
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
          if (await confirmDeleteAction({
            name: currentReportEdit.code,
            typeLabel: "报表",
            impact: "删除后会从台账中移除，并丢失当前维护的关联表和关联指标引用展示。",
            consequences: [
              "删除前以后端校验结果为准，不会绕过引用存在性检查。",
              "若后端返回不可删除原因，页面会直接展示原始原因。",
            ],
            confirmKeyword: currentReportEdit.code,
            confirmKeywordLabel: "请输入报表编码二次确认",
          })) {
            handleDeleteReport(currentReportEdit.code);
          }
        }}
        saveBusy={reportSaveBusy}
        saveError={reportSaveError}
        onClearSaveError={() => setReportSaveError("")}
      />
    );
  }

  return (
    <>
      <ActionErrorBanner message={reportActionError} onClose={() => setReportActionError("")} />

      <ReportList
        reports={filteredReports}
        query={query}
        view={view}
        onChangeView={onChangeView}
        onView={reportViewDetail}
        onEdit={reportEdit}
        onNew={reportCreate}
        canEdit={canEdit}
      />

      <ReportDetailDrawer
        open={Boolean(currentReportDetail)}
        report={currentReportDetail}
        onClose={reportCloseDetail}
        canEdit={canEdit}
        onEdit={reportEdit}
        onDelete={async (reportCode) => {
          if (await confirmDeleteAction({
            name: reportCode,
            typeLabel: "报表",
            impact: "删除后会从台账中移除，并丢失当前维护的关联表和关联指标引用展示。",
            consequences: [
              "删除前以后端校验结果为准。",
              "若报表已停用但仍需历史留档，应优先保留而非删除。",
            ],
            confirmKeyword: reportCode,
            confirmKeywordLabel: "请输入报表编码二次确认",
          })) {
            handleDeleteReport(reportCode);
          }
        }}
      />
    </>
  );
}
