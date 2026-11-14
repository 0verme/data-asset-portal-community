import type { Dispatch, SetStateAction } from "react";
import { useTranslation } from "react-i18next";

import type { UseIndicatorModuleResult } from "../../hooks/useIndicatorModule.ts";
import type { IndicatorFilter, IndicatorRoute } from "../../routing/types.ts";
import { DEFAULT_INDICATOR_FILTER } from "../../config/defaults.ts";
import {
  confirmDeleteAction,
  EmptyState,
  ErrorState,
  LoadingState,
} from "../common/index.ts";
import type { ViewMode } from "../common/ViewModeSwitcher.tsx";
import { IndicatorEditor } from "../IndicatorEditor.tsx";
import { IndicatorPage } from "../IndicatorPage.tsx";
import { Icon } from "../ui.tsx";
import { Select, TablePagination } from "../../ui/index.ts";

export interface IndicatorViewProps {
  indicator: UseIndicatorModuleResult;
  query: string;
  setQuery: (query: string) => void;
  indicatorRoute: IndicatorRoute;
  indicatorFilter: IndicatorFilter;
  setIndicatorFilter: Dispatch<SetStateAction<IndicatorFilter>>;
  indicatorView: ViewMode;
  setIndicatorView: Dispatch<SetStateAction<string>>;
}

export function IndicatorView({
  indicator,
  query,
  setQuery,
  indicatorRoute,
  indicatorFilter,
  setIndicatorFilter,
  indicatorView,
  setIndicatorView,
}: IndicatorViewProps) {
  const { t } = useTranslation("indicator");
  const {
    indicators,
    indicatorLoading,
    indicatorError,
    indicatorTotal, indicatorCount, indicatorPage, setIndicatorPage,
    indicatorPageSize, setIndicatorPageSize, indicatorSort, setIndicatorSort,
    indicatorDetailLoading, indicatorDetailError, retryIndicatorDetail,
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
    indicatorDimensions,
    currentIndicatorEdit,
    currentIndicatorDetail,
    canEdit,
  } = indicator;

  if (indicatorDetailLoading || (indicatorRoute.page === 'list' && indicatorLoading)) {
    return (
      <LoadingState
        title={indicatorDetailLoading ? t("view.loadingDetail") : t("view.loadingList")}
        desc={t("view.loadingDescription")}
      />
    );
  }
  if (indicatorDetailError || (indicatorRoute.page === 'list' && indicatorError)) {
    return (
      <ErrorState
        title={t("view.loadError")}
        desc={indicatorDetailError || indicatorError}
        onRetry={indicatorDetailError ? retryIndicatorDetail : loadIndicatorData}
      />
    );
  }
  if (!canEdit && ["new", "edit"].includes(indicatorRoute.page)) {
    return (
      <EmptyState
        title={t("view.permissionTitle")}
        desc={t("view.permissionDescription")}
      />
    );
  }
  if (indicatorRoute.page === "new") {
    return (
      <IndicatorEditor
        mode="new"
        initial={null}
        onSave={handleSaveIndicator}
        onCancel={indicatorBack}
        onDelete={() => undefined}
        saveBusy={indicatorSaveBusy}
        saveError={indicatorSaveError}
        onClearSaveError={() => setIndicatorSaveError("")}
      />
    );
  }
  if (indicatorRoute.page === "edit") {
    if (!currentIndicatorEdit) {
      return (
        <div className="empty">
          <div className="ec">
            <Icon name="inbox" size={26} />
          </div>
          <h4>{t("view.missingTitle")}</h4>
        </div>
      );
    }
    return (
      <IndicatorEditor
        mode="edit"
        initial={currentIndicatorEdit}
        onSave={handleSaveIndicator}
        onCancel={indicatorBack}
        onDelete={async () => {
          if (
            await confirmDeleteAction({
              name: currentIndicatorEdit.id,
              typeLabel: t("deleteConfirm.typeLabel"),
              impact: t("deleteConfirm.impact"),
              consequences: [
                t("deleteConfirm.serverCheck"),
                t("deleteConfirm.serverReason"),
              ],
              confirmKeyword: currentIndicatorEdit.id,
              confirmKeywordLabel: t("deleteConfirm.keywordLabel"),
            })
          ) {
            await handleDeleteIndicator(currentIndicatorEdit.id);
          }
        }}
        saveBusy={indicatorSaveBusy}
        saveError={indicatorSaveError}
        onClearSaveError={() => setIndicatorSaveError("")}
      />
    );
  }
  return (
    <>
    <IndicatorPage
      indicators={filteredIndicators}
      allIndicators={indicators}
      total={indicatorTotal}
      overallCount={indicatorCount}
      query={query}
      actionError={indicatorActionError}
      filter={indicatorFilter}
      view={indicatorView}
      pendingIds={indicatorPendingIds}
      dimensionOptions={indicatorDimensions}
      canEdit={canEdit}
      detailIndicator={currentIndicatorDetail}
      onChangeView={setIndicatorView}
      onNew={indicatorCreate}
      onView={indicatorViewDetail}
      onCloseDetail={indicatorCloseDetail}
      onEdit={indicatorEdit}
      onToggleStatus={handleToggleIndicatorStatus}
      onClearActionError={() => setIndicatorActionError("")}
      onClearDimension={() =>
        setIndicatorFilter((prev) => ({ ...prev, dimension: "all" }))
      }
      onClearStatus={() =>
        setIndicatorFilter((prev) => ({ ...prev, status: "all" }))
      }
      onClearQuery={() => setQuery("")}
      onResetFilters={() => {
        setIndicatorFilter(DEFAULT_INDICATOR_FILTER);
        setQuery("");
      }}
    />
    <div className="catalog-pagination-footer">
      <label className="catalog-list-sort">
        <span>{t("view.sort")}</span>
        <Select<string>
          aria-label={t("view.sortLabel")}
          className="table-list-sort"
          value={indicatorSort}
          onValueChange={(value) => setIndicatorSort(value || 'id:asc')}
          items={[
            { label: t("view.sortIdAsc"), value: 'id:asc' },
            { label: t("view.sortIdDesc"), value: 'id:desc' },
            { label: t("view.sortNameAsc"), value: 'name:asc' },
            { label: t("view.sortNameDesc"), value: 'name:desc' },
          ]}
        />
      </label>
      <TablePagination
        page={indicatorPage}
        pageSize={indicatorPageSize}
        total={indicatorTotal}
        onPageChange={setIndicatorPage}
        onPageSizeChange={setIndicatorPageSize}
        ariaLabel={t("view.pagination")}
      />
    </div>
    </>
  );
}
