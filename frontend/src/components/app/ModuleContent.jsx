import React from "react";

import { SearchPortalPage } from "../SearchPortalPage.jsx";

function lazyNamed(loader, exportName) {
  return React.lazy(() => loader().then((module) => ({ default: module[exportName] })));
}

const AssetView = lazyNamed(() => import("../views/AssetView.jsx"), "AssetView");
const ApiAssetView = lazyNamed(() => import("../views/ApiAssetView.jsx"), "ApiAssetView");
const IndicatorView = lazyNamed(() => import("../views/IndicatorView.jsx"), "IndicatorView");
const PushView = lazyNamed(() => import("../views/PushView.jsx"), "PushView");
const ReportView = lazyNamed(() => import("../views/ReportView.jsx"), "ReportView");
const RootView = lazyNamed(() => import("../views/RootView.jsx"), "RootView");
const SystemView = lazyNamed(() => import("../views/SystemView.jsx"), "SystemView");
const UpstreamView = lazyNamed(() => import("../views/UpstreamView.jsx"), "UpstreamView");
const FieldMappingPage = lazyNamed(() => import("../FieldMappingPage.jsx"), "FieldMappingPage");
const LineagePage = lazyNamed(() => import("../LineagePage.jsx"), "LineagePage");
const ManualCodeTablePage = lazyNamed(() => import("../ManualCodeTablePage.jsx"), "ManualCodeTablePage");

/** Module code → lazy page renderer (registry-driven dispatch). */
const MODULE_RENDERERS = {
  portal: ({ context }) => (
    <SearchPortalPage
      onNavigate={context.goToModuleWithQuery}
      availableModules={context.visibleModuleKeys}
      authenticated={context.businessAccessReady}
      onRequireLogin={() => context.requireLogin?.(() => {})}
    />
  ),
  codeTable: ({ context }) => (
    <ManualCodeTablePage
      module={context.manualCodeTable}
      query={context.query}
      canEdit={context.can ? context.can("code_table:write") : context.canEdit}
    />
  ),
  push: ({ context }) => (
    <PushView
      push={context.push}
      query={context.query}
      statusOptions={context.statusOptions}
      requireLogin={context.requireLogin}
      canEdit={context.canEdit}
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
    />
  ),
  apiAsset: ({ context }) => (
    <ApiAssetView
      apiAsset={context.apiAsset}
      query={context.query}
      route={context.apiAssetRoute}
      view={context.apiAssetView}
      onChangeView={context.setApiAssetView}
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
    />
  ),
  system: ({ context }) => (
    <SystemView
      systemRoute={context.systemRoute}
      query={context.query}
      canEdit={context.canEdit}
      canManageRoles={context.canManageRoles}
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
    <AssetView asset={context.asset} query={context.query} route={context.route} />
  ),
};

function AuthenticatedBusinessPrompt({ onRequireLogin }) {
  return (
    <div className="state-card" role="status" aria-live="polite">
      <h4>登录后访问业务目录</h4>
      <p>普通业务目录、搜索和元数据只对已登录用户开放。</p>
      <button className="btn primary" type="button" onClick={onRequireLogin}>登录</button>
    </div>
  );
}

function ModuleLoadingState() {
  return (
    <div className="state-card" role="status" aria-live="polite">
      <div className="state-spinner" aria-hidden="true"></div>
      <h4>加载业务模块</h4>
      <p>正在准备当前页面。</p>
    </div>
  );
}

export function ModuleContent({ module, context }) {
  const renderer = MODULE_RENDERERS[module] || MODULE_RENDERERS.dwm;
  if (module !== "portal" && context.businessAccessReady === false) {
    return <AuthenticatedBusinessPrompt onRequireLogin={() => context.requireLogin?.(() => {})} />;
  }
  if (module === "portal") {
    return renderer({ context });
  }
  const content = renderer({ context });
  return <React.Suspense fallback={<ModuleLoadingState />}>{content}</React.Suspense>;
}

export { MODULE_RENDERERS };
