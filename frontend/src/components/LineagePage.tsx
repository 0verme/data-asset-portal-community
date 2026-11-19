import React from "react";
import { useTranslation } from "react-i18next";

import {
  findLineageNodes,
  getLineageInitialView,
  type LineageBootstrap,
  type LineageNode,
  type LineageSubgraph,
} from "../api/lineage.ts";
import type { LineageRoute } from "../routing/types.ts";
import { ActionErrorBanner, EmptyState, ErrorState, LoadingState } from "./common/index.ts";
import { LineageCanvas } from "./lineage/LineageCanvas.tsx";
import { LineageSnapshotTime } from "./lineage/LineageSnapshotTime.tsx";
import { lineageUnavailableState } from "./lineage/lineageUnavailableState.ts";
import { describeLineageNode, lineageNodeKindKey } from "./lineage/lineageNodePresentation.ts";
import {
  lineageSearchQueryForCandidate,
  resolveLineageSearchMatches,
} from "./lineage/lineageSearch.ts";
import { Icon } from "./ui.tsx";
import { Button, Input, Select } from "../ui/index.ts";

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
  selectedNodeId: string | null;
  focusRequest: { nodeId: string; sequence: number } | null;
  onFocusRequestHandled: (sequence: number) => void;
  onNodesChange: (nodes: LineageNode[]) => void;
  onSelectedNodeChange: (nodeId: string | null) => void;
}

export function LineagePage({
  route,
  onRouteChange,
  onBootstrap,
  selectedNodeId,
  focusRequest,
  onFocusRequestHandled,
  onNodesChange,
  onSelectedNodeChange,
}: LineagePageProps) {
  const { t } = useTranslation("lineage");
  const [graph, setGraph] = React.useState<LineageSubgraph | null>(null);
  const [pendingFilters, setPendingFilters] = React.useState<PendingLineageFilters>(() => routeFilters(route));
  const [query, setQuery] = React.useState("");
  const [queryError, setQueryError] = React.useState("");
  const [querying, setQuerying] = React.useState(false);
  const [candidates, setCandidates] = React.useState<LineageNode[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [bootstrap, setBootstrap] = React.useState<LineageBootstrap | null>(null);
  const [noticeCode, setNoticeCode] = React.useState<string | null>(null);
  const appliedRouteRef = React.useRef<string | null>(null);
  const requestSequenceRef = React.useRef(0);
  const routeDirection = route.direction;
  const routeDepth = route.depth;
  const routeView = route.view;

  const loadGraph = React.useCallback(async (nextRoute: LineageRoute): Promise<void> => {
    const sequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = sequence;
    setLoading(true);
    setError(null);
    setNoticeCode(null);
    try {
      const result = await getLineageInitialView({
        rootId: nextRoute.rootId || undefined,
        direction: nextRoute.direction,
        depth: nextRoute.depth,
        view: nextRoute.view,
        maxNodes: MAX_NODES,
      });
      if (requestSequenceRef.current !== sequence) return;
      setBootstrap(result.bootstrap);
      onBootstrap(result.bootstrap);
      if (!result.graph) {
        appliedRouteRef.current = routeKey(nextRoute);
        setGraph(null);
        onNodesChange([]);
        onSelectedNodeChange(null);
        return;
      }
      const data = result.graph;
      setNoticeCode(result.noticeCode);
      const resolvedRoute: LineageRoute = {
        ...nextRoute,
        rootId: data.rootId,
        view: normalizeView(data.view),
      };
      appliedRouteRef.current = routeKey(resolvedRoute);
      setGraph({ ...data, view: resolvedRoute.view });
      onNodesChange(data.nodes);
      onSelectedNodeChange(data.rootId);
      onRouteChange(resolvedRoute);
    } catch (cause: unknown) {
      if (isAbortError(cause) || requestSequenceRef.current !== sequence) return;
      setError(getErrorMessage(cause, ""));
    } finally {
      if (requestSequenceRef.current === sequence) setLoading(false);
    }
  }, [onBootstrap, onNodesChange, onRouteChange, onSelectedNodeChange]);

  React.useEffect(() => {
    const key = routeKey(route);
    if (appliedRouteRef.current !== key) void loadGraph(route);
  }, [loadGraph, route]);

  React.useEffect(() => {
    setPendingFilters({ direction: routeDirection, depth: routeDepth, view: routeView });
  }, [routeDirection, routeDepth, routeView]);

  React.useEffect(() => () => {
    requestSequenceRef.current += 1;
    onNodesChange([]);
    onSelectedNodeChange(null);
  }, [onNodesChange, onSelectedNodeChange]);

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
    setCandidates([]);
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
        setQueryError(t("noMatch", { name: nodeName }));
      } else {
        const resolution = resolveLineageSearchMatches(nodeName, matches);
        if (resolution.directMatch) {
          await openCandidate(resolution.directMatch);
        } else {
          setCandidates(resolution.candidates);
        }
      }
    } catch (cause: unknown) {
      if (!isAbortError(cause)) setQueryError(getErrorMessage(cause, t("searchError")));
    } finally {
      setQuerying(false);
    }
  };

  const selectCandidate = (candidate: LineageNode) => {
    setCandidates([]);
    setQuery(lineageSearchQueryForCandidate(candidate));
    void openCandidate(candidate);
  };

  const errorMessage = error === null ? "" : error || t("errorDescription");
  if (!graph) {
    const state = lineageUnavailableState(loading, error, bootstrap?.status);
    const retry = () => void loadGraph(route);
    if (state === "loading") {
      return <LoadingState title={t("loadingTitle")} desc={t("loadingDescription")} />;
    }
    if (state === "error") {
      return <ErrorState title={t("errorTitle")} desc={errorMessage} retryText={t("retry")} onRetry={retry} />;
    }
    return <EmptyState title={t("emptyTitle")} desc={t(state)} actionText={t("retry")} actionIcon="refresh" onAction={retry} />;
  }

  const selected = graph.nodes.find((node) => node.id === selectedNodeId)
    || graph.nodes.find((node) => node.id === graph.rootId);
  const related = graph.edges.filter((edge) => edge.sourceId === selected?.id || edge.targetId === selected?.id);
  const upstreamCount = graph.edges.filter((edge) => edge.targetId === selected?.id).length;
  const downstreamCount = graph.edges.filter((edge) => edge.sourceId === selected?.id).length;
  const root = graph.nodes.find((node) => node.id === graph.rootId);
  const sourceLabel = t(bootstrap?.mode === "persistent" ? "persistent" : "demo");
  const selectedLabel = selected && describeLineageNode(selected);
  const notice = noticeCode === "ROOT_NOT_IN_SNAPSHOT" ? t("rootMissing")
    : noticeCode === "TABLE_VIEW_REQUIRES_TABLE_ROOT" ? t("tableRootRequired") : "";

  return (
    <div className="lineage-page">
      <div className="page-head">
        <div>
          <div className="page-title">{t("title")}</div>
          <div className="page-sub">{t("snapshotDescription", { id: graph.snapshot.snapshotId })}</div>
        </div>
        <div className="lineage-actions">
          <label>{t("view")}<Select<string> aria-label={t("viewLabel")} className="sel" disabled={loading || querying} items={[{ label: t("viewType.table"), value: "table" }, { label: t("viewType.detail"), value: "detail" }]} value={pendingFilters.view || null} onValueChange={(value) => setPendingFilters((current) => ({ ...current, view: normalizeView(value || "table") }))} /></label>
          <label>{t("direction")}<Select<string> aria-label={t("directionLabel")} className="sel" disabled={loading || querying} items={[{ label: t("directionType.both"), value: "both" }, { label: t("directionType.upstream"), value: "upstream" }, { label: t("directionType.downstream"), value: "downstream" }]} value={pendingFilters.direction || null} onValueChange={(value) => setPendingFilters((current) => ({ ...current, direction: normalizeDirection(value || "both") }))} /></label>
          <label>{t("depth")}<Select<string> aria-label={t("depthLabel")} className="sel" disabled={loading || querying} items={[1, 2, 3, 4, 5].map((value) => ({ label: t("depthValue", { count: value }), value: String(value) }))} value={String(pendingFilters.depth)} onValueChange={(value) => setPendingFilters((current) => ({ ...current, depth: Number(value || 1) }))} /></label>
          <Button className="btn" variant="secondary" type="button" onClick={() => void loadGraph({ ...route, ...pendingFilters })} disabled={loading}><Icon name="refresh" size={15} />{loading ? t("loading") : t("refresh")}</Button>
        </div>
      </div>
      <form className="lineage-query" onSubmit={(event) => void submitQuery(event)}>
        <label htmlFor="lineage-node-name">{t("queryLabel")}</label>
        <Input id="lineage-node-name" aria-label={t("queryInput")} value={query} onChange={(event) => { setQuery(event.target.value); setQueryError(""); setCandidates([]); }} placeholder={t("queryPlaceholder")} disabled={querying} aria-describedby="lineage-query-status" />
        <Button className="btn primary" variant="primary" type="submit" disabled={querying}>{querying ? t("searching") : t("search")}</Button>
        <Button className="btn" variant="secondary" type="button" onClick={() => { setQuery(""); setQueryError(""); setCandidates([]); }} disabled={!query || querying}>{t("clear")}</Button>
        <span id="lineage-query-status" className="lineage-query-status" role={queryError ? "alert" : "status"} aria-live="polite">{queryError}</span>
      </form>
      {candidates.length ? (
        <div className="lineage-candidates" role="list" aria-label={t("candidates")}>
          {candidates.map((candidate) => {
            const label = describeLineageNode(candidate);
            return (
              <button
                className="lineage-candidate"
                type="button"
                role="listitem"
                key={candidate.id}
                onClick={() => selectCandidate(candidate)}
              >
                <b>{label.title}</b>
                <span>{t(lineageNodeKindKey(candidate.kind))}</span>
                <small>{[label.namespace, label.subtitle].filter(Boolean).join(" · ")}</small>
              </button>
            );
          })}
        </div>
      ) : null}
      {notice ? <p className="lineage-notice" role="status">{notice}</p> : null}
      <ActionErrorBanner title={t("errorTitle")} message={errorMessage} />
      {graph.truncated ? <p className="lineage-notice" role="status">{t("truncated")}</p> : null}
      {graph.diagnostics?.length ? <details className="lineage-diagnostics"><summary>{t("diagnostics", { count: graph.diagnostics.length })}</summary><ul>{graph.diagnostics.map((item, index) => { const diagnostic = diagnosticValue(item); return <li key={diagnosticKey(item, index)}><b>{diagnostic.code || "DIAGNOSTIC"}</b>{diagnostic.message || String(item)}</li>; })}</ul></details> : null}
      <div className="lineage-layout">
        <section className="lineage-card" aria-busy={loading}>
          <div className="lineage-card-head"><span>{t("graphHeading", { source: sourceLabel, root: root ? describeLineageNode(root).title : graph.rootId, view: t(`viewType.${route.view}`) })}</span><span className="tag tag-info">{t("graphCount", { nodes: graph.nodes.length, edges: graph.edges.length })}</span></div>
          <LineageCanvas graph={graph} selectedNodeId={selectedNodeId} focusRequest={focusRequest} onFocusRequestHandled={onFocusRequestHandled} onSelect={onSelectedNodeChange} />
        </section>
        <aside className="lineage-detail">
          <div className="lineage-card-head"><span>{t("detail")}</span>{selected && <span className="tag tag-neutral" title={selected.kind}>{t(lineageNodeKindKey(selected.kind))}</span>}</div>
          {selected && selectedLabel ? <div className="lineage-detail-content">
            <h2>{selectedLabel.title}</h2>
            {selectedLabel.subtitle && <p>{selectedLabel.subtitle}</p>}
            <dl>
              <dt>{t("stableId")}</dt><dd className="mono">{selected.id}</dd>
              {selectedLabel.namespace && <><dt>{t("namespace")}</dt><dd>{selectedLabel.namespace}</dd></>}
              <dt>{t("upstream")}</dt><dd>{upstreamCount}</dd>
              <dt>{t("downstream")}</dt><dd>{downstreamCount}</dd>
              <dt>{t("dwf")}</dt><dd>{selected.attributes?.["dwfBoundary"] || ["dwf", "dws_dwf"].includes(selected.namespace) ? t("yes") : t("no")}</dd>
              <dt>{t("snapshotTime")}</dt><dd><LineageSnapshotTime value={graph.snapshot.generatedAt} /></dd>
            </dl>
            <h3>{t("evidence")}</h3>
            <div className="lineage-evidence-list">{related.map((edge) => <div className="lineage-evidence" key={edge.id}><b>{edge.kind}</b><span>{edge.evidence.type} · {edge.confidence}</span>{edge.viaJobs?.length ? <span>{t("viaJobs", { jobs: edge.viaJobs.join(", ") })}</span> : null}<small>{edge.evidence.description}</small></div>)}</div>
          </div> : null}
        </aside>
      </div>
    </div>
  );
}
