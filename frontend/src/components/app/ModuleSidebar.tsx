import { useEffect, useState, type ReactElement } from "react";

import {
  getMockModuleReadiness,
  getModuleReadiness,
  isRemoteReadinessMode,
} from "../../api/moduleReadiness.ts";
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
import {
  getModuleReadinessSkeleton,
  normalizeReadinessModuleId,
  type ModuleReadinessResult,
  type ReadinessWorkspaceModuleInput,
} from "../sidebar/common/moduleReadiness.ts";
import type { ModuleId } from "../../routing/types.ts";
import type { AppModuleContext } from "./appTypes.ts";

type WorkspaceModuleId = Exclude<ModuleId, "portal" | "notFound">;

export interface ModuleSidebarProps {
  module: WorkspaceModuleId;
  context: AppModuleContext;
}

function moduleReadinessRefreshKey(
  module: ReadinessWorkspaceModuleInput,
  context: AppModuleContext,
): string {
  switch (module) {
    case "dwm":
    case "data-warehouse":
      return `dwm:${context.asset.totalTables}:${context.asset.tables.length}:${context.asset.homeLoading}:${context.asset.homeError}`;
    case "mapping":
      return `mapping:${context.mappingRoute.sourceSystemId}:${context.mappingRoute.tablePk}`;
    case "root":
      return `root:${context.root.rootGlobalTotal}:${context.root.roots.length}:${context.root.rootLoading}:${context.root.rootError}`;
    case "indicator":
      return `indicator:${context.indicator.indicatorCount}:${context.indicator.indicators.length}:${context.indicator.indicatorLoading}:${context.indicator.indicatorError}`;
    case "codeTable":
      return `codeTable:${context.manualCodeTable.stats.total}:${context.manualCodeTable.stats.enabled}:${context.manualCodeTable.items.length}:${context.manualCodeTable.loading}:${context.manualCodeTable.error}`;
    case "report":
      return `report:${context.report.reportCount}:${context.report.reports.length}:${context.report.reportLoading}:${context.report.reportError}`;
    case "apiAsset":
      return `apiAsset:${context.apiAsset.globalTotal}:${context.apiAsset.items.length}:${context.apiAsset.loading}:${context.apiAsset.error}`;
    case "push":
      return `push:${context.push.pushSystemCount}:${context.push.pushSystems.length}:${context.push.pushLoading}:${context.push.pushError}`;
    case "lineage":
      return `lineage:${context.lineageBootstrap?.snapshotId || ""}:${context.lineageBootstrap?.nodeCount ?? ""}:${context.lineageNodes.length}`;
    case "system":
      return "system";
  }
}

function useWorkspaceModuleReadiness(
  module: WorkspaceModuleId,
  context: AppModuleContext,
): ModuleReadinessResult | null {
  const isUpstream = module === "upstream";
  const readinessModule: ReadinessWorkspaceModuleInput = isUpstream ? "system" : module;
  const canonicalId = normalizeReadinessModuleId(readinessModule);
  const remoteMode = isRemoteReadinessMode();
  const refreshKey = isUpstream ? "upstream" : moduleReadinessRefreshKey(readinessModule, context);
  const [remoteState, setRemoteState] = useState<{
    moduleId: string;
    result: ModuleReadinessResult;
  } | null>(null);

  useEffect(() => {
    if (isUpstream || canonicalId === "system" || !remoteMode) {
      return undefined;
    }
    if (!context.catalogDataAccessReady) {
      setRemoteState({
        moduleId: canonicalId,
        result: getModuleReadinessSkeleton(canonicalId, {
          status: context.businessAccessReady ? "unavailable" : "loading",
        }),
      });
      return undefined;
    }
    let cancelled = false;
    setRemoteState((current) =>
      current?.moduleId === canonicalId
        ? current
        : {
            moduleId: canonicalId,
            result: getModuleReadinessSkeleton(canonicalId, { status: "loading" }),
          },
    );
    void getModuleReadiness(canonicalId)
      .then((result) => {
        if (!cancelled) {
          setRemoteState({ moduleId: canonicalId, result });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRemoteState({
            moduleId: canonicalId,
            result: getModuleReadinessSkeleton(canonicalId, { status: "unavailable" }),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    canonicalId,
    context.businessAccessReady,
    context.catalogDataAccessReady,
    isUpstream,
    refreshKey,
    remoteMode,
  ]);

  if (isUpstream || canonicalId === "system") return null;
  if (!remoteMode) {
    if (!context.catalogDataAccessReady) {
      return getModuleReadinessSkeleton(canonicalId, {
        status: context.businessAccessReady ? "unavailable" : "loading",
      });
    }
    return getMockModuleReadiness(canonicalId);
  }
  if (remoteState?.moduleId === canonicalId) {
    return remoteState.result;
  }
  return getModuleReadinessSkeleton(canonicalId, { status: "loading" });
}

export function ModuleSidebar({ module, context }: ModuleSidebarProps): ReactElement {
  const readiness = useWorkspaceModuleReadiness(module, context);
  const resolvedReadiness =
    module === "upstream" || module === "system"
      ? null
      : (readiness ?? getModuleReadinessSkeleton(module));
  const showProgress =
    module === "upstream" ||
    (resolvedReadiness !== null && resolvedReadiness.status !== "not_applicable");
  return (
    <>
      <div className="sidebar-content">{renderModuleSidebar(module, context)}</div>
      {showProgress ? (
        <div className="sidebar-progress">
          {module === "upstream" ? (
            <UpstreamCoverageSummary upstream={context.upstream} statusOptions={context.statusOptions} />
          ) : (
            <ModuleReadiness result={resolvedReadiness!} />
          )}
        </div>
      ) : null}
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
