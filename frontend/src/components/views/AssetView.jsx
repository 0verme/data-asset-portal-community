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

import { DetailPage } from "../DetailPage.jsx";
import { HomePage } from "../HomePage.jsx";
import { TableEditor } from "../TableEditor.jsx";
import { Icon } from "../ui.jsx";
import { EmptyState, ErrorState, LoadingState, ViewModeSwitcher } from "../common/index.js";
import { DOMAIN_ORDER } from "../../config/assets.js";

export function AssetView({ asset, query, route, canEdit = false }) {
  const {
    homeLoading,
    homeError,
    loadHomeData,
    page,
    pageCount,
    setPage,
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

  if (!canEdit && ["edit", "new"].includes(route.page)) {
    return <EmptyState title="当前页面需要资产维护权限" desc="数据资产目录可以公开浏览，新增和编辑需要相应写权限。" />;
  }

  if (route.page === "home") {
    if (homeLoading) {
      return <LoadingState title="加载资产元数据" desc="正在准备表清单、主题域和分层信息。" />;
    }
    if (homeError) {
      return <ErrorState title="资产列表加载失败" desc={homeError} onRetry={loadHomeData} />;
    }
    return (
      <div className="asset-page">
        <div className="page-head">
          <div>
            <div className="page-title"><span className="pt-code">DATA</span>数据资产</div>
            <div className="page-sub">
              共 <b>{totalTables}</b> 张表
              {selectedLayer ? <>，分层 <b>{selectedLayer}</b></> : null}
              {domain ? <>，主题域 <b>{domain}</b></> : null}
              {query ? <>，匹配 “{query}”</> : null}
            </div>
          </div>
          <div className="head-actions">
            <ViewModeSwitcher value={layout} onChange={setLayout} />
            {canEdit ? <button className="btn primary" onClick={assetCreate}><Icon name="plus" size={15} />新增表</button> : null}
          </div>
        </div>
        <HomePage tables={filteredTables} layout={layout} query={query} onOpen={assetOpen} />
        {pageCount > 1 ? (
          <div className="oplog-pager">
            <button className="btn" type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              <Icon name="chevron" size={14} />上一页
            </button>
            <span className="oplog-pager-info">第 {page} / {pageCount} 页</span>
            <button className="btn" type="button" disabled={page >= pageCount} onClick={() => setPage(page + 1)}>
              下一页<Icon name="chevron" size={14} />
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  if (route.page === "detail") {
    if (detailLoading) {
      return <LoadingState title="加载表详情" desc={`正在准备 ${route.table} 的字段与 DDL。`} />;
    }
    if (detailError) {
      return <ErrorState title="表详情加载失败" desc={detailError} onRetry={() => loadDetailData(route.table)} />;
    }
    if (!detailAsset) {
      return <EmptyState title="表不存在" />;
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
        onEdit={canEdit ? () => assetEdit(detailAsset.name) : undefined}
      />
    );
  }

  if (route.page === "edit") {
    if (detailLoading && !editingAsset) {
      return <LoadingState title="加载编辑页" desc={`正在准备 ${route.table} 的元数据和字段信息。`} />;
    }
    if (detailError && !editingAsset) {
      return <ErrorState title="编辑页加载失败" desc={detailError} onRetry={() => loadDetailData(route.table)} />;
    }
    if (!editingAsset) {
      return <EmptyState title="表不存在" />;
    }
    return (
      <TableEditor
        mode="edit"
        initial={editingAsset}
        existingNames={existingNames}
        domains={visibleDomains.length ? visibleDomains : DOMAIN_ORDER}
        layers={visibleLayers}
        onSave={handleSaveTable}
        onCancel={() => assetGoDetail(editingAsset.name)}
        onBackToList={assetGoList}
        onBackToDetail={() => assetGoDetail(editingAsset.name)}
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
