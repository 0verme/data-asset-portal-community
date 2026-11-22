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
import React from "react";

import type { UseAssetModuleResult } from "../../hooks/useAssetModule.ts";
import type { AssetRoute } from "../../routing/types.ts";
import { DOMAIN_ORDER } from "../../config/assets.ts";
import { DetailPage } from "../DetailPage.tsx";
import { HomePage } from "../HomePage.tsx";
import { TableEditor } from "../TableEditor.tsx";
import {
  Button,
  EmptyState as AdapterEmptyState,
  ErrorState as AdapterErrorState,
  LoadingState as AdapterLoadingState,
  TablePagination,
} from "../../ui/index.ts";
import { Icon } from "../ui.tsx";
import { EmptyState } from "../common/index.ts";
import { getWarehouseDomainLabel, getWarehouseLayerLabel } from "../warehouseLabels.ts";
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

  React.useEffect(() => {
    if (route.page !== "detail" || route.fieldId == null || detailLoading) return;
    const field = detailFields.find((item) => Number(item.fieldId) === route.fieldId);
    if (!field) return;
    window.requestAnimationFrame(() => {
      const row = document.getElementById(`asset-field-${route.fieldId}`);
      row?.scrollIntoView({ block: "center" });
      row?.focus({ preventScroll: true });
    });
  }, [route.page, route.fieldId, detailLoading, detailFields]);

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
            retryText={t("retry")}
            onRetry={loadHomeData}
          />
          <TablePagination
            ariaLabel={t("tablePagination")}
            page={page}
            pageSize={pageSize}
            total={null}
            disabled
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        </div>
      );
    }
    return (
      <div className="asset-page">
        <div className="page-head workspace-page-header">
          <div>
            <h1 className="page-title">
              <Icon name="table" size={21} />{t("pageTitle")}
            </h1>
            <div className="page-sub">
              {t("tableCountPrefix")}<b>{totalTables}</b>{t("tableCountSuffix", { count: totalTables })}
              {selectedLayer ? <>{t("layerSummary", { layer: getWarehouseLayerLabel(selectedLayer, visibleLayers.find((layer) => layer.code === selectedLayer)?.cn ?? selectedLayer, t) })}</> : null}
              {domain ? <>{t("domainSummary", { domain: getWarehouseDomainLabel(domain, t) })}</> : null}
              {query ? <>{t("querySummary", { query })}</> : null}
            </div>
          </div>
          <div className="head-actions">
            <AssetViewModeSwitcher value={layout as ViewMode} onChange={setLayout} />
            {canEdit ? (
              <Button
                variant="primary"
                className="btn primary"
                type="button"
                onClick={assetCreate}
              >
                <Icon name="plus" size={15} />
                {t("addTable")}
              </Button>
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
          retryText={t("retry")}
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
          retryText={t("retry")}
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
