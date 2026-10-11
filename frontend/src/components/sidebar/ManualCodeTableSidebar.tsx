import type { UseManualCodeTableModuleResult } from "../../hooks/useManualCodeTableModule.ts";
import { MANUAL_CODE_TABLE_STYLES } from "../../hooks/useManualCodeTableModule.ts";
import { SidebarActionGroup } from "./common/SidebarActionGroup.tsx";
import { SidebarFilterGroup } from "./common/SidebarFilterGroup.tsx";
import { StatusFilterGroup } from "./common/StatusFilterGroup.tsx";
import { getManualCodeTableFacetCounts } from "./manualCodeTableFacets.ts";

export interface ManualCodeTableSidebarProps {
  module: UseManualCodeTableModuleResult;
  query: string;
  canEdit: boolean;
  canExport: boolean;
}

export function ManualCodeTableSidebar({
  module,
  query,
  canEdit,
  canExport,
}: ManualCodeTableSidebarProps) {
  const facets = getManualCodeTableFacetCounts(
    module.items,
    MANUAL_CODE_TABLE_STYLES,
    query,
    module.styleFilter,
    module.statusFilter,
  );
  return (
    <>
      <SidebarFilterGroup
        title="码表样式"
        allOption={{
          key: "all",
          label: "全部码表",
          count: facets.styleTotal,
          active: !module.styleFilter,
          onClick: () => module.setStyleFilter(""),
        }}
        items={[
          ...MANUAL_CODE_TABLE_STYLES.map((style) => ({
            key: style.value,
            label: style.label,
            count: facets.styles[style.value],
            active: module.styleFilter === style.value,
            onClick: () => module.setStyleFilter(style.value),
          })),
        ]}
      />
      <StatusFilterGroup
        value={module.statusFilter}
        allValue=""
        totalCount={facets.statusTotal}
        enabledCount={facets.statuses.enabled}
        disabledCount={facets.statuses.disabled}
        onChange={(status) => module.setStatusFilter(status || "")}
      />
      <SidebarActionGroup
        actions={[
          canEdit
            ? { key: "new", label: "新增码值表", onClick: module.openNew }
            : null,
          canExport
            ? { key: "export", label: "导出表名清单", onClick: module.exportCsv }
            : null,
        ].filter((action): action is NonNullable<typeof action> =>
          Boolean(action),
        )}
      />
    </>
  );
}
