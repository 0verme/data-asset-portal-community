import React from "react";

import { SearchPortalPage } from "../SearchPortalPage.tsx";

function lazyNamed(loader, exportName) {
  return React.lazy(() => loader().then((module) => ({ default: module[exportName] })));
}

const AssetView = lazyNamed(() => import("../views/AssetView.tsx"), "AssetView");
const ApiAssetView = lazyNamed(() => import("../views/ApiAssetView.tsx"), "ApiAssetView");
const IndicatorView = lazyNamed(() => import("../views/IndicatorView.tsx"), "IndicatorView");
const PushView = lazyNamed(() => import("../views/PushView.tsx"), "PushView");
const ReportView = lazyNamed(() => import("../views/ReportView.tsx"), "ReportView");
const RootView = lazyNamed(() => import("../views/RootView.tsx"), "RootView");
const SystemView = lazyNamed(() => import("../views/SystemView.tsx"), "SystemView");
const UpstreamView = lazyNamed(() => import("../views/UpstreamView.tsx"), "UpstreamView");
const FieldMappingPage = lazyNamed(() => import("../FieldMappingPage.tsx"), "FieldMappingPage");
const LineagePage = lazyNamed(() => import("../LineagePage.tsx"), "LineagePage");
const ManualCodeTablePage = lazyNamed(() => import("../ManualCodeTablePage.tsx"), "ManualCodeTablePage");

/** Module code → lazy page renderer (registry-driven dispatch). */
function canAccess(context, permission) {
  return typeof context.can === "function" ? context.can(permission) : Boolean(context.canEdit);
}

const MODULE_RENDERERS = {
  portal: ({ context }) => (
    <SearchPortalPage
      onNavigate={context.goToModuleWithQuery}
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
      setPushRoute={context.setPushRoute}
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
      indicatorView={context.indicatorView}
      setIndicatorView={context.setIndicatorView}
    />
  ),
  report: ({ context }) => (
    <ReportView
      report={context.report}
      query={context.query}
      reportRoute={context.reportRoute}
      view={context.reportView}
      onChangeView={context.setReportView}
      canEdit={canAccess(context, "report:write")}
    />
  ),
  apiAsset: ({ context }) => (
    <ApiAssetView
      apiAsset={context.apiAsset}
      query={context.query}
      route={context.apiAssetRoute}
      view={context.apiAssetView}
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
      authenticated={Boolean(context.auth?.user)}
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

function ModuleLoadingState() {
  return (
    <div className="state-card" role="status" aria-live="polite">
      <div className="state-spinner" aria-hidden="true"></div>
      <h4>加载业务模块</h4>
      <p>正在准备当前页面。</p>
    </div>
  );
}

function PublicAccessLoadingState() {
  return (
    <div className="state-card" role="status" aria-live="polite">
      <div className="state-spinner" aria-hidden="true"></div>
      <h4>准备公开目录</h4>
      <p>正在确认会话状态并加载可浏览的数据资产。</p>
    </div>
  );
}

export function ModuleContent({ module, context }) {
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
