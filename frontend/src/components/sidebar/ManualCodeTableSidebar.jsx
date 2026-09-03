import { SidebarActionGroup } from "./common/SidebarActionGroup.jsx";
import { SidebarFilterGroup } from "./common/SidebarFilterGroup.jsx";
import { MANUAL_CODE_TABLE_STYLES } from "../../hooks/useManualCodeTableModule.ts";

export function ManualCodeTableSidebar({ module, canEdit }) {
  const counts = Object.fromEntries(MANUAL_CODE_TABLE_STYLES.map((style) => [
    style.value,
    module.items.filter((item) => item.style === style.value).length,
  ]));
  return (
    <>
      <SidebarFilterGroup
        title="码表样式"
        allOption={{
          key: "all",
          label: "全部码表",
          count: module.items.length,
          active: !module.styleFilter,
          onClick: () => module.setStyleFilter(""),
        }}
        items={[
          ...MANUAL_CODE_TABLE_STYLES.map((style) => ({
            key: style.value,
            label: style.label,
            count: counts[style.value],
            active: module.styleFilter === style.value,
            onClick: () => module.setStyleFilter(style.value),
          })),
        ]}
      />
      <SidebarActionGroup actions={[
        canEdit ? { key: "new", label: "新增码值表", onClick: module.openNew } : null,
        { key: "export", label: "导出表名清单", onClick: module.exportCsv },
      ].filter(Boolean)} />
    </>
  );
}
