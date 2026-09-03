/// <reference types="vite/client" />
import { requestRemote } from './http.ts';
import { createInFlightRequestGroup } from './inFlightRequests.ts';

const API_MODE = (
  typeof import.meta !== 'undefined' && import.meta.env?.['VITE_API_MODE']
    ? String(import.meta.env['VITE_API_MODE'])
    : 'mock'
).trim().toLowerCase();

const runInitialViewRequest = createInFlightRequestGroup();
const rootId = 'table:dws:DWS_TRADE_SALES_STAT_1D';

export interface LineageNode {
  id: string;
  kind: string;
  name: string;
  displayName: string;
  namespace: string;
  attributes: Record<string, unknown>;
}

export interface LineageEdgeEvidence {
  type: string;
  sourceRecordId: string;
  description: string;
}

export interface LineageEdge {
  id: string;
  sourceId: string;
  targetId: string;
  kind: string;
  evidence: LineageEdgeEvidence;
  confidence: string;
  generatedAt: string;
  diagnostics: unknown[];
}

const nodeSpecs: ReadonlyArray<[string, string, string, string, string]> = [
  ['table:pos:POS_RECEIPT', 'table', 'POS_RECEIPT', '门店 POS 小票源表', 'pos'],
  ['table:oms:ORDER_HEADER', 'table', 'ORDER_HEADER', '线上订单源表', 'oms'],
  ['task:load_pos_order', 'task', 'JOB_LOAD_POS_ORDER', '门店订单装载任务', 'scheduler'],
  ['task:load_online_order', 'task', 'JOB_LOAD_ONLINE_ORDER', '线上订单装载任务', 'scheduler'],
  ['table:dwd:DWD_TRADE_ORDER', 'table', 'DWD_TRADE_ORDER', '统一订单明细表', 'dwd'],
  ['task:build_sales_detail', 'task', 'JOB_BUILD_SALES_DETAIL', '零售销售明细加工任务', 'scheduler'],
  ['table:dwm:DWM_TRADE_ORDER_DETAIL_DI', 'table', 'DWM_TRADE_ORDER_DETAIL_DI', '零售订单明细中间表', 'dwm'],
  ['task:aggregate_daily_sales', 'task', 'JOB_AGGREGATE_DAILY_SALES', '全渠道销售日汇总任务', 'scheduler'],
  [rootId, 'table', 'DWS_TRADE_SALES_STAT_1D', '全渠道销售汇总日表', 'dws'],
  ['indicator:ORD00001', 'indicator', 'ORD00001', '销售额', 'indicator'],
  ['report:RPT_RETAIL_DAILY', 'report', 'RPT_RETAIL_DAILY', '全渠道零售经营日报', 'report'],
  ['task:push_retail_dashboard', 'task', 'JOB_BI_01', '经营看板数据输出任务', 'scheduler'],
  ['push:bi:daily_sales', 'push_job', 'BI_DAILY_SALES', '零售经营看板日汇总', 'bi'],
];

const nodes: LineageNode[] = nodeSpecs.map(([id, kind, name, displayName, namespace]) => ({
  id,
  kind,
  name,
  displayName,
  namespace,
  attributes: {},
}));

const edge = (
  id: string,
  sourceId: string,
  targetId: string,
  kind: string,
  type = 'demo_metadata',
): LineageEdge => ({
  id,
  sourceId,
  targetId,
  kind,
  evidence: { type, sourceRecordId: `demo:${id}`, description: '全渠道零售演示血缘证据' },
  confidence: 'high',
  generatedAt: '2026-07-20T02:00:00Z',
  diagnostics: [],
});

const edges: LineageEdge[] = [
  edge('1', nodes[0]?.id || '', nodes[2]?.id || '', 'task_reads_table', 'field_mapping'),
  edge('2', nodes[1]?.id || '', nodes[3]?.id || '', 'task_reads_table', 'field_mapping'),
  edge('3', nodes[2]?.id || '', nodes[4]?.id || '', 'task_writes_table', 'field_mapping'),
  edge('4', nodes[3]?.id || '', nodes[4]?.id || '', 'task_writes_table', 'field_mapping'),
  edge('5', nodes[4]?.id || '', nodes[5]?.id || '', 'task_reads_table'),
  edge('6', nodes[5]?.id || '', nodes[6]?.id || '', 'task_writes_table'),
  edge('7', nodes[6]?.id || '', nodes[7]?.id || '', 'task_reads_table'),
  edge('8', nodes[7]?.id || '', nodes[8]?.id || '', 'task_writes_table'),
  edge('9', nodes[8]?.id || '', nodes[9]?.id || '', 'indicator_derivation'),
  edge('10', nodes[9]?.id || '', nodes[10]?.id || '', 'report_reference'),
  edge('11', nodes[8]?.id || '', nodes[11]?.id || '', 'task_reads_table'),
  edge('12', nodes[11]?.id || '', nodes[12]?.id || '', 'push_delivery', 'push_metadata'),
];

const tableNodes = nodes.filter((node) => node.kind === 'table');
const tableEdges: LineageEdge[] = [
  edge('table-1', tableNodes[0]?.id || '', tableNodes[2]?.id || '', 'table_lineage', 'derived_job_path'),
  edge('table-2', tableNodes[1]?.id || '', tableNodes[2]?.id || '', 'table_lineage', 'derived_job_path'),
  edge('table-3', tableNodes[2]?.id || '', tableNodes[3]?.id || '', 'table_lineage', 'derived_job_path'),
  edge('table-4', tableNodes[3]?.id || '', tableNodes[4]?.id || '', 'table_lineage', 'derived_job_path'),
];

export interface LineageSubgraph {
  snapshot: {
    snapshotId: string;
    generatedAt: string;
    generator: { name: string; version: string };
  };
  rootId: string;
  view: string;
  nodes: LineageNode[];
  edges: LineageEdge[];
  truncated: boolean;
  diagnostics: unknown[];
}

export interface LineageBootstrap {
  mode: string;
  status: string;
  snapshotId: string;
  snapshotName: string;
  snapshotAt: string;
  defaultRootId: string;
  nodeCount: number;
  edgeCount: number;
}

export interface LineageInitialViewResult {
  bootstrap: LineageBootstrap;
  graph: LineageSubgraph;
  noticeCode: string | null;
}

export interface LineageQueryParams {
  view?: string | undefined;
  rootId?: string | undefined;
  [key: string]: unknown;
}

export interface LineageRequestOptions {
  signal?: AbortSignal | null | undefined;
}

interface LineageRemoteEnvelope<T> {
  data: T;
}

export async function getLineageSubgraph(
  params: LineageQueryParams = {},
  options: LineageRequestOptions = {},
): Promise<LineageSubgraph> {
  if (API_MODE === 'remote') {
    const response = await requestRemote<LineageRemoteEnvelope<LineageSubgraph>>('/lineage/subgraph', {
      params,
      signal: options.signal,
    });
    return response.data;
  }
  const view = params.view || 'table';
  return {
    snapshot: {
      snapshotId: 'retail-demo-20260720',
      generatedAt: '2026-07-20T02:00:00Z',
      generator: { name: 'retail-demo', version: '1.0' },
    },
    rootId: params.rootId || rootId,
    view,
    nodes: view === 'table' ? tableNodes : nodes,
    edges: view === 'table' ? tableEdges : edges,
    truncated: false,
    diagnostics: [],
  };
}

export async function getLineageBootstrap(options: LineageRequestOptions = {}): Promise<LineageBootstrap> {
  if (API_MODE === 'remote') {
    const response = await requestRemote<LineageRemoteEnvelope<LineageBootstrap>>('/lineage/bootstrap', {
      signal: options.signal,
    });
    return response.data;
  }
  return {
    mode: 'demo',
    status: 'ready',
    snapshotId: 'retail-demo-20260720',
    snapshotName: '全渠道零售演示血缘',
    snapshotAt: '2026-07-20T02:00:00Z',
    defaultRootId: rootId,
    nodeCount: nodes.length,
    edgeCount: edges.length,
  };
}

export function getLineageInitialView(params: LineageQueryParams = {}): Promise<LineageInitialViewResult> {
  const requestParams = Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  );
  const entries = Object.entries(requestParams);
  entries.sort(([left], [right]) => left.localeCompare(right));
  const requestKey = JSON.stringify(entries);

  return runInitialViewRequest<LineageInitialViewResult>(requestKey, async () => {
    if (API_MODE === 'remote') {
      const response = await requestRemote<LineageRemoteEnvelope<LineageInitialViewResult>>(
        '/lineage/initial-view',
        { params: requestParams },
      );
      return response.data;
    }
    const bootstrap = await getLineageBootstrap();
    const rawRootId = requestParams['rootId'];
    const graphRootId = typeof rawRootId === 'string' && rawRootId ? rawRootId : bootstrap.defaultRootId;
    const graph = await getLineageSubgraph({
      ...requestParams,
      rootId: graphRootId,
    });
    return { bootstrap, graph, noticeCode: null };
  });
}

export async function findLineageNodes(
  name: string,
  options: LineageRequestOptions = {},
): Promise<LineageNode[]> {
  if (API_MODE === 'remote') {
    const response = await requestRemote<LineageRemoteEnvelope<LineageNode[]>>('/lineage/assets', {
      params: { name },
      signal: options.signal,
    });
    return response.data;
  }
  const query = String(name || '').trim().toLowerCase();
  return query
    ? nodes.filter(
        (node) =>
          ['table', 'task'].includes(node.kind) &&
          `${node.name} ${node.displayName}`.toLowerCase().includes(query),
      )
    : [];
}
