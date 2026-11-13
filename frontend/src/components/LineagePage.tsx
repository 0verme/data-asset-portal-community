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
import { formatDateTime } from "../utils/date.ts";
import { ActionErrorBanner, ErrorState, LoadingState } from "./common/index.ts";
import { LineageCanvas } from "./lineage/LineageCanvas.tsx";
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
  const tRef = React.useRef(t);
  tRef.current = t;
  const [graph, setGraph] = React.useState<LineageSubgraph | null>(null);
  const [pendingFilters, setPendingFilters] = React.useState<PendingLineageFilters>(() => routeFilters(route));
  const [query, setQuery] = React.useState("");
  const [queryError, setQueryError] = React.useState("");
  const [querying, setQuerying] = React.useState(false);
  const [candidates, setCandidates] = React.useState<LineageNode[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [bootstrap, setBootstrap] = React.useState<LineageBootstrap | null>(null);
  const [notice, setNotice] = React.useState<"ROOT_NOT_IN_SNAPSHOT" | "TABLE_VIEW_REQUIRES_TABLE_ROOT" | "">("");
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
        onNodesChange([]);
        onSelectedNodeChange(null);
        return;
      }
      const data = result.graph;
      if (result.noticeCode === "ROOT_NOT_IN_SNAPSHOT") {
        setNotice("ROOT_NOT_IN_SNAPSHOT");
      } else if (result.noticeCode === "TABLE_VIEW_REQUIRES_TABLE_ROOT") {
        setNotice("TABLE_VIEW_REQUIRES_TABLE_ROOT");
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
      onNodesChange(data.nodes);
      onSelectedNodeChange(data.rootId);
      onRouteChange(resolvedRoute);
    } catch (cause: unknown) {
      if (isAbortError(cause) || requestSequenceRef.current !== sequence) return;
      setError(getErrorMessage(cause, tRef.current("messages.loadErrorDescription")));
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
        setQueryError(t("search.noResults", { name: nodeName }));
      } else {
        const resolution = resolveLineageSearchMatches(nodeName, matches);
        if (resolution.directMatch) {
          await openCandidate(resolution.directMatch);
        } else {
          setCandidates(resolution.candidates);
        }
      }
    } catch (cause: unknown) {
      if (!isAbortError(cause)) setQueryError(getErrorMessage(cause, t("search.error")));
    } finally {
      setQuerying(false);
    }
  };

  const selectCandidate = (candidate: LineageNode) => {
    setCandidates([]);
    setQuery(lineageSearchQueryForCandidate(candidate));
    void openCandidate(candidate);
  };

  if (loading && !graph) return <LoadingState title={t("messages.loadingTitle")} desc={t("messages.loadingDescription")} />;
  if (error && !graph) return <ErrorState title={t("messages.loadError")} desc={error} onRetry={() => void loadGraph(route)} />;
  if (!graph) {
    const emptyDescription = bootstrap?.status === "no_active_snapshot"
      ? t("messages.noActiveSnapshot")
      : bootstrap?.status === "empty_snapshot"
        ? t("messages.emptySnapshot")
        : t("messages.noSnapshotData");
    return <ErrorState title={t("messages.noSnapshotTitle")} desc={`${emptyDescription}${t("messages.publishSnapshot")}`} onRetry={() => void loadGraph(route)} />;
  }

  const selected = graph.nodes.find((node) => node.id === selectedNodeId)
    || graph.nodes.find((node) => node.id === graph.rootId);
  const related = graph.edges.filter((edge) => edge.sourceId === selected?.id || edge.targetId === selected?.id);
  const upstreamCount = graph.edges.filter((edge) => edge.targetId === selected?.id).length;
  const downstreamCount = graph.edges.filter((edge) => edge.sourceId === selected?.id).length;
  const root = graph.nodes.find((node) => node.id === graph.rootId);
  const sourceLabel = bootstrap?.mode === "persistent" ? t("source.persistent") : t("source.demo");

  return (
    <div className="lineage-page">
      <div className="page-head">
        <div>
          <div className="page-title"><span className="pt-code">{t("page.code")}</span>{t("page.title")}</div>
          <div className="page-sub">{t("page.subtitle", { snapshotId: graph.snapshot.snapshotId })}</div>
        </div>
        <div className="lineage-actions">
          <label>{t("filters.view")}<Select<string> aria-label={t("filters.viewAria")} className="sel" disabled={loading || querying} items={[{ label: t("filters.tableView"), value: "table" }, { label: t("filters.detailView"), value: "detail" }]} value={pendingFilters.view || null} onValueChange={(value) => setPendingFilters((current) => ({ ...current, view: normalizeView(value || "table") }))} /></label>
          <label>{t("filters.direction")}<Select<string> aria-label={t("filters.directionAria")} className="sel" disabled={loading || querying} items={[{ label: t("filters.bothDirections"), value: "both" }, { label: t("filters.upstreamOnly"), value: "upstream" }, { label: t("filters.downstreamOnly"), value: "downstream" }]} value={pendingFilters.direction || null} onValueChange={(value) => setPendingFilters((current) => ({ ...current, direction: normalizeDirection(value || "both") }))} /></label>
          <label>{t("filters.depth")}<Select<string> aria-label={t("filters.depthAria")} className="sel" disabled={loading || querying} items={[1, 2, 3, 4, 5].map((value) => ({ label: t("filters.depthOption", { count: value }), value: String(value) }))} value={String(pendingFilters.depth)} onValueChange={(value) => setPendingFilters((current) => ({ ...current, depth: Number(value || 1) }))} /></label>
          <Button className="btn" variant="secondary" type="button" onClick={() => void loadGraph({ ...route, ...pendingFilters })} disabled={loading}><Icon name="refresh" size={15} />{loading ? t("filters.loading") : t("filters.refresh")}</Button>
        </div>
      </div>
      <form className="lineage-query" onSubmit={(event) => void submitQuery(event)}>
        <label htmlFor="lineage-node-name">{t("search.label")}</label>
        <Input id="lineage-node-name" aria-label={t("search.ariaLabel")} value={query} onChange={(event) => { setQuery(event.target.value); setQueryError(""); setCandidates([]); }} placeholder={t("search.placeholder")} disabled={querying} aria-describedby="lineage-query-status" />
        <Button className="btn primary" variant="primary" type="submit" disabled={querying}>{querying ? t("search.querying") : t("search.query")}</Button>
        <Button className="btn" variant="secondary" type="button" onClick={() => { setQuery(""); setQueryError(""); setCandidates([]); }} disabled={!query || querying}>{t("search.clear")}</Button>
        <span id="lineage-query-status" className="lineage-query-status" role={queryError ? "alert" : "status"} aria-live="polite">{queryError}</span>
      </form>
      {candidates.length ? (
        <div className="lineage-candidates" role="list" aria-label={t("search.candidates")}>
          {candidates.map((candidate) => {
            const isTable = candidate.kind === "table";
            const candidateName = isTable
              ? candidate.name.trim().slice(candidate.name.trim().lastIndexOf(".") + 1)
              : candidate.name;
            const namespace = String(candidate.namespace || "").trim() || t("search.namespaceMissing");
            return (
              <button
                className="lineage-candidate"
                type="button"
                role="listitem"
                key={candidate.id}
                onClick={() => selectCandidate(candidate)}
              >
                <b>{t(isTable ? "search.tableName" : "search.jobName")}: {candidateName}</b>
                <span>{t(isTable ? "search.tableKind" : "search.jobKind")}</span>
                <small>
                  {t(isTable ? "search.schemaNamespace" : "search.namespace", { namespace })}
                  {candidate.displayName && candidate.displayName !== candidate.name
                    ? ` · ${candidate.displayName}`
                    : ""}
                </small>
              </button>
            );
          })}
        </div>
      ) : null}
      {notice ? <p className="lineage-notice" role="status">{t(notice === "ROOT_NOT_IN_SNAPSHOT" ? "messages.rootNotInSnapshot" : "messages.tableRootRequired")}</p> : null}
      <ActionErrorBanner title={t("messages.errorTitle")} message={error} />
      {graph.truncated ? <p className="lineage-notice" role="status">{t("messages.truncated", { count: MAX_NODES })}</p> : null}
      {graph.diagnostics?.length ? <details className="lineage-diagnostics"><summary>{t("messages.diagnostics", { count: graph.diagnostics.length })}</summary><ul>{graph.diagnostics.map((item, index) => { const diagnostic = diagnosticValue(item); return <li key={diagnosticKey(item, index)}><b>{diagnostic.code || "DIAGNOSTIC"}</b>{diagnostic.message || String(item)}</li>; })}</ul></details> : null}
      <div className="lineage-layout">
        <section className="lineage-card" aria-busy={loading}>
          <div className="lineage-card-head"><span>{sourceLabel}：{root?.name} · {t(route.view === "table" ? "filters.tableView" : "filters.detailView")}</span><span className="tag tag-info">{t("graph.nodesAndEdges", { nodes: graph.nodes.length, edges: graph.edges.length })}</span></div>
          <LineageCanvas graph={graph} selectedNodeId={selectedNodeId} focusRequest={focusRequest} onFocusRequestHandled={onFocusRequestHandled} onSelect={onSelectedNodeChange} />
        </section>
        <aside className="lineage-detail">
          <div className="lineage-card-head"><span>{t("graph.nodeDetails")}</span><span className="tag tag-neutral">{selected?.kind === "table" ? t("graph.tableKind") : selected?.kind === "task" ? t("graph.taskKind") : selected?.kind}</span></div>
          {selected ? <div className="lineage-detail-content">
            <h2>{selected.name}</h2>
            <p>{selected.displayName}</p>
            <dl>
              <dt>{t("graph.stableId")}</dt><dd className="mono">{selected.id}</dd>
              <dt>{t("graph.namespace")}</dt><dd>{selected.namespace}</dd>
              <dt>{t("graph.upstream")}</dt><dd>{upstreamCount}</dd>
              <dt>{t("graph.downstream")}</dt><dd>{downstreamCount}</dd>
              <dt>{t("graph.dwfBoundary")}</dt><dd>{selected.attributes?.["dwfBoundary"] || ["dwf", "dws_dwf"].includes(selected.namespace) ? t("graph.yes") : t("graph.no")}</dd>
              <dt>{t("graph.snapshotTime")}</dt><dd>{graph.snapshot.generatedAt}</dd>
            </dl>
            <h3>{t("graph.relationshipEvidence")}</h3>
            <div className="lineage-evidence-list">{related.map((edge) => <div className="lineage-evidence" key={edge.id}><b>{edge.kind}</b><span>{edge.evidence.type} · {edge.confidence}</span>{edge.viaJobs?.length ? <span>{t("graph.throughJobs", { jobs: edge.viaJobs.join(", ") })}</span> : null}<small>{edge.evidence.description}</small></div>)}</div>
          </div> : null}
        </aside>
      </div>
    </div>
  );
}
