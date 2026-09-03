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

import type { UseRootModuleResult } from "../../hooks/useRootModule.ts";
import type { RootRoute } from "../../routing/types.ts";
import { pushModuleNavigationState } from "../../routing/navigation.ts";
import { RootEditor, RootImport, RootLibrary } from "../RootPages.tsx";
import { Icon } from "../ui.tsx";
import { EmptyState, ErrorState, LoadingState } from "../common/index.ts";

type RequireLogin = (action?: () => void, permission?: string) => boolean;

export interface RootViewProps {
  root: UseRootModuleResult;
  query: string;
  setQuery: (query: string) => void;
  requireLogin: RequireLogin;
  rootRoute: RootRoute;
  setRootRoute: (route: RootRoute) => void;
  canEdit?: boolean | undefined;
}

export function RootView({
  root,
  query,
  setQuery,
  requireLogin,
  rootRoute,
  setRootRoute,
  canEdit = false,
}: RootViewProps) {
  const {
    roots = [],
    rootCategories = [],
    rootLoading,
    rootError,
    loadRootData,
    rootCategory,
    setRootCategory,
    rootBack,
    handleSaveRoot,
    handleDeleteRoot,
    handleImportRoots,
    filteredRoots = [],
    currentRoot,
    rootAbbrs,
  } = root;

  if (rootLoading) {
    return (
      <LoadingState title="加载词根库" desc="正在准备词根清单和分类统计。" />
    );
  }
  if (rootError) {
    return (
      <ErrorState
        title="词根模块加载失败"
        desc={rootError}
        onRetry={loadRootData}
      />
    );
  }
  if (!canEdit && rootRoute.page !== "library") {
    return (
      <div className="state-card" role="status">
        <h4>当前页面仅对维护权限开放</h4>
        <p>词根目录仍可公开浏览，新增、编辑、导入和删除需要相应权限。</p>
      </div>
    );
  }
  if (rootRoute.page === "library") {
    return (
      <RootLibrary
        roots={filteredRoots}
        allRoots={roots}
        query={query}
        activeCategory={rootCategory}
        categories={rootCategories}
        onSetCategory={setRootCategory}
        canEdit={canEdit}
        onEdit={
          canEdit
            ? (abbr) =>
                requireLogin(() => {
                  pushModuleNavigationState("root", {
                    query,
                    rootRoute,
                    rootCategory,
                  });
                  setRootRoute({ page: "edit", abbr });
                }, "root:write")
            : () => undefined
        }
        onNew={
          canEdit
            ? () =>
                requireLogin(() => {
                  pushModuleNavigationState("root", {
                    query,
                    rootRoute,
                    rootCategory,
                  });
                  setRootRoute({ page: "new", abbr: null });
                }, "root:write")
            : () => undefined
        }
        onImport={
          canEdit
            ? () =>
                requireLogin(() => {
                  pushModuleNavigationState("root", {
                    query,
                    rootRoute,
                    rootCategory,
                  });
                  setRootRoute({ page: "import", abbr: null });
                }, "root:write")
            : () => undefined
        }
        onClearQuery={() => setQuery("")}
      />
    );
  }
  if (rootRoute.page === "new") {
    return (
      <RootEditor
        mode="new"
        initial={null}
        categories={rootCategories}
        existingAbbrs={rootAbbrs}
        onSave={handleSaveRoot}
        onCancel={rootBack}
      />
    );
  }
  if (rootRoute.page === "edit" && currentRoot) {
    return (
      <RootEditor
        mode="edit"
        initial={currentRoot}
        categories={rootCategories}
        existingAbbrs={rootAbbrs}
        onSave={handleSaveRoot}
        onCancel={rootBack}
        onDelete={handleDeleteRoot}
      />
    );
  }
  if (rootRoute.page === "import") {
    return (
      <RootImport
        roots={roots}
        categories={rootCategories}
        onBack={rootBack}
        onCommit={handleImportRoots}
      />
    );
  }
  if (rootRoute.page === "edit" && !currentRoot) {
    return (
      <EmptyState
        title="词根不存在"
        desc="当前词根不存在、已被删除，或 mock 数据未包含该记录。"
        actionText="返回词根库"
        onAction={rootBack}
      />
    );
  }
  return (
    <div className="empty">
      <div className="ec">
        <Icon name="inbox" size={26} />
      </div>
      <h4>词根页面不存在</h4>
    </div>
  );
}
