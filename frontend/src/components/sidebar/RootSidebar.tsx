import type { RootRoute } from "../../routing/types.ts";
import type { UseRootModuleResult } from "../../hooks/useRootModule.ts";
import { SidebarActionGroup } from "./common/SidebarActionGroup.tsx";
import { SidebarFilterGroup } from "./common/SidebarFilterGroup.tsx";

export interface RootSidebarProps {
  root: UseRootModuleResult;
  requireLogin: (action: () => void, permission?: string) => boolean;
  canEdit?: boolean | undefined;
  setRootRoute: (route: RootRoute) => void;
}

export function RootSidebar({ root, requireLogin, canEdit = false, setRootRoute }: RootSidebarProps) {
  const { roots, rootCategories, rootCategory, setRootCategory } = root;

  return (
    <>
      <SidebarFilterGroup
        title="词根分类"
        allOption={{
          key: "all-roots",
          label: "全部词根",
          count: roots.length,
          active: !rootCategory,
          onClick: () => setRootCategory(null),
        }}
        items={rootCategories.map((item) => ({
          key: item.name,
          label: item.name,
          count: item.count,
          active: rootCategory === item.name,
          onClick: () => setRootCategory(rootCategory === item.name ? null : item.name),
        }))}
      />

      <SidebarActionGroup
        actions={canEdit ? [
          {
            key: "create-root",
            label: "新增词根",
            onClick: () => requireLogin(() => setRootRoute({ page: "new", abbr: null })),
          },
          {
            key: "import-root",
            label: "批量导入",
            onClick: () => requireLogin(() => setRootRoute({ page: "import", abbr: null })),
          },
        ] : []}
      />
    </>
  );
}
