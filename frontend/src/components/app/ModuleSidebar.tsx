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
  UpstreamSidebar,
} from "../sidebar/index.ts";
import type { ModuleId } from "../../routing/types.ts";
import type { AppModuleContext } from "./appTypes.ts";

export interface ModuleSidebarProps {
  module: ModuleId;
  context: AppModuleContext;
}

export function ModuleSidebar({ module, context }: ModuleSidebarProps): ReactElement | null {
  const {
    apiAsset,
    apiAssetFilter,
    asset,
    can,
    canEdit,
    auth,
    catalogAccessDisabled,
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
        canExport={auth.user
          ? canPermission("field_mapping:read")
          : catalogExportEnabled && !catalogAccessDisabled}
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
