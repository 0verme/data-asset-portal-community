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

import type { UseAssetModuleResult } from "../../hooks/useAssetModule.ts";
import type { AssetRoute } from "../../routing/types.ts";
import { DOMAIN_ORDER } from "../../config/assets.ts";
import { DetailPage } from "../DetailPage.tsx";
import { HomePage } from "../HomePage.tsx";
import { TableEditor } from "../TableEditor.tsx";
import {
  EmptyState as AdapterEmptyState,
  ErrorState as AdapterErrorState,
  LoadingState as AdapterLoadingState,
  TablePagination,
} from "../../ui/index.ts";
import { Icon } from "../ui.tsx";
import { EmptyState } from "../common/index.ts";
import { AssetViewModeSwitcher } from "./AssetViewModeSwitcher.tsx";
import type { ViewMode } from "../common/ViewModeSwitcher.tsx";

export interface AssetViewProps {
  asset: UseAssetModuleResult;
  query: string;
  route: AssetRoute;
  canEdit?: boolean | undefined;
}

export function AssetView({
  asset,
  query,
  route,
  canEdit = false,
}: AssetViewProps) {
  const { t } = useTranslation("warehouse");
  const {
    homeLoading,
    homeError,
    loadHomeData,
    page,
    pageSize,
    setPage,
    setPageSize,
    totalTables,
    detailAsset,
    detailFields,
    detailDDL,
    detailLoading,
    detailError,
    loadDetailData,
    layout,
    setLayout,
    domain,
    selectedLayer,
    visibleLayers,
    detailTab,
    setDetailTab,
    assetBack,
    assetOpen,
    assetGoList,
    assetGoDetail,
    assetCreate,
    assetEdit,
    handleSaveTable,
    handleDeleteTable,
    filteredTables,
    visibleDomains,
    editingAsset,
    existingNames,
  } = asset;
  const routeTable = route.table || "";

  if (!canEdit && ["edit", "new"].includes(route.page)) {
    return (
      <EmptyState
        title={t("permissionTitle")}
        desc={t("permissionDescription")}
      />
    );
  }

  if (route.page === "home") {
    if (homeLoading) {
      return (
        <div aria-busy="true">
          <AdapterLoadingState
            title={t("loadingTitle")}
            desc={t("loadingDescription")}
            label={t("loadingLabel")}
          />
          <TablePagination
            ariaLabel={t("tablePagination")}
            page={page}
            pageSize={pageSize}
            total={totalTables}
            loading
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        </div>
      );
    }
    if (homeError) {
      return (
        <div>
          <AdapterErrorState
            title={t("listErrorTitle")}
            desc={homeError}
            onRetry={loadHomeData}
          />
          <TablePagination
            ariaLabel={t("tablePagination")}
            page={page}
            pageSize={pageSize}
            total={totalTables}
            disabled
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        </div>
      );
    }
    return (
      <div className="asset-page">
        <div className="page-head">
          <div>
            <div className="page-title">
              <span className="pt-code">DATA</span>{t("pageTitle")}
            </div>
            <div className="page-sub">
              {t("tableCountPrefix")}<b>{totalTables}</b>{t("tableCountSuffix", { count: totalTables })}
              {selectedLayer ? <>{t("layerSummary", { layer: selectedLayer })}</> : null}
              {domain ? <>{t("domainSummary", { domain })}</> : null}
              {query ? <>{t("querySummary", { query })}</> : null}
            </div>
          </div>
          <div className="head-actions">
            <AssetViewModeSwitcher value={layout as ViewMode} onChange={setLayout} />
            {canEdit ? (
              <button
                className="btn primary"
                type="button"
                onClick={assetCreate}
              >
                <Icon name="plus" size={15} />
                {t("addTable")}
              </button>
            ) : null}
          </div>
        </div>
        <HomePage
          tables={filteredTables}
          layout={layout}
          query={query}
          onOpen={assetOpen}
        />
        <TablePagination
          ariaLabel={t("tablePagination")}
          page={page}
          pageSize={pageSize}
          total={totalTables}
          onPageChange={setPage}
          onPageSizeChange={(nextPageSize) => {
            setPage(1);
            setPageSize(nextPageSize);
          }}
        />
      </div>
    );
  }

  if (route.page === "detail") {
    if (detailLoading) {
      return (
        <AdapterLoadingState
          title={t("detailLoadingTitle")}
          desc={t("detailLoadingDescription", { tableName: routeTable })}
          label={t("detailLoadingLabel")}
        />
      );
    }
    if (detailError) {
      return (
        <AdapterErrorState
          title={t("detailErrorTitle")}
          desc={detailError}
          onRetry={() => loadDetailData({ assetId: route.assetId, tableName: routeTable })}
        />
      );
    }
    if (!detailAsset) {
      return <AdapterEmptyState title={t("tableNotFound")} />;
    }
    return (
      <DetailPage
        asset={detailAsset}
        fields={detailFields}
        ddl={detailDDL.ddl}
        ddlDialectLabel={detailDDL.ddlDialectLabel}
        tab={detailTab}
        onTabChange={setDetailTab}
        onBack={assetGoList}
        onBackToList={assetGoList}
        onEdit={canEdit ? () => assetEdit(detailAsset.name, detailAsset.assetId) : undefined}
      />
    );
  }

  if (route.page === "edit") {
    if (detailLoading && !editingAsset) {
      return (
        <AdapterLoadingState
          title={t("editorLoadingTitle")}
          desc={t("editorLoadingDescription", { tableName: routeTable })}
          label={t("editorLoadingLabel")}
        />
      );
    }
    if (detailError && !editingAsset) {
      return (
        <AdapterErrorState
          title={t("editorErrorTitle")}
          desc={detailError}
          onRetry={() => loadDetailData({ assetId: route.assetId, tableName: routeTable })}
        />
      );
    }
    if (!editingAsset) {
      return <AdapterEmptyState title={t("tableNotFound")} />;
    }
    return (
      <TableEditor
        mode="edit"
        initial={editingAsset}
        existingNames={existingNames}
        domains={visibleDomains.length ? visibleDomains : DOMAIN_ORDER}
        layers={visibleLayers}
        onSave={handleSaveTable}
        onCancel={() => assetGoDetail(editingAsset.name, editingAsset.assetId)}
        onBackToList={assetGoList}
        onBackToDetail={() => assetGoDetail(editingAsset.name, editingAsset.assetId)}
        onDelete={handleDeleteTable}
      />
    );
  }

  if (route.page === "new") {
    return (
      <TableEditor
        mode="new"
        existingNames={existingNames}
        domains={visibleDomains.length ? visibleDomains : DOMAIN_ORDER}
        layers={visibleLayers}
        defaultLayer={selectedLayer || "DWM"}
        onSave={handleSaveTable}
        onCancel={assetBack}
        onBackToList={assetGoList}
      />
    );
  }

  return <EmptyState title={t("pageNotFound")} />;
}
