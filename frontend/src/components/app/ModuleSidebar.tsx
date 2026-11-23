import type { ReactElement } from "react";

import {
  AssetSidebar,
  ApiAssetSidebar,
  IndicatorSidebar,
  LineageAssetSidebar,
  MappingSidebar,
  ManualCodeTableSidebar,
  PushSidebar,
  ReportSidebar,
  RootSidebar,
  SystemSidebar,
  UpstreamCoverageSummary,
  UpstreamSidebar,
} from "../sidebar/index.ts";
import { ModuleReadiness } from "../sidebar/common/ModuleReadiness.tsx";
import type { ModuleId } from "../../routing/types.ts";
import type { AppModuleContext } from "./appTypes.ts";

type WorkspaceModuleId = Exclude<ModuleId, "portal" | "notFound">;

export interface ModuleSidebarProps {
  module: WorkspaceModuleId;
  context: AppModuleContext;
}

export function ModuleSidebar({ module, context }: ModuleSidebarProps): ReactElement {
  return (
    <>
      <div className="sidebar-content">{renderModuleSidebar(module, context)}</div>
      <div className="sidebar-progress">
        {module === "upstream" ? (
          <UpstreamCoverageSummary upstream={context.upstream} statusOptions={context.statusOptions} />
        ) : (
          <ModuleReadiness result={{
            moduleId: module === "dwm" ? "data-warehouse" : module,
            status: "pending_definition",
            metricId: null,
            definition: null,
            numerator: null,
            denominator: null,
            percentage: null,
            updatedAt: null,
          }} />
        )}
      </div>
    </>
  );
}

function renderModuleSidebar(module: WorkspaceModuleId, context: AppModuleContext): ReactElement {
  const {
    apiAsset,
    apiAssetFilter,
    asset,
    can,
    canEdit,
    auth,
    catalogAccessDisabled,
    catalogDataAccessReady,
    catalogExportEnabled,
    canManageMenus,
    canManageParams,
    canManageRoles,
    canManageUsers,
    indicator,
    indicatorFilter,
    lineageBootstrap,
    lineageNodes,
    lineageSelectedNodeId,
    lineageSelectionSequence,
    focusLineageNode,
    manualCodeTable,
    mappingRoute,
    setMappingRoute,
    push,
    pushRoute,
    report,
    reportFilter,
    requireLogin,
    root,
    setApiAssetFilter,
    setIndicatorFilter,
    setIndicatorRoute,
    setReportFilter,
    setReportRoute,
    setRootRoute,
    setSystemActionIntent,
    setSystemRoute,
    setUpRoute,
    statusOptions,
    systemRoute,
    canViewMenus,
    canViewOperationLog,
    canViewParams,
    canViewRoles,
    canViewUsers,
    upstream,
  } = context;
  const canPermission = can || (() => canEdit);

  if (module === "codeTable") {
    return (
      <ManualCodeTableSidebar
        module={manualCodeTable}
        canEdit={canPermission("code_table:write")}
        canExport={auth.user
          ? canPermission("code_table:read")
          : catalogExportEnabled && !catalogAccessDisabled}
      />
    );
  }
  if (module === "push") {
    return (
      <PushSidebar
        push={push}
        statusOptions={statusOptions}
        requireLogin={requireLogin}
        canEdit={canPermission("push:write")}
        pushRoute={pushRoute}
      />
    );
  }
  if (module === "indicator") {
    return (
      <IndicatorSidebar
        indicator={indicator}
        indicatorFilter={indicatorFilter}
        setIndicatorFilter={setIndicatorFilter}
        setIndicatorRoute={setIndicatorRoute}
        canEdit={canPermission("indicator:write")}
      />
    );
  }
  if (module === "report") {
    return (
      <ReportSidebar
        report={{ ...report, reportFilter, setReportFilter }}
        requireLogin={requireLogin}
        canEdit={canPermission("report:write")}
        setReportRoute={setReportRoute}
      />
    );
  }
  if (module === "apiAsset") {
    return (
      <ApiAssetSidebar
        apiAsset={apiAsset}
        filter={apiAssetFilter}
        setFilter={setApiAssetFilter}
        requireLogin={requireLogin}
        canEdit={canPermission("api_asset:write")}
      />
    );
  }
  if (module === "root") {
    return (
      <RootSidebar
        root={root}
        requireLogin={requireLogin}
        canEdit={canPermission("root:write")}
        setRootRoute={setRootRoute}
      />
    );
  }
  if (module === "system") {
    return (
      <SystemSidebar
        systemRoute={systemRoute}
        setSystemRoute={setSystemRoute}
        setSystemActionIntent={setSystemActionIntent}
        canViewUsers={canViewUsers}
        canViewRoles={canViewRoles}
        canViewMenus={canViewMenus}
        canViewParams={canViewParams}
        canViewOperationLog={canViewOperationLog}
        canManageUsers={canManageUsers || canPermission("system:user:write")}
        canManageRoles={canManageRoles || canPermission("system:role:write")}
        canManageMenus={canManageMenus || canPermission("system:menu:write")}
        canManageParams={canManageParams || canPermission("system:param:write")}
      />
    );
  }
  if (module === "upstream") {
    return (
      <UpstreamSidebar
        upstream={upstream}
        statusOptions={statusOptions}
        requireLogin={requireLogin}
        canEdit={canPermission("upstream:write")}
        setUpRoute={setUpRoute}
      />
    );
  }
  if (module === "mapping") {
    return (
      <MappingSidebar
        catalogAccessReady={catalogDataAccessReady}
        route={mappingRoute}
        setRoute={setMappingRoute}
      />
    );
  }
  if (module === "lineage") {
    return (
      <LineageAssetSidebar
        nodes={lineageNodes}
        selectedNodeId={lineageSelectedNodeId}
        selectionSequence={lineageSelectionSequence}
        snapshot={lineageBootstrap}
        onSelectNode={focusLineageNode}
      />
    );
  }
  return <AssetSidebar asset={asset} route={context.route} canEdit={canPermission("asset:write")} />;
}
