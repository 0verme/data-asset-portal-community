import type { RootRoute } from "../../routing/types.ts";
import type { UseRootModuleResult } from "../../hooks/useRootModule.ts";
import { SidebarActionGroup } from "./common/SidebarActionGroup.tsx";
import { SidebarFilterGroup } from "./common/SidebarFilterGroup.tsx";
import { useUiCopy } from "../../i18n/useUiTranslation.ts";

export interface RootSidebarProps {
  root: UseRootModuleResult;
  requireLogin: (action: () => void, permission?: string) => boolean;
  canEdit?: boolean | undefined;
  setRootRoute: (route: RootRoute) => void;
}

export function RootSidebar({ root, requireLogin, canEdit = false, setRootRoute }: RootSidebarProps) {
  const tx = useUiCopy("dictionary");
  const { rootGlobalTotal, rootCategories, rootCategory, setRootCategory } = root;

  return (
    <>
      <SidebarFilterGroup
        title={tx("词根分类")}
        allOption={{
          key: "all-roots",
          label: tx("全部词根"),
          count: rootGlobalTotal,
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
            label: tx("新增词根"),
            onClick: () => requireLogin(() => setRootRoute({ page: "new", abbr: null })),
          },
          {
            key: "import-root",
            label: tx("批量导入"),
            onClick: () => requireLogin(() => setRootRoute({ page: "import", abbr: null })),
          },
        ] : []}
      />
    </>
  );
}
