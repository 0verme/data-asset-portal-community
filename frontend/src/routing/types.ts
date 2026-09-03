export type ModuleId =
  | "portal"
  | "dwm"
  | "upstream"
  | "mapping"
  | "lineage"
  | "root"
  | "indicator"
  | "report"
  | "apiAsset"
  | "push"
  | "codeTable"
  | "system";

export type ModuleMetaKey = Exclude<ModuleId, "portal" | "lineage">;

/**
 * The route objects predate TypeScript and intentionally remain structurally
 * compatible with the legacy JS consumers. Domain-specific routes below add
 * the fields that each boundary guarantees without changing the URL contract.
 */
export interface Route {
  page?: string;
  table?: string | null;
  id?: string | null;
  code?: string | null;
  abbr?: string | null;
  sys?: string | null;
  job?: string | null;
  tab?: string;
  sourceSystemId?: string;
  /** Legacy field retained for callers that have not migrated route objects. */
  upstreamSystemId?: string;
  sourceTable?: string;
  dwfTable?: string;
  rootId?: string | null;
  direction?: string;
  depth?: number;
  view?: string;
}

export interface AssetRoute extends Route {
  page: string;
  table: string | null;
}

export interface PushRoute extends Route {
  page: string;
  sys: string | null;
  job: string | null;
}

export interface IndicatorRoute extends Route {
  page: string;
  id: string | null;
}

export interface ReportRoute extends Route {
  page: string;
  code: string | null;
}

export interface ApiAssetRoute extends Route {
  page: string;
  code: string | null;
}

export interface RootRoute extends Route {
  page: string;
  abbr: string | null;
}

export interface UpstreamRoute extends Route {
  page: string;
  id: string | null;
}

export interface MappingRoute extends Route {
  tab: string;
  sourceSystemId: string;
  sourceTable: string;
  dwfTable: string;
}

export interface LineageRoute extends Route {
  rootId: string | null;
  direction: "upstream" | "downstream" | "both";
  depth: number;
  view: "table" | "detail";
}

export interface SystemRoute extends Route {
  page: string;
}

export type NavigationRoute =
  | Route
  | AssetRoute
  | PushRoute
  | IndicatorRoute
  | ReportRoute
  | ApiAssetRoute
  | RootRoute
  | UpstreamRoute
  | MappingRoute
  | LineageRoute
  | SystemRoute;

export interface NavigationRoutes {
  asset?: AssetRoute;
  push?: PushRoute;
  indicator?: IndicatorRoute;
  report?: ReportRoute;
  apiAsset?: ApiAssetRoute;
  root?: RootRoute;
  upstream?: UpstreamRoute;
  mapping?: MappingRoute;
  lineage?: LineageRoute;
  system?: SystemRoute;
}

export interface IndicatorFilter {
  dimension: string;
  status: string;
}

export interface ReportFilter {
  type: string | null;
  status: string | null;
  ownerDept: string | null;
}

export interface ApiAssetFilter {
  status: string | null;
  method: string | null;
  downstreamSystemId: string | null;
}

export interface PushFilter {
  status: string | null;
  protocol: string | null;
  dept: string | null;
  importanceLevel: string | null;
}

export interface UpstreamFilter {
  status: string | null;
  dbType: string | null;
}

export interface LocationSnapshot {
  module: ModuleId;
  query: string;
  assetRoute: AssetRoute;
  assetLayout: string;
  assetDomain: string | null;
  assetLayer: string | null;
  assetDetailTab: string;
  indicatorRoute: IndicatorRoute;
  indicatorFilter: IndicatorFilter;
  indicatorView: string;
  reportRoute: ReportRoute;
  reportFilter: ReportFilter;
  reportView: string;
  apiAssetRoute: ApiAssetRoute;
  apiAssetFilter: ApiAssetFilter;
  apiAssetView: string;
  pushRoute: PushRoute;
  pushFilter: PushFilter;
  pushView: string;
  upRoute: UpstreamRoute;
  upFilter: UpstreamFilter;
  upstreamView: string;
  mappingRoute: MappingRoute;
  lineageRoute: LineageRoute;
  systemRoute: SystemRoute;
  rootRoute?: RootRoute;
}

export type LocationSnapshotInput = Partial<LocationSnapshot>;

export interface NavigationState {
  module: ModuleId;
  query: string;
  route: AssetRoute;
  pushRoute: PushRoute;
  indicatorRoute: IndicatorRoute;
  reportRoute: ReportRoute;
  apiAssetRoute: ApiAssetRoute;
  rootRoute: RootRoute;
  upRoute: UpstreamRoute;
  mappingRoute: MappingRoute;
  lineageRoute: LineageRoute;
  systemRoute: SystemRoute;
  assetLayoutFromUrl: string;
  assetDomainFromUrl: string | null;
  assetLayerFromUrl: string | null;
  assetDetailTabFromUrl: string;
  pushViewFromUrl: string;
  pushFilterFromUrl: PushFilter;
  upFilterFromUrl: UpstreamFilter;
  upstreamViewFromUrl: string;
  indicatorFilter: IndicatorFilter;
  indicatorView: string;
  reportFilter: ReportFilter;
  reportView: string;
  apiAssetFilter: ApiAssetFilter;
  apiAssetView: string;
}

export interface ModuleMeta {
  moduleKey: ModuleMetaKey;
  moduleName: string;
  defaultRoute: NavigationRoute;
  defaultPath: string;
  listLabel: string;
  backText: string;
}

export interface BreadcrumbItem {
  label?: string;
  onClick?: (() => void) | undefined;
  [key: string]: unknown;
}

export interface AssetUrlState {
  domain?: string | null | undefined;
  selectedLayer?: string | null | undefined;
  layout?: string | null | undefined;
  detailTab?: string | null | undefined;
}

export interface IndicatorUrlState {
  filter?: IndicatorFilter | undefined;
  view?: string | undefined;
}

export interface ReportUrlState {
  filter?: ReportFilter | undefined;
  view?: string | undefined;
}

export interface ApiAssetUrlState {
  filter?: ApiAssetFilter | undefined;
  view?: string | undefined;
}

export interface UpstreamUrlState {
  filter?: UpstreamFilter | undefined;
  view?: string | undefined;
}

export interface PushUrlState {
  filter?: PushFilter | undefined;
  view?: string | undefined;
}

export interface NavigationUrlState {
  asset?: AssetUrlState;
  indicator?: IndicatorUrlState;
  report?: ReportUrlState;
  apiAsset?: ApiAssetUrlState;
  upstream?: UpstreamUrlState;
  push?: PushUrlState;
}

export interface BuildNavigationLocationOptions {
  module: ModuleId;
  routes?: NavigationRoutes;
  query?: string;
  urlState?: NavigationUrlState;
}

export interface NavigationLocation {
  pathname: string;
  search: string;
  url: string;
}

export interface HistoryActionOptions {
  currentUrl: string;
  currentPathname: string;
  nextUrl: string;
  nextPathname: string;
  historyReady: boolean;
  isPopstate?: boolean;
}

export type HistoryAction = "noop" | "push" | "replace";
