import {
  AssetSidebar,
  ApiAssetSidebar,
  IndicatorSidebar,
  MappingSidebar,
  ManualCodeTableSidebar,
  PushSidebar,
  ReportSidebar,
  RootSidebar,
  SystemSidebar,
  UpstreamSidebar,
} from "../sidebar/index.js";

export function ModuleSidebar({ module, context }) {
  const {
    apiAsset, apiAssetFilter, asset, can, canEdit, canManageSystem, indicator,
    indicatorFilter, lineageBootstrap, manualCodeTable, push, pushRoute, report,
    reportFilter, requireLogin, root, setApiAssetFilter, setIndicatorFilter,
    setIndicatorRoute, setPushRoute, setReportFilter, setReportRoute, setRootRoute,
    setSystemActionIntent, setSystemRoute, setUpRoute, statusOptions, systemRoute,
    upstream,
  } = context;
  const canPermission = can || (() => canEdit);

  if (module === "codeTable") return <ManualCodeTableSidebar module={manualCodeTable} canEdit={canPermission("code_table:write")} />;
  if (module === "push") {
    return <PushSidebar push={push} statusOptions={statusOptions} requireLogin={requireLogin} pushRoute={pushRoute} setPushRoute={setPushRoute} />;
  }
  if (module === "indicator") {
    return <IndicatorSidebar indicator={indicator} indicatorFilter={indicatorFilter} setIndicatorFilter={setIndicatorFilter} setIndicatorRoute={setIndicatorRoute} />;
  }
  if (module === "report") {
    return <ReportSidebar report={{ ...report, reportFilter, setReportFilter }} requireLogin={requireLogin} setReportRoute={setReportRoute} />;
  }
  if (module === "apiAsset") {
    return <ApiAssetSidebar apiAsset={apiAsset} filter={apiAssetFilter} setFilter={setApiAssetFilter} requireLogin={requireLogin} />;
  }
  if (module === "root") return <RootSidebar root={root} requireLogin={requireLogin} setRootRoute={setRootRoute} />;
  if (module === "system") {
    return <SystemSidebar systemRoute={systemRoute} setSystemRoute={setSystemRoute} setSystemActionIntent={setSystemActionIntent} canManageSystem={canManageSystem} />;
  }
  if (module === "upstream") {
    return <UpstreamSidebar upstream={upstream} statusOptions={statusOptions} requireLogin={requireLogin} setUpRoute={setUpRoute} />;
  }
  if (module === "mapping") return <MappingSidebar />;
  if (module === "lineage") {
    const details = lineageBootstrap;
    const note = details?.mode === "persistent"
      ? `当前为持久化血缘快照${details.snapshotName ? `：${details.snapshotName}` : ""}`
      : ["poc", "demo"].includes(details?.mode)
        ? "当前为全渠道零售演示血缘，不是数据库真实血缘。"
        : "血缘数据源尚未配置";
    return <div className="side-group"><div className="side-title">血缘范围</div><div className="side-note">{note}</div>{details?.mode === "persistent" && details.snapshotAt ? <div className="side-note">更新时间：{details.snapshotAt} · 节点：{details.nodeCount} · 关系：{details.edgeCount}</div> : null}</div>;
  }
  return <AssetSidebar asset={asset} />;
}
