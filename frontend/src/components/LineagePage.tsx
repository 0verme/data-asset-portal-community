import React from "react";

import {
  findLineageNodes,
  getLineageInitialView,
  type LineageBootstrap,
  type LineageNode,
  type LineageSubgraph,
} from "../api/lineage.ts";
import type { LineageRoute } from "../routing/types.ts";
import { formatDateTime } from "../utils/date.ts";
import { ActionErrorBanner, ErrorState, LoadingState } from "./common/index.ts";
import { LineageCanvas } from "./lineage/LineageCanvas.tsx";
import { Icon } from "./ui.tsx";

const MAX_NODES = 100;
type LineageDirection = LineageRoute["direction"];
type LineageView = LineageRoute["view"];

interface PendingLineageFilters {
  direction: LineageDirection;
  depth: number;
  view: LineageView;
}

interface LineageDiagnostic {
  code?: string | undefined;
  message?: string | undefined;
}

function routeKey({ rootId, direction, depth, view }: LineageRoute): string {
  return `${rootId}|${direction}|${depth}|${view}`;
}

function routeFilters({ direction, depth, view }: LineageRoute): PendingLineageFilters {
  return { direction, depth, view };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  return fallback;
}

function diagnosticValue(value: unknown): LineageDiagnostic {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { message: String(value || "") };
  const record = value as Record<string, unknown>;
  return {
    code: typeof record["code"] === "string" ? record["code"] : undefined,
    message: typeof record["message"] === "string" ? record["message"] : undefined,
  };
}

function diagnosticKey(item: unknown, index: number): string {
  const diagnostic = diagnosticValue(item);
  return `${diagnostic.code || "DIAGNOSTIC"}-${diagnostic.message || ""}-${index}`;
}

function normalizeView(value: string): LineageView {
  return value === "detail" ? "detail" : "table";
}

function normalizeDirection(value: string): LineageDirection {
  if (value === "upstream" || value === "downstream") return value;
  return "both";
}

export interface LineagePageProps {
  route: LineageRoute;
  onRouteChange: (route: LineageRoute) => void;
  onBootstrap: (bootstrap: LineageBootstrap) => void;
}

export function LineagePage({ route, onRouteChange, onBootstrap }: LineagePageProps) {
  const [graph, setGraph] = React.useState<LineageSubgraph | null>(null);
  const [pendingFilters, setPendingFilters] = React.useState<PendingLineageFilters>(() => routeFilters(route));
  const [selectedId, setSelectedId] = React.useState<string | null>(route.rootId);
  const [query, setQuery] = React.useState("");
  const [queryError, setQueryError] = React.useState("");
  const [querying, setQuerying] = React.useState(false);
  const [candidates, setCandidates] = React.useState<LineageNode[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [bootstrap, setBootstrap] = React.useState<LineageBootstrap | null>(null);
  const [notice, setNotice] = React.useState("");
  const appliedRouteRef = React.useRef<string | null>(null);
  const requestSequenceRef = React.useRef(0);
  const routeDirection = route.direction;
  const routeDepth = route.depth;
  const routeView = route.view;

  const loadGraph = React.useCallback(async (nextRoute: LineageRoute): Promise<void> => {
    const sequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = sequence;
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const result = await getLineageInitialView({
        rootId: nextRoute.rootId || undefined,
        direction: nextRoute.direction,
        depth: nextRoute.depth,
        view: nextRoute.view,
        maxNodes: MAX_NODES,
      });
      if (requestSequenceRef.current !== sequence) return;
      const initial = result.bootstrap;
      const formattedBootstrap: LineageBootstrap = { ...initial, snapshotAt: formatDateTime(initial.snapshotAt) };
      setBootstrap(formattedBootstrap);
      onBootstrap(formattedBootstrap);
      if (!result.graph) {
        appliedRouteRef.current = routeKey(nextRoute);
        setGraph(null);
        return;
      }
      const data = result.graph;
      if (result.noticeCode === "ROOT_NOT_IN_SNAPSHOT") {
        setNotice("原根节点不在当前快照中，已切换至可用表节点。");
      } else if (result.noticeCode === "TABLE_VIEW_REQUIRES_TABLE_ROOT") {
        setNotice("表级简图需要表节点，已切换至默认表。");
      }
      const resolvedRoute: LineageRoute = {
        ...nextRoute,
        rootId: data.rootId,
        view: normalizeView(data.view),
      };
      appliedRouteRef.current = routeKey(resolvedRoute);
      setGraph({
        ...data,
        view: normalizeView(data.view),
        snapshot: { ...data.snapshot, generatedAt: formatDateTime(data.snapshot.generatedAt) },
      });
      setSelectedId(data.rootId);
      onRouteChange(resolvedRoute);
    } catch (cause: unknown) {
      if (isAbortError(cause) || requestSequenceRef.current !== sequence) return;
      setError(getErrorMessage(cause, "血缘子图加载失败"));
    } finally {
      if (requestSequenceRef.current === sequence) setLoading(false);
    }
  }, [onBootstrap, onRouteChange]);

  React.useEffect(() => {
    const key = routeKey(route);
    if (appliedRouteRef.current !== key) void loadGraph(route);
  }, [loadGraph, route]);

  React.useEffect(() => {
    setPendingFilters({ direction: routeDirection, depth: routeDepth, view: routeView });
  }, [routeDirection, routeDepth, routeView]);

  React.useEffect(() => () => {
    requestSequenceRef.current += 1;
  }, []);

  const openCandidate = async (candidate: LineageNode): Promise<void> => {
    const view: LineageView = candidate.kind === "task" ? "detail" : pendingFilters.view;
    await loadGraph({ ...route, ...pendingFilters, rootId: candidate.id, view });
  };

  const submitQuery = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const nodeName = query.trim();
    if (querying) return;
    setQuerying(true);
    setQueryError("");
    try {
      if (!nodeName) {
        const currentRoot = graph?.nodes.find((node) => node.id === graph.rootId);
        await loadGraph({
          ...route,
          ...pendingFilters,
          rootId: pendingFilters.view === "table" && currentRoot?.kind !== "table"
            ? bootstrap?.defaultRootId || route.rootId
            : graph?.rootId || route.rootId,
        });
        return;
      }
      const matches = await findLineageNodes(nodeName);
      if (!matches.length) {
        setQueryError(`当前受控快照中未找到表或作业“${nodeName}”。`);
      } else if (matches.length === 1) {
        const [match] = matches;
        if (match) await openCandidate(match);
      } else {
        setCandidates(matches);
      }
    } catch (cause: unknown) {
      if (!isAbortError(cause)) setQueryError(getErrorMessage(cause, "节点名称查询失败，请稍后重试。"));
    } finally {
      setQuerying(false);
    }
  };

  const selectCandidate = (candidate: LineageNode) => {
    setCandidates([]);
    setQuery(candidate.name);
    void openCandidate(candidate);
  };

  if (loading && !graph) return <LoadingState title="加载血缘子图" desc="正在读取当前血缘快照。" />;
  if (error && !graph) return <ErrorState title="血缘子图加载失败" desc={error} onRetry={() => void loadGraph(route)} />;
  if (!graph) {
    const emptyDescription = bootstrap?.status === "no_active_snapshot"
      ? "当前没有启用的血缘快照。"
      : bootstrap?.status === "empty_snapshot"
        ? "当前血缘快照暂无节点。"
        : "当前没有可用的血缘快照数据。";
    return <ErrorState title="当前没有可用的血缘快照数据" desc={`${emptyDescription}请先采集并发布血缘快照。`} onRetry={() => void loadGraph(route)} />;
  }

  const selected = graph.nodes.find((node) => node.id === selectedId)
    || graph.nodes.find((node) => node.id === graph.rootId);
  const related = graph.edges.filter((edge) => edge.sourceId === selected?.id || edge.targetId === selected?.id);
  const upstreamCount = graph.edges.filter((edge) => edge.targetId === selected?.id).length;
  const downstreamCount = graph.edges.filter((edge) => edge.sourceId === selected?.id).length;
  const root = graph.nodes.find((node) => node.id === graph.rootId);
  const sourceLabel = bootstrap?.mode === "persistent" ? "持久化血缘快照" : "演示血缘数据";

  return (
    <div className="lineage-page">
      <div className="page-head">
        <div>
          <div className="page-title"><span className="pt-code">LINEAGE</span>血缘分析</div>
          <div className="page-sub">表级漫游与作业排障 · 当前快照 {graph.snapshot.snapshotId}</div>
        </div>
        <div className="lineage-actions">
          <label>视图<select value={pendingFilters.view} onChange={(event) => setPendingFilters((current) => ({ ...current, view: normalizeView(event.target.value) }))} disabled={loading || querying} aria-label="血缘视图"><option value="table">表级简图</option><option value="detail">作业详图</option></select></label>
          <label>方向<select value={pendingFilters.direction} onChange={(event) => setPendingFilters((current) => ({ ...current, direction: normalizeDirection(event.target.value) }))} disabled={loading || querying} aria-label="血缘方向"><option value="both">上下游</option><option value="upstream">仅上游</option><option value="downstream">仅下游</option></select></label>
          <label>表层级<select value={pendingFilters.depth} onChange={(event) => setPendingFilters((current) => ({ ...current, depth: Number(event.target.value) }))} disabled={loading || querying} aria-label="血缘层级">{[1, 2, 3, 4, 5].map((value) => <option value={value} key={value}>{value} 层</option>)}</select></label>
          <button className="btn" type="button" onClick={() => void loadGraph({ ...route, ...pendingFilters })} disabled={loading}><Icon name="refresh" size={15} />{loading ? "加载中…" : "刷新"}</button>
        </div>
      </div>
      <form className="lineage-query" onSubmit={(event) => void submitQuery(event)}>
        <label htmlFor="lineage-node-name">表或作业名称查询</label>
        <input id="lineage-node-name" value={query} onChange={(event) => { setQuery(event.target.value); setQueryError(""); setCandidates([]); }} placeholder="例如：DWS_TRADE_SALES_STAT_1D 或 JOB_AGGREGATE_DAILY_SALES" disabled={querying} aria-describedby="lineage-query-status" />
        <button className="btn primary" type="submit" disabled={querying}>{querying ? "查询中…" : "查询"}</button>
        <button className="btn" type="button" onClick={() => { setQuery(""); setQueryError(""); setCandidates([]); }} disabled={!query || querying}>清空</button>
        <span id="lineage-query-status" className="lineage-query-status" role={queryError ? "alert" : "status"} aria-live="polite">{queryError}</span>
      </form>
      {candidates.length ? <div className="lineage-candidates" role="list" aria-label="血缘节点候选项">{candidates.map((candidate) => <button className="lineage-candidate" type="button" role="listitem" key={candidate.id} onClick={() => selectCandidate(candidate)}><b>{candidate.name}</b><span>{candidate.namespace}</span><small>{candidate.displayName}</small></button>)}</div> : null}
      {notice ? <p className="lineage-notice" role="status">{notice}</p> : null}
      <ActionErrorBanner title="血缘图加载失败" message={error} />
      {graph.truncated ? <p className="lineage-notice" role="status">图谱节点已达到 {MAX_NODES} 个上限，当前结果已截断。</p> : null}
      {graph.diagnostics?.length ? <details className="lineage-diagnostics"><summary>快照诊断（{graph.diagnostics.length}）</summary><ul>{graph.diagnostics.map((item, index) => { const diagnostic = diagnosticValue(item); return <li key={diagnosticKey(item, index)}><b>{diagnostic.code || "DIAGNOSTIC"}</b>{diagnostic.message || String(item)}</li>; })}</ul></details> : null}
      <div className="lineage-layout">
        <section className="lineage-card" aria-busy={loading}>
          <div className="lineage-card-head"><span>{sourceLabel}：{root?.name} · {route.view === "table" ? "表级简图" : "作业详图"}</span><span className="tag tag-info">{graph.nodes.length} 节点 / {graph.edges.length} 关系</span></div>
          <LineageCanvas graph={graph} onSelect={setSelectedId} />
        </section>
        <aside className="lineage-detail">
          <div className="lineage-card-head"><span>节点详情</span><span className="tag tag-neutral">{selected?.kind}</span></div>
          {selected ? <div className="lineage-detail-content">
            <h2>{selected.name}</h2>
            <p>{selected.displayName}</p>
            <dl>
              <dt>稳定 ID</dt><dd className="mono">{selected.id}</dd>
              <dt>命名空间</dt><dd>{selected.namespace}</dd>
              <dt>直接上游</dt><dd>{upstreamCount}</dd>
              <dt>直接下游</dt><dd>{downstreamCount}</dd>
              <dt>DWF 截止</dt><dd>{selected.attributes?.["dwfBoundary"] || ["dwf", "dws_dwf"].includes(selected.namespace) ? "是" : "否"}</dd>
              <dt>快照时间</dt><dd>{graph.snapshot.generatedAt}</dd>
            </dl>
            <h3>关系证据</h3>
            <div className="lineage-evidence-list">{related.map((edge) => <div className="lineage-evidence" key={edge.id}><b>{edge.kind}</b><span>{edge.evidence.type} · {edge.confidence}</span>{edge.viaJobs?.length ? <span>经过作业：{edge.viaJobs.join("、")}</span> : null}<small>{edge.evidence.description}</small></div>)}</div>
          </div> : null}
        </aside>
      </div>
    </div>
  );
}
