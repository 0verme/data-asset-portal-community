import { IndicatorPage } from "../IndicatorPage.jsx";
import IndicatorEditor from "../IndicatorEditor.jsx";
import { Icon } from "../ui.jsx";
import { confirmDeleteAction, EmptyState, ErrorState, LoadingState } from "../common/index.js";
import { DEFAULT_INDICATOR_FILTER } from "../../config/defaults.ts";

export function IndicatorView({
  indicator,
  query,
  setQuery,
  indicatorRoute,
  indicatorFilter,
  setIndicatorFilter,
  indicatorView,
  setIndicatorView,
}) {
  const {
    indicators,
    indicatorLoading,
    indicatorError,
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
    filteredIndicators,
    currentIndicatorEdit,
    currentIndicatorDetail,
    canEdit,
  } = indicator;

  if (indicatorLoading) {
    return <LoadingState title="加载指标维护清单" desc="正在准备指标列表、维度和状态信息。" />;
  }
  if (indicatorError) {
    return <ErrorState title="指标维护加载失败" desc={indicatorError} onRetry={loadIndicatorData} />;
  }
  if (!canEdit && ["new", "edit"].includes(indicatorRoute.page)) {
    return <EmptyState title="当前页面需要指标维护权限" desc="指标目录可以公开浏览，新增和编辑需要相应写权限。" />;
  }
  if (indicatorRoute.page === "new") {
    return (
      <IndicatorEditor
        mode="new"
        onSave={handleSaveIndicator}
        onCancel={indicatorBack}
        saveBusy={indicatorSaveBusy}
        saveError={indicatorSaveError}
        onClearSaveError={() => setIndicatorSaveError("")}
      />
    );
  }
  if (indicatorRoute.page === "edit") {
    if (!currentIndicatorEdit) {
      return <div className="empty"><div className="ec"><Icon name="inbox" size={26} /></div><h4>指标不存在</h4></div>;
    }
    return (
      <IndicatorEditor
        mode="edit"
        initial={currentIndicatorEdit}
        onSave={handleSaveIndicator}
        onCancel={indicatorBack}
        onDelete={async () => {
          if (await confirmDeleteAction({
            name: currentIndicatorEdit.id,
            typeLabel: "指标",
            impact: "该指标删除后，可能影响指标口径、指标来源字段、指标结果表字段、报表引用、血缘关系和审计记录。若指标已被引用，应优先禁用，而不是删除。",
            consequences: [
              "删除前会以服务端校验结果为准，不会绕过引用关系检查。",
              "若后端返回不可删除原因，页面会直接展示原因。",
            ],
            confirmKeyword: currentIndicatorEdit.id,
            confirmKeywordLabel: "请输入指标 ID 二次确认",
          })) {
            handleDeleteIndicator(currentIndicatorEdit.id);
          }
        }}
        saveBusy={indicatorSaveBusy}
        saveError={indicatorSaveError}
        onClearSaveError={() => setIndicatorSaveError("")}
      />
    );
  }
  return (
    <IndicatorPage
      indicators={filteredIndicators}
      allIndicators={indicators}
      query={query}
      actionError={indicatorActionError}
      filter={indicatorFilter}
      view={indicatorView}
      pendingIds={indicatorPendingIds}
      canEdit={canEdit}
      detailIndicator={currentIndicatorDetail}
      onChangeView={setIndicatorView}
      onNew={indicatorCreate}
      onView={indicatorViewDetail}
      onCloseDetail={indicatorCloseDetail}
      onEdit={indicatorEdit}
      onToggleStatus={handleToggleIndicatorStatus}
      onClearActionError={() => setIndicatorActionError("")}
      onClearDimension={() => setIndicatorFilter((prev) => ({ ...prev, dimension: "all" }))}
      onClearStatus={() => setIndicatorFilter((prev) => ({ ...prev, status: "all" }))}
      onClearQuery={() => setQuery("")}
      onResetFilters={() => {
        setIndicatorFilter(DEFAULT_INDICATOR_FILTER);
        setQuery("");
      }}
    />
  );
}
