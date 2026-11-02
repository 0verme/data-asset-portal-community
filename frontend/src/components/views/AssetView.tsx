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
        title="当前页面需要资产维护权限"
        desc="数据资产目录可以公开浏览，新增和编辑需要相应写权限。"
      />
    );
  }

  if (route.page === "home") {
    if (homeLoading) {
      return (
        <div aria-busy="true">
          <AdapterLoadingState
            title="加载资产元数据"
            desc="正在准备表清单、主题域和分层信息。"
            label="正在加载资产元数据"
          />
          <TablePagination
            ariaLabel="数据仓库资产表分页"
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
            title="资产列表加载失败"
            desc={homeError}
            onRetry={loadHomeData}
          />
          <TablePagination
            ariaLabel="数据仓库资产表分页"
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
              <span className="pt-code">DATA</span>数据资产
            </div>
            <div className="page-sub">
              共 <b>{totalTables}</b> 张表
              {selectedLayer ? (
                <>
                  ，分层 <b>{selectedLayer}</b>
                </>
              ) : null}
              {domain ? (
                <>
                  ，主题域 <b>{domain}</b>
                </>
              ) : null}
              {query ? <>，匹配 “{query}”</> : null}
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
                新增表
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
          ariaLabel="数据仓库资产表分页"
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
          title="加载表详情"
          desc={`正在准备 ${routeTable} 的字段与 DDL。`}
          label="正在加载表详情"
        />
      );
    }
    if (detailError) {
      return (
        <AdapterErrorState
          title="表详情加载失败"
          desc={detailError}
          onRetry={() => loadDetailData({ assetId: route.assetId, tableName: routeTable })}
        />
      );
    }
    if (!detailAsset) {
      return <AdapterEmptyState title="表不存在" />;
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
          title="加载编辑页"
          desc={`正在准备 ${routeTable} 的元数据和字段信息。`}
          label="正在加载编辑页"
        />
      );
    }
    if (detailError && !editingAsset) {
      return (
        <AdapterErrorState
          title="编辑页加载失败"
          desc={detailError}
          onRetry={() => loadDetailData({ assetId: route.assetId, tableName: routeTable })}
        />
      );
    }
    if (!editingAsset) {
      return <AdapterEmptyState title="表不存在" />;
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

  return <EmptyState title="页面不存在" />;
}
