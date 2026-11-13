import type { UsePushModuleResult } from "../../hooks/usePushModule.ts";
import type { DictOption } from "../../utils/optionUtils.ts";
import { DEFAULT_PUSH_FILTER } from "../../config/defaults.ts";
import { SidebarActionGroup } from "./common/SidebarActionGroup.tsx";
import { SidebarFilterGroup } from "./common/SidebarFilterGroup.tsx";
import { StatusFilterGroup } from "./common/StatusFilterGroup.tsx";
import { useUiCopy } from "../../i18n/useUiTranslation.ts";

export interface PushSidebarProps {
  push: UsePushModuleResult;
  statusOptions: readonly DictOption[];
  requireLogin: (action: () => void, permission?: string) => boolean;
  canEdit?: boolean | undefined;
  pushRoute: { sys: string | null };
}

export function PushSidebar({
  push,
  statusOptions,
  requireLogin,
  canEdit = false,
  pushRoute,
}: PushSidebarProps) {
  const tx = useUiCopy("integration");
  const {
    pushSystemCount,
    pushProtocolOptions,
    pushFilter,
    setPushFilter,
    pushFacets,
    pushGoSystemEdit,
    pushOpenSystem,
    recentPushSystems,
  } = push;

  const enabledValue =
    statusOptions.find((item) => item.value !== "disabled")?.value || "enabled";
  const disabledValue =
    statusOptions.find((item) => item.value !== enabledValue)?.value ||
    "disabled";

  return (
    <>
      <SidebarFilterGroup
        title={tx("连接协议")}
        allOption={{
          key: "all-protocols",
          label: tx("全部协议"),
          count: pushSystemCount,
          active: !pushFilter.protocol,
          onClick: () => setPushFilter((prev) => ({ ...prev, protocol: null })),
        }}
        items={pushProtocolOptions
          .filter((item) => pushFacets.protocol[item.value])
          .map((item) => ({
            key: item.value,
            label: item.name,
            count: pushFacets.protocol[item.value] || 0,
            active: pushFilter.protocol === item.value,
            onClick: () =>
              setPushFilter((prev) => ({
                ...prev,
                protocol: prev.protocol === item.value ? null : item.value,
              })),
          }))}
      />

      <StatusFilterGroup
        value={pushFilter.status}
        allValue={DEFAULT_PUSH_FILTER.status}
        enabledValue={enabledValue}
        disabledValue={disabledValue}
        totalCount={pushSystemCount}
        enabledCount={pushFacets.status[enabledValue] || 0}
        disabledCount={pushFacets.status[disabledValue] || 0}
        onChange={(status) => setPushFilter((prev) => ({ ...prev, status }))}
      />

      <SidebarFilterGroup
        title={tx("重要程度")}
        allOption={{
          key: "all-importance-levels",
          label: tx("全部重要程度"),
          count: pushSystemCount,
          active: !pushFilter.importanceLevel,
          onClick: () =>
            setPushFilter((prev) => ({ ...prev, importanceLevel: null })),
        }}
        items={[
          { value: "important", label: tx("重要") },
          { value: "normal", label: tx("普通") },
        ].map((item) => ({
          key: item.value,
          label: item.label,
          count: pushFacets.importanceLevel[item.value] || 0,
          active: pushFilter.importanceLevel === item.value,
          onClick: () =>
            setPushFilter((prev) => ({
              ...prev,
              importanceLevel:
                prev.importanceLevel === item.value ? null : item.value,
            })),
        }))}
      />

      <SidebarActionGroup
        actions={
          canEdit
            ? [
                {
                  key: "create-push-system",
                  label: tx("新增系统"),
                  onClick: () => requireLogin(() => pushGoSystemEdit(null)),
                },
              ]
            : []
        }
      />

      {recentPushSystems.length ? (
        <SidebarFilterGroup
          title={tx("最近访问")}
          items={recentPushSystems.map((system) => ({
            key: system.id,
            active: pushRoute.sys === system.id,
            onClick: () => pushOpenSystem(system.id),
            content: <span className="side-ellipsis">{system.name}</span>,
          }))}
        />
      ) : null}
    </>
  );
}
