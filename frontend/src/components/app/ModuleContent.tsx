import React from "react";

import type { SearchResultGroup, SearchResultItem } from "../../api/search.ts";
import type { NavigationActions } from "../../hooks/useNavigationController.ts";
import type { PortalTarget } from "../../routing/portalNavigation.ts";
import type { ModuleId } from "../../routing/types.ts";
import { SearchPortalPage } from "../SearchPortalPage.tsx";
import type { ViewMode } from "../common/ViewModeSwitcher.tsx";
import type { AppModuleContext } from "./appTypes.ts";

const AssetView = React.lazy(() =>
  import("../views/AssetView.tsx").then(({ AssetView: component }) => ({ default: component })),
);
const ApiAssetView = React.lazy(() =>
  import("../views/ApiAssetView.tsx").then(({ ApiAssetView: component }) => ({ default: component })),
);
const IndicatorView = React.lazy(() =>
  import("../views/IndicatorView.tsx").then(({ IndicatorView: component }) => ({ default: component })),
);
const PushView = React.lazy(() =>
  import("../views/PushView.tsx").then(({ PushView: component }) => ({ default: component })),
);
const ReportView = React.lazy(() =>
  import("../views/ReportView.tsx").then(({ ReportView: component }) => ({ default: component })),
);
const RootView = React.lazy(() =>
  import("../views/RootView.tsx").then(({ RootView: component }) => ({ default: component })),
);
const SystemView = React.lazy(() =>
  import("../views/SystemView.tsx").then(({ SystemView: component }) => ({ default: component })),
);
const UpstreamView = React.lazy(() =>
  import("../views/UpstreamView.tsx").then(({ UpstreamView: component }) => ({ default: component })),
);
const FieldMappingPage = React.lazy(() =>
  import("../FieldMappingPage.tsx").then(({ FieldMappingPage: component }) => ({ default: component })),
);
const LineagePage = React.lazy(() =>
  import("../LineagePage.tsx").then(({ LineagePage: component }) => ({ default: component })),
);
const ManualCodeTablePage = React.lazy(() =>
  import("../ManualCodeTablePage.tsx").then(({ ManualCodeTablePage: component }) => ({ default: component })),
);

interface ModuleRendererProps {
  context: AppModuleContext;
}

type ModuleRenderer = (props: ModuleRendererProps) => React.ReactElement;
type SearchNavigationTarget = SearchResultItem | SearchResultGroup;
type PortalNavigationTarget = Extract<
  Parameters<NavigationActions["goToModuleWithQuery"]>[0],
  object
>;

const MODULE_CODES: ReadonlySet<string> = new Set([
  "portal",
  "dwm",
  "upstream",
  "mapping",
  "lineage",
  "root",
  "indicator",
  "report",
  "apiAsset",
  "push",
  "codeTable",
  "system",
]);

function isModuleId(value: string): value is ModuleId {
  return MODULE_CODES.has(value);
}

function toPortalRef(value: unknown): PortalTarget["ref"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as NonNullable<PortalTarget["ref"]>;
}

function toNavigationTarget(target: SearchNavigationTarget): PortalNavigationTarget {
  const navigationTarget: PortalNavigationTarget = {};
  if (isModuleId(target.module)) navigationTarget.module = target.module;
  if ("ref" in target) {
    const ref = toPortalRef(target.ref);
    if (ref) navigationTarget.ref = ref;
  }
  return navigationTarget;
}

function canAccess(context: AppModuleContext, permission: string): boolean {
  return context.can(permission);
}

const MODULE_RENDERERS: Record<ModuleId, ModuleRenderer> = {
  portal: ({ context }) => (
    <SearchPortalPage
      onNavigate={(target, term) => context.goToModuleWithQuery(toNavigationTarget(target), term)}
      availableModules={context.visibleModuleKeys}
      publicAccessReady={context.businessAccessReady}
    />
  ),
  codeTable: ({ context }) => (
    <ManualCodeTablePage
      module={context.manualCodeTable}
      query={context.query}
      canEdit={canAccess(context, "code_table:write")}
    />
  ),
  push: ({ context }) => (
    <PushView
      push={context.push}
      query={context.query}
      statusOptions={context.statusOptions}
      requireLogin={context.requireLogin}
      canEdit={canAccess(context, "push:write")}
      pushRoute={context.pushRoute}
    />
  ),
  indicator: ({ context }) => (
    <IndicatorView
      indicator={context.indicator}
      query={context.query}
      setQuery={context.setQuery}
      indicatorRoute={context.indicatorRoute}
      indicatorFilter={context.indicatorFilter}
      setIndicatorFilter={context.setIndicatorFilter}
      indicatorView={context.indicatorView as ViewMode}
      setIndicatorView={context.setIndicatorView}
    />
  ),
  report: ({ context }) => (
    <ReportView
      report={context.report}
      query={context.query}
      reportRoute={context.reportRoute}
      view={context.reportView as ViewMode}
      onChangeView={context.setReportView}
      canEdit={canAccess(context, "report:write")}
    />
  ),
  apiAsset: ({ context }) => (
    <ApiAssetView
      apiAsset={context.apiAsset}
      query={context.query}
      route={context.apiAssetRoute}
      view={context.apiAssetView as ViewMode}
      onChangeView={context.setApiAssetView}
      canEdit={canAccess(context, "api_asset:write")}
    />
  ),
  root: ({ context }) => (
    <RootView
      root={context.root}
      query={context.query}
      setQuery={context.setQuery}
      requireLogin={context.requireLogin}
      rootRoute={context.rootRoute}
      setRootRoute={context.setRootRoute}
      canEdit={canAccess(context, "root:write")}
    />
  ),
  system: ({ context }) => (
    <SystemView
      systemRoute={context.systemRoute}
      query={context.query}
      authenticated={Boolean(context.auth.user)}
      canManageMenus={context.canManageMenus}
      canManageParams={context.canManageParams}
      canManageRoles={context.canManageRoles}
      canManageUsers={context.canManageUsers}
      canManageSystem={context.canManageSystem}
      requireLogin={context.requireLogin}
      systemActionIntent={context.systemActionIntent}
      setSystemActionIntent={context.setSystemActionIntent}
    />
  ),
  upstream: ({ context }) => (
    <UpstreamView
      upstream={context.upstream}
      query={context.query}
      statusOptions={context.statusOptions}
      requireLogin={context.requireLogin}
      canEdit={canAccess(context, "upstream:write")}
      upRoute={context.upRoute}
      setUpRoute={context.setUpRoute}
      onViewTables={context.goToMapping}
    />
  ),
  mapping: ({ context }) => (
    <FieldMappingPage
      keyword={context.query}
      route={context.mappingRoute}
      setRoute={context.setMappingRoute}
      onBackToUpstream={context.backToUpstreamList}
    />
  ),
  lineage: ({ context }) => (
    <LineagePage
      route={context.lineageRoute}
      onRouteChange={context.setLineageRoute}
      onBootstrap={context.setLineageBootstrap}
    />
  ),
  dwm: ({ context }) => (
    <AssetView
      asset={context.asset}
      query={context.query}
      route={context.route}
      canEdit={canAccess(context, "asset:write")}
    />
  ),
};

function ModuleLoadingState(): React.ReactElement {
  return (
    <div className="state-card" role="status" aria-live="polite">
      <div className="state-spinner" aria-hidden="true"></div>
      <h4>加载业务模块</h4>
      <p>正在准备当前页面。</p>
    </div>
  );
}

function PublicAccessLoadingState(): React.ReactElement {
  return (
    <div className="state-card" role="status" aria-live="polite">
      <div className="state-spinner" aria-hidden="true"></div>
      <h4>准备公开目录</h4>
      <p>正在确认会话状态并加载可浏览的数据资产。</p>
    </div>
  );
}

export interface ModuleContentProps {
  module: ModuleId;
  context: AppModuleContext;
}

export function ModuleContent({ module, context }: ModuleContentProps): React.ReactElement {
  const renderer = MODULE_RENDERERS[module] || MODULE_RENDERERS.dwm;
  if (context.businessAccessReady === false) {
    return <PublicAccessLoadingState />;
  }
  if (module === "portal") {
    return renderer({ context });
  }
  const content = renderer({ context });
  return <React.Suspense fallback={<ModuleLoadingState />}>{content}</React.Suspense>;
}

export { MODULE_RENDERERS };
