import type { Dispatch, SetStateAction } from 'react';

import type { AuthSession } from '../../api/auth.ts';
import type { LineageBootstrap, LineageNode } from '../../api/lineage.ts';
import type { UseApiAssetModuleResult } from '../../hooks/useApiAssetModule.ts';
import type { UseAssetModuleResult } from '../../hooks/useAssetModule.ts';
import type { UseAuthSessionResult } from '../../hooks/useAuthSession.ts';
import type { UseIndicatorModuleResult } from '../../hooks/useIndicatorModule.ts';
import type { UseManualCodeTableModuleResult } from '../../hooks/useManualCodeTableModule.ts';
import type {
  NavigationActions,
  UseNavigationControllerResult,
} from '../../hooks/useNavigationController.ts';
import type { UsePushModuleResult } from '../../hooks/usePushModule.ts';
import type { UseReportModuleResult } from '../../hooks/useReportModule.ts';
import type { UseRootModuleResult } from '../../hooks/useRootModule.ts';
import type { DictOption } from '../../utils/optionUtils.ts';
import type { UseUpstreamModuleResult } from '../../hooks/useUpstreamModule.ts';
import type {
  ApiAssetFilter,
  ApiAssetRoute,
  AssetRoute,
  IndicatorFilter,
  IndicatorRoute,
  LineageRoute,
  MappingRoute,
  PushRoute,
  ReportFilter,
  ReportRoute,
  RootRoute,
  SystemRoute,
  UpstreamRoute,
} from '../../routing/types.ts';

export interface AppModuleContext {
  apiAsset: UseApiAssetModuleResult;
  apiAssetFilter: ApiAssetFilter;
  apiAssetRoute: ApiAssetRoute;
  apiAssetView: string;
  asset: UseAssetModuleResult;
  auth: AuthSession;
  backToUpstreamList: () => void;
  businessAccessReady: boolean;
  catalogAccessDisabled: boolean;
  catalogExportEnabled: boolean;
  can: UseAuthSessionResult['can'];
  canEdit: boolean;
  canManageMenus: boolean;
  canManageParams: boolean;
  canManageRoles: boolean;
  canManageSystem: boolean;
  canManageUsers: boolean;
  canViewMenus: boolean;
  canViewOperationLog: boolean;
  canViewParams: boolean;
  canViewRoles: boolean;
  canViewUsers: boolean;
  goToMapping: NavigationActions['goToMapping'];
  goToModuleWithQuery: NavigationActions['goToModuleWithQuery'];
  indicator: UseIndicatorModuleResult;
  indicatorFilter: IndicatorFilter;
  indicatorRoute: IndicatorRoute;
  indicatorView: string;
  lineageBootstrap: LineageBootstrap | null;
  lineageNodes: LineageNode[];
  lineageSelectedNodeId: string | null;
  lineageSelectionSequence: number;
  handleLineageSelectionChange: (nodeId: string | null) => void;
  lineageFocusRequest: { nodeId: string; sequence: number } | null;
  handleLineageFocusRequestHandled: (sequence: number) => void;
  lineageRoute: LineageRoute;
  manualCodeTable: UseManualCodeTableModuleResult;
  mappingRoute: MappingRoute;
  push: UsePushModuleResult;
  pushRoute: PushRoute;
  query: string;
  report: UseReportModuleResult;
  reportFilter: ReportFilter;
  reportRoute: ReportRoute;
  reportView: string;
  requireLogin: UseAuthSessionResult['requireLogin'];
  root: UseRootModuleResult;
  rootRoute: RootRoute;
  route: AssetRoute;
  setApiAssetFilter: UseNavigationControllerResult['setApiAssetFilter'];
  setApiAssetRoute: UseNavigationControllerResult['setApiAssetRoute'];
  setApiAssetView: UseNavigationControllerResult['setApiAssetView'];
  setAuthError: UseAuthSessionResult['setAuthError'];
  setIndicatorFilter: UseNavigationControllerResult['setIndicatorFilter'];
  setIndicatorRoute: UseNavigationControllerResult['setIndicatorRoute'];
  setIndicatorView: UseNavigationControllerResult['setIndicatorView'];
  setLineageBootstrap: Dispatch<SetStateAction<LineageBootstrap | null>>;
  setLineageNodes: Dispatch<SetStateAction<LineageNode[]>>;
  setLineageSelectedNodeId: Dispatch<SetStateAction<string | null>>;
  focusLineageNode: (nodeId: string) => void;
  setLineageFocusRequest: Dispatch<SetStateAction<{ nodeId: string; sequence: number } | null>>;
  setLineageRoute: UseNavigationControllerResult['setLineageRoute'];
  setMappingRoute: UseNavigationControllerResult['setMappingRoute'];
  setPushRoute: UseNavigationControllerResult['setPushRoute'];
  setQuery: UseNavigationControllerResult['setQuery'];
  setReportFilter: UseNavigationControllerResult['setReportFilter'];
  setReportRoute: UseNavigationControllerResult['setReportRoute'];
  setReportView: UseNavigationControllerResult['setReportView'];
  setRootRoute: UseNavigationControllerResult['setRootRoute'];
  setSystemActionIntent: (intent: string) => void;
  setSystemRoute: UseNavigationControllerResult['setSystemRoute'];
  setUpRoute: UseNavigationControllerResult['setUpRoute'];
  statusOptions: DictOption[];
  systemActionIntent: string;
  systemRoute: SystemRoute;
  upRoute: UpstreamRoute;
  upstream: UseUpstreamModuleResult;
  visibleModuleKeys: string[];
}
