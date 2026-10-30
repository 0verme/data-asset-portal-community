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

import type { PublicUpstreamSystem } from "../../api/upstream.ts";
import type { MockUpstreamSystem } from "../../data/upstreamSystems.ts";
import type { UseUpstreamModuleResult } from "../../hooks/useUpstreamModule.ts";
import type { MappingRoute, UpstreamRoute } from "../../routing/types.ts";
import {
  normalizeDictOptions,
  type OptionInputItem,
} from "../../utils/optionUtils.ts";
import type { ViewMode } from "../common/ViewModeSwitcher.tsx";
import {
  confirmDeleteAction,
  EmptyState,
  ErrorState,
  LoadingState,
} from "../common/index.ts";
import {
  UpstreamDetail,
  UpstreamEditor,
  UpstreamList,
} from "../UpstreamPages.tsx";
import { Icon } from "../ui.tsx";
import { Button, Select } from "../../ui/index.ts";

type RequireLogin = (action?: () => void, permission?: string) => boolean;
type UpstreamSystem = PublicUpstreamSystem | MockUpstreamSystem;

const confirmDeleteUpstream =
  (
    system: UpstreamSystem | null | undefined,
    run: (systemId: string) => void | Promise<unknown>,
  ) =>
  async (): Promise<void> => {
    if (!system) return;
    if (
      await confirmDeleteAction({
        name: system.name || system.id,
        typeLabel: "上游卸数系统",
        impact:
          "该系统删除后，可能影响入仓表清单、卸数计划、字段映射和历史记录。若该系统不再使用，建议优先禁用。",
        consequences: [
          "删除前必须校验是否存在入仓表、字段映射、卸数计划和历史记录。",
          "存在任一关联时，应由后端拒绝删除并返回明确原因。",
        ],
        confirmKeyword: system.id || "",
        confirmKeywordLabel: "请输入系统标识二次确认",
      })
    ) {
      await run(system.id);
    }
  };

export interface UpstreamViewProps {
  upstream: UseUpstreamModuleResult;
  query: string;
  statusOptions: readonly OptionInputItem[];
  requireLogin: RequireLogin;
  canEdit?: boolean | undefined;
  upRoute: UpstreamRoute;
  setUpRoute: (route: UpstreamRoute) => void;
  onViewTables?: ((route: Partial<MappingRoute>) => void) | undefined;
}

export function UpstreamView({
  upstream,
  query,
  statusOptions,
  requireLogin,
  canEdit = false,
  upRoute,
  setUpRoute,
  onViewTables,
}: UpstreamViewProps) {
  const {
    upstreamDbTypes,
    upstreamDeptOptions,
    upstreamPage,
    upstreamPageSize,
    upstreamTotal,
    upstreamSort,
    setUpstreamPage,
    setUpstreamPageSize,
    setUpstreamSort,
    upstreamLoaded,
    currentUpstream,
    upstreamPendingIds,
    upstreamLoading,
    upstreamDetailLoading,
    upstreamError,
    upstreamSaveError,
    upstreamSaveFieldErrors,
    clearUpstreamSaveError,
    upstreamView,
    setUpstreamView,
    loadUpstreamData,
    loadUpstreamDetail,
    upBack,
    upGoList,
    upGoDetail,
    upGoEdit,
    upOpen,
    handleSaveUpstream,
    handleDeleteUpstream,
    handleToggleUpstream,
    filteredUpstreamSystems,
    currentUpstreamEdit,
  } = upstream;
  const normalizedStatusOptions = normalizeDictOptions(statusOptions);

  if (upstreamLoading && !upstreamLoaded && !['detail', 'edit'].includes(upRoute.page)) {
    return (
      <LoadingState
        title="加载上游卸数配置"
        desc="正在准备系统清单和卸数计划。"
      />
    );
  }
  if (upstreamError && !["detail", "edit"].includes(upRoute.page)) {
    return (
      <ErrorState
        title="上游卸数加载失败"
        desc={upstreamError}
        onRetry={loadUpstreamData}
      />
    );
  }
  if (!canEdit && ["new", "edit"].includes(upRoute.page)) {
    return (
      <EmptyState
        title="当前页面需要上游系统维护权限"
        desc="上游系统目录可以公开浏览，新增和编辑需要相应写权限。"
      />
    );
  }
  if (upRoute.page === "list") {
    const pageCount = Math.max(1, Math.ceil(upstreamTotal / upstreamPageSize));
    return (
      <div aria-busy={upstreamLoading}>
      <UpstreamList
        systems={filteredUpstreamSystems}
        total={upstreamTotal}
        pendingIds={upstreamPendingIds}
        query={query}
        view={upstreamView as ViewMode}
        onChangeView={setUpstreamView}
        onOpen={upOpen}
        onEdit={
          canEdit
            ? (id) => requireLogin(() => upGoEdit(id), "upstream:write")
            : undefined
        }
        canEdit={canEdit}
        onNew={
          canEdit
            ? () =>
                requireLogin(
                  () => setUpRoute({ page: "new", id: null }),
                  "upstream:write",
                )
            : undefined
        }
        onToggle={handleToggleUpstream}
        onViewTables={onViewTables}
      />
      <div className="fm-pagination" aria-label="上游系统分页">
        <div aria-live="polite">{upstreamLoading ? '正在加载…' : `共 ${upstreamTotal} 条`}</div>
        <div className="fm-pagination-tools">
          <Select<string> aria-label="上游系统排序" value={upstreamSort} onValueChange={(value) => setUpstreamSort(value || 'abbr:asc')}
            items={[{ label: '缩写升序', value: 'abbr:asc' }, { label: '名称升序', value: 'name:asc' }, { label: '标识升序', value: 'id:asc' }, { label: '标识降序', value: 'id:desc' }]} />
          <label>每页 <Select<string> aria-label="每页条数" value={String(upstreamPageSize)}
            items={[...new Set([10, 20, 50, 100, upstreamPageSize])].sort((a, b) => a - b).map((size) => ({ label: String(size), value: String(size) }))}
            onValueChange={(value) => { if (value) { setUpstreamPage(1); setUpstreamPageSize(Number(value)); } }} /> 条</label>
          <Button variant="secondary" type="button" disabled={upstreamPage <= 1}
            onClick={() => setUpstreamPage((page) => Math.max(1, page - 1))}>上一页</Button>
          <span className="mono">{upstreamPage} / {pageCount}</span>
          <Button variant="secondary" type="button" disabled={upstreamPage >= pageCount}
            onClick={() => setUpstreamPage((page) => Math.min(pageCount, page + 1))}>下一页</Button>
        </div>
      </div>
      </div>
    );
  }
  if (upRoute.page === "detail") {
    if (upstreamDetailLoading) {
      return (
        <LoadingState
          title="加载上游系统详情"
          desc="正在准备系统连接和卸数时间点。"
        />
      );
    }
    if (upstreamError) {
      return (
        <ErrorState
          title="上游系统详情加载失败"
          desc={upstreamError}
          onRetry={() => loadUpstreamDetail(upRoute.id || "")}
        />
      );
    }
    if (!currentUpstream) {
      return (
        <div className="empty">
          <div className="ec">
            <Icon name="inbox" size={26} />
          </div>
          <h4>系统不存在</h4>
        </div>
      );
    }
    return (
      <UpstreamDetail
        system={currentUpstream}
        dbTypeOptions={upstreamDbTypes}
        deptOptions={upstreamDeptOptions}
        onBack={upGoList}
        onBackToList={upGoList}
        onEdit={
          canEdit
            ? () =>
                requireLogin(
                  () => upGoEdit(currentUpstream.id),
                  "upstream:write",
                )
            : undefined
        }
      />
    );
  }
  if (upRoute.page === "new") {
    return (
      <UpstreamEditor
        mode="new"
        dbTypeOptions={upstreamDbTypes}
        deptOptions={upstreamDeptOptions}
        statusOptions={normalizedStatusOptions}
        onSave={handleSaveUpstream}
        onCancel={upBack}
        onBackToList={upGoList}
        saveError={upstreamSaveError}
        saveFieldErrors={upstreamSaveFieldErrors}
        onClearSaveError={clearUpstreamSaveError}
      />
    );
  }
  if (upRoute.page === "edit") {
    if (upstreamDetailLoading && !currentUpstreamEdit) {
      return (
        <LoadingState
          title="加载编辑页"
          desc="正在准备系统元数据和卸数配置。"
        />
      );
    }
    if (upstreamError && !currentUpstreamEdit) {
      return (
        <ErrorState
          title="编辑页加载失败"
          desc={upstreamError}
          onRetry={() => loadUpstreamDetail(upRoute.id || "")}
        />
      );
    }
    if (!currentUpstreamEdit) {
      return (
        <div className="empty">
          <div className="ec">
            <Icon name="inbox" size={26} />
          </div>
          <h4>系统不存在</h4>
        </div>
      );
    }
    return (
      <UpstreamEditor
        mode="edit"
        initial={currentUpstreamEdit}
        dbTypeOptions={upstreamDbTypes}
        deptOptions={upstreamDeptOptions}
        statusOptions={normalizedStatusOptions}
        onSave={handleSaveUpstream}
        onCancel={() => upGoDetail(currentUpstreamEdit.id)}
        onBackToList={upGoList}
        onBackToDetail={() => upGoDetail(currentUpstreamEdit.id)}
        onDelete={confirmDeleteUpstream(
          currentUpstreamEdit,
          handleDeleteUpstream,
        )}
        saveError={upstreamSaveError}
        saveFieldErrors={upstreamSaveFieldErrors}
        onClearSaveError={clearUpstreamSaveError}
      />
    );
  }
  return (
    <div className="empty">
      <div className="ec">
        <Icon name="inbox" size={26} />
      </div>
      <h4>页面不存在</h4>
    </div>
  );
}
