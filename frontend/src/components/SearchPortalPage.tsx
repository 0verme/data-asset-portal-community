// Copyright 2025 Jearhe
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "./ui.tsx";
import { Button, EmptyState, ErrorState, Input, LoadingState } from "../ui/index.ts";
import { ActionErrorBanner } from "./common/ActionErrorBanner.tsx";
import { getPortalStats, type PortalStatItem } from "../api/portal.ts";
import { getHotKeywords } from "../api/hotKeywords.ts";
import {
  getAiAskAvailability,
  type AiAskCandidate,
  type AiAskResponse,
  type AiAskStatisticalResult,
} from "../api/aiAsk.ts";
import {
  AiAskExecutionContractError,
  askAiWithExecution,
  type AiAskExecutionEvent,
  type AiAskExecutionStatus,
} from "../api/aiAskExecution.ts";
import { receivedTerminalEvent } from "../api/aiAskExecutionSummary.ts";
import { AiAskExecutionPanel } from "./AiAskExecutionPanel.tsx";
import { selectVerifiedCitedCandidates } from "./aiAskSources.ts";
import {
  resolvePortalScopeLabel,
  resolvePortalStatLabel,
  resolveSearchGroupLabel,
} from "./portalSearchLabels.ts";
import {
  getRagRecommendations,
  unifiedSearch,
  type RagRecommendation,
  type RagRecommendationsResponse,
  type SearchResult,
  type SearchResultGroup,
  type SearchResultItem,
} from "../api/search.ts";
import {
  DEFAULT_PORTAL_SCOPE,
  PORTAL_SCOPE_CONFIGS,
  filterPortalHotKeywordsByModules,
  filterPortalScopesByModules,
  isMonospaceHotKeyword,
  readPortalSearchParams,
  type PortalHotKeyword,
} from "../config/portalSearch.ts";

type SearchNavigationTarget = SearchResultItem | SearchResultGroup;
type PortalResultTab = "search" | "ai";

export interface SearchPortalPageProps {
  onNavigate?:
    | ((target: SearchNavigationTarget, term: string) => void)
    | undefined;
  availableModules?: readonly string[] | undefined;
  publicAccessReady?: boolean | undefined;
}

const MAX_MATCHED_FIELD_LABELS = 2;

function formatMatchedField(item: SearchResultItem, matchedPrefix: string): string {
  const parts = (item.matchedFields || [])
    .filter((match) => match?.label && match?.value)
    .slice(0, MAX_MATCHED_FIELD_LABELS)
    .map((match) => `${match.label} ${match.value}`);
  return parts.length ? `${matchedPrefix}${parts.join(" / ")}` : "";
}

function recommendationKey(item: RagRecommendation): string {
  return item.assetType === "field" && item.fieldId
    ? `field:${item.assetId}:${item.fieldId}`
    : `table:${item.assetId}`;
}

function recommendationTarget(item: RagRecommendation): SearchResultItem {
  const tableName = item.relatedTable?.name || item.name;
  return {
    id: recommendationKey(item),
    title: item.displayName || item.name,
    subtitle: item.description,
    meta: [item.relatedTable?.name, item.domain, item.layer].filter(Boolean).join(" / "),
    module: "dwm",
    ref: tableName,
    type: "asset",
    category: "资产",
    assetId: item.assetId,
    matchedFields: item.evidence.map((value) => ({ label: "匹配依据", value })),
  };
}

function askCandidateKey(item: AiAskCandidate): string {
  return item.fieldId ? `field:${item.assetId}:${item.fieldId}` : `table:${item.assetId}`;
}

function askCandidateTarget(item: AiAskCandidate): SearchResultItem {
  const isField = item.assetType === "field";
  return {
    id: askCandidateKey(item),
    title: isField ? item.fieldDisplayName || item.fieldName || "" : item.tableDisplayName || item.tableName,
    subtitle: isField ? item.fieldDescription || "" : item.tableDescription,
    meta: [item.tableName, item.domain, item.layer].filter(Boolean).join(" / "),
    module: "dwm",
    ref: item.tableName,
    type: "asset",
    category: isField ? "字段" : "数据表",
    assetId: item.assetId,
    matchedFields: [{ label: "匹配依据", value: item.matchReason }],
  };
}

interface RagRecommendationsSectionProps {
  loading: boolean;
  failed: boolean;
  response: RagRecommendationsResponse | null;
  searchedAssetIds: ReadonlySet<number>;
  term: string;
  onNavigate: ((target: SearchNavigationTarget, term: string) => void) | undefined;
}

function RagRecommendationsSection({
  loading,
  failed,
  response,
  searchedAssetIds,
  term,
  onNavigate,
}: RagRecommendationsSectionProps) {
  const { t } = useTranslation("search");
  if (response?.status === "disabled") return null;

  if (
    failed ||
    response?.status === "unavailable" ||
    (response?.status === "degraded" && response.recommendations.length === 0)
  ) {
    return (
      <div className="sp-rag-unavailable" role="status">
        {t("recommendations.unavailable")}
      </div>
    );
  }

  if (loading && !response) {
    return (
      <div className="sp-rag-loading" role="status" aria-label={t("recommendations.loadingAriaLabel")}>
        <span className="sp-rag-skeleton sp-rag-skeleton-title" />
        <span className="sp-rag-skeleton" />
        <span className="sp-rag-skeleton" />
      </div>
    );
  }

  if (!response) return null;
  const seen = new Set<string>();
  const recommendations = response.recommendations.filter((item) => {
    const key = recommendationKey(item);
    if (seen.has(key) || searchedAssetIds.has(item.assetId)) return false;
    seen.add(key);
    return true;
  });
  if (!recommendations.length) return null;

  return (
    <section className="sp-rag-group" aria-label={t("recommendations.ariaLabel")}>
      <div className="sp-group-head">
        <span className="sp-group-title">{t("recommendations.title")}</span>
        <span className="sp-group-count">{t("recommendations.count", { count: recommendations.length })}</span>
      </div>
      {response.status === "degraded" ? (
        <div className="sp-rag-unavailable" role="status">
          {t("recommendations.degraded")}
        </div>
      ) : null}
      <div className="sp-rag-list">
        {recommendations.map((item) => {
          const target = recommendationTarget(item);
          return (
            <Button
              key={recommendationKey(item)}
              variant="tertiary"
              type="button"
              className="sp-rag-hit"
              onClick={() => onNavigate?.(target, term)}
            >
              <span className="sp-rag-hit-main">
                <span className="sp-rag-hit-heading">
                  <span className="sp-rag-hit-title">{item.displayName || item.name}</span>
                  <span className="sp-rag-hit-type">{t(item.assetType === "field" ? "recommendations.field" : "recommendations.table")}</span>
                </span>
                {item.displayName && item.displayName !== item.name ? (
                  <span className="sp-rag-hit-name">{item.name}</span>
                ) : null}
                {item.description ? <span className="sp-rag-hit-desc">{item.description}</span> : null}
                {item.relatedTable ? (
                  <span className="sp-rag-hit-table">{t("recommendations.relatedTable", { table: item.relatedTable.displayName || item.relatedTable.name })}</span>
                ) : null}
                {item.evidence.length ? (
                  <span className="sp-rag-hit-evidence">{t("recommendations.evidence", { evidence: item.evidence.join(t("results.listSeparator")) })}</span>
                ) : null}
              </span>
              <span className="sp-hit-go" aria-hidden="true">
                <Icon name="arrow" size={14} />
              </span>
            </Button>
          );
        })}
      </div>
    </section>
  );
}

function safeCatalogLink(value: string | null | undefined): string | null {
  return value && value.startsWith("/") && !value.startsWith("//") && !value.includes("\\")
    ? value
    : null;
}

function AiAskStatisticalCard({ result }: { result: AiAskStatisticalResult }) {
  const { t } = useTranslation("aiAsk");
  const link = safeCatalogLink(result.sourceLink);
  const isReportCount = result.metric === "report_count";
  const assetType = t(isReportCount ? "statistics.reportAssets" : "statistics.tables");
  const unit = t(isReportCount ? "statistics.reportAssetUnit" : "statistics.tableUnit", { count: result.value });
  const sourceLabel = t(isReportCount ? "statistics.reportCatalog" : "statistics.assetCatalog");
  const linkLabel = t(isReportCount ? "statistics.viewAllReports" : "statistics.viewAllFilteredAssets");
  const filterSummary = result.filters.map((filter) =>
    `${filter.displayName || filter.dimension}=${filter.value}`,
  ).join(t("statistics.filterSeparator"));
  return (
    <section className="sp-ai-statistic" aria-label={t("statistics.ariaLabel")}>
      <div className="sp-ai-statistic-head">
        <strong>{result.value} {unit}</strong>
        <span>{t(result.complete ? "statistics.complete" : "statistics.partial")}</span>
      </div>
      <p>{t("statistics.assetType", { type: assetType })}</p>
      <p>{t("statistics.dataSource", { source: sourceLabel })}</p>
      <p>{t("statistics.scope", { filters: filterSummary || t("statistics.allCatalog") })}</p>
      {link ? <a className="sp-ai-statistic-link" href={link}>{linkLabel}</a> : null}
    </section>
  );
}
type AiAskUiError =
  | { kind: "cancelled" }
  | { kind: "unavailable" }
  | { kind: "contract"; message: string }
  | { kind: "message"; message: string };

interface AiAskSectionProps {
  query: string;
  loading: boolean;
  error: AiAskUiError | null;
  response: AiAskResponse | null;
  executionEvents: AiAskExecutionEvent[];
  executionStatus: AiAskExecutionStatus | null;
  executionRunId: number;
  onRetry: () => void;
  onCancel: () => void;
  onNavigate: ((target: SearchNavigationTarget, term: string) => void) | undefined;
}

function AiAskSection({
  query,
  loading,
  error,
  response,
  executionEvents,
  executionStatus,
  executionRunId,
  onRetry,
  onCancel,
  onNavigate,
}: AiAskSectionProps) {
  const { t } = useTranslation("aiAsk");
  if (!query) return null;
  const errorMessage = error?.kind === "cancelled"
    ? t("failures.cancelled")
    : error?.kind === "unavailable"
      ? t("failures.unavailable")
      : error?.kind === "contract"
        ? t("failures.contractError", { message: error.message })
        : error?.kind === "message" ? error.message : "";
  const responseFailure = !response?.metadataCount && response?.status === "retrieval_unavailable"
    ? response.reasonCode === "retrieval_timeout"
      ? t("failures.retrievalTimeout")
      : t("failures.retrievalUnavailable")
    : !response?.metadataCount && response?.status === "generation_unavailable"
      ? response.reasonCode === "llm_daily_quota_exceeded"
        ? t("failures.quotaExceeded")
        : response.reasonCode === "llm_quota_unavailable"
          ? t("failures.quotaUnavailable")
          : response.reasonCode === "llm_timeout"
            ? t("failures.generationTimeout")
            : t("failures.generationUnavailable")
      : !response?.metadataCount && response?.status === "ambiguous_scope"
        ? response.answer || t("failures.ambiguousScope")
        : !response?.metadataCount && response?.status === "metadata_count_unavailable"
          ? response.answer || t("failures.metadataCountUnavailable")
          : "";
  const failureMessage = errorMessage || responseFailure;
  const sourceCandidates = response
    ? selectVerifiedCitedCandidates(response.candidates, response.citations)
    : [];
  return (
    <section className="sp-ai-group" aria-label={t("section.resultAriaLabel")}>
      <div className="sp-group-head">
        <span className="sp-group-title">{t("section.answerTitle")}</span>
        <span className="sp-group-count">{import.meta.env.VITE_API_MODE === "mock"
          ? t("section.mockMode") : t("section.remoteMode")}</span>
      </div>
      {loading ? null : failureMessage ? (
        <div className="sp-ai-state sp-ai-error" role="alert">
          <span>{errorMessage
            ? error?.kind === "cancelled" ? errorMessage : t("section.requestFailed", { message: errorMessage })
            : failureMessage}</span>
          {executionStatus !== "cancelled" ? (
            <Button variant="tertiary" type="button" className="sp-ai-retry" onClick={onRetry}>
              {t("section.retry")}
            </Button>
          ) : null}
        </div>
      ) : null}
      <AiAskExecutionPanel
        events={executionEvents}
        status={executionStatus}
        runId={executionRunId}
        loading={loading}
        citationCount={response?.citations.length ?? 0}
        query={query}
        onCancel={onCancel}
      />
      <div className="sp-ai-question">{t("section.question", { query })}</div>
      {loading || failureMessage ? null : response ? (
        <>
          {response.retrievalStatus === "degraded" ? (
            <div className="sp-ai-state" role="status">{t("section.retrievalDegraded")}</div>
          ) : null}
          {response.statisticalResult ? <AiAskStatisticalCard result={response.statisticalResult} /> : null}
          {response.status === "insufficient_evidence" ? (
            <div className="sp-ai-state" role="status">{response.answer}</div>
          ) : response.status === "partial_answer" ? (
            <>
              <div className="sp-ai-state" role="status">
                {t(response.resultsTruncated ? "section.partialAnswerTruncated" : "section.partialAnswerRelated")}
              </div>
              <div className="sp-ai-summary" aria-label={t("section.partialAnswerAriaLabel")}>{response.answer}</div>
            </>
          ) : !response.metadataCount && response.answer.trim() ? (
            <div className="sp-ai-summary" aria-label={t("section.answerSummaryAriaLabel")}>{response.answer}</div>
          ) : null}
          {sourceCandidates.length ? (
            <section className="sp-ai-candidates" aria-label={t("section.sourcesAriaLabel")}>
              <div className="sp-group-head">
                <span className="sp-group-title">{t("section.sourcesTitle")}</span>
                <span className="sp-group-count">{t("section.sourceCount", { count: sourceCandidates.length })}</span>
              </div>
              <div className="sp-ai-list">
                {sourceCandidates.map((item) => {
                  const isField = item.assetType === "field";
                  const target = askCandidateTarget(item);
                  return (
                    <Button
                      key={askCandidateKey(item)}
                      variant="tertiary"
                      type="button"
                      className="sp-ai-candidate"
                      aria-label={t("section.candidateDetailAriaLabel", { type: t(isField ? "section.field" : "section.table"), name: isField ? item.fieldName : item.tableName })}
                      onClick={() => onNavigate?.(target, query)}
                    >
                      <span className="sp-ai-candidate-main">
                        <span className="sp-ai-candidate-heading">
                          <span className="sp-ai-candidate-title">{isField ? item.fieldDisplayName || item.fieldName : item.tableDisplayName || item.tableName}</span>
                          <span className="sp-ai-candidate-type">{t(isField ? "section.field" : "section.table")}</span>
                          <span className={`sp-ai-candidate-relevance ${item.relevance === "direct" ? "direct" : "related"}`}>
                            {t(item.relevance === "direct" ? "section.directRelevance" : "section.relatedLead")}
                          </span>
                          <span className="sp-ai-candidate-verified">{t("section.verifiedCitation")}</span>
                        </span>
                        <span className="sp-ai-candidate-name mono">{isField ? item.fieldName : item.tableName}</span>
                        {isField ? <span className="sp-ai-candidate-meta">{t("section.owningTable", { displayName: item.tableDisplayName || item.tableName, name: item.tableName })}</span> : null}
                        {(isField ? item.fieldDescription : item.tableDescription) ? (
                          <span className="sp-ai-candidate-desc">{t("section.businessMeaning", { value: isField ? item.fieldDescription : item.tableDescription })}</span>
                        ) : null}
                        <span className="sp-ai-candidate-meta">{t("section.subjectAreaLayer", { value: [item.domain, item.layer].filter(Boolean).join(" / ") || t("section.notRegistered") })}</span>
                        <span className="sp-ai-candidate-evidence">{t("section.evidenceSource", { reason: item.matchReason })}</span>
                      </span>
                      <span className="sp-hit-go" aria-hidden="true"><Icon name="arrow" size={14} /></span>
                    </Button>
                  );
                })}
              </div>
            </section>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

export function SearchPortalPage({
  onNavigate,
  availableModules = [],
  publicAccessReady = true,
}: SearchPortalPageProps) {
  const { t } = useTranslation("search");
  const { t: tAi } = useTranslation("aiAsk");
  const scopeOptions = useMemo(
    () => filterPortalScopesByModules(availableModules),
    [availableModules],
  );
  const validScopeKeys = useMemo(
    () => new Set(scopeOptions.map((item) => item.key)),
    [scopeOptions],
  );
  const initialSearchLocationRef = useRef(typeof window === "undefined" ? "" : window.location.search || "");
  const initialScopeKeys = useMemo(() => new Set(PORTAL_SCOPE_CONFIGS.map((item) => item.key)), []);
  const initialSearchRef = useRef(readPortalSearchParams(initialScopeKeys, initialSearchLocationRef.current));
  const initialSearchBootstrapPendingRef = useRef(true);
  const [query, setQuery] = useState(initialSearchRef.current.query);
  const [scope, setScope] = useState(initialSearchRef.current.scope);
  const [hotKeywords, setHotKeywords] = useState<PortalHotKeyword[]>([]);
  const [stats, setStats] = useState<PortalStatItem[]>([]);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState("");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [recommendations, setRecommendations] = useState<RagRecommendationsResponse | null>(null);
  const [recommendationsLoading, setRecommendationsLoading] = useState(false);
  const [recommendationsError, setRecommendationsError] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [searchedTerm, setSearchedTerm] = useState("");
  const [activeResultTab, setActiveResultTab] = useState<PortalResultTab>("search");
  const [resultScrollRequest, setResultScrollRequest] = useState(0);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiQuery, setAiQuery] = useState("");
  const [aiResponse, setAiResponse] = useState<AiAskResponse | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<AiAskUiError | null>(null);
  const [aiExecutionEvents, setAiExecutionEvents] = useState<AiAskExecutionEvent[]>([]);
  const [aiExecutionStatus, setAiExecutionStatus] = useState<AiAskExecutionStatus | null>(null);
  const [aiExecutionRunId, setAiExecutionRunId] = useState(0);
  const hotTags = useMemo(
    () => filterPortalHotKeywordsByModules(hotKeywords, availableModules),
    [hotKeywords, availableModules],
  );

  const inputRef = useRef<HTMLInputElement | null>(null);
  const resultContainerRef = useRef<HTMLDivElement | null>(null);
  const requestSeq = useRef(0);
  const aiRequestSeq = useRef(0);
  const aiAbortController = useRef<AbortController | null>(null);

  useEffect(() => () => {
    aiRequestSeq.current += 1;
    aiAbortController.current?.abort();
    aiAbortController.current = null;
  }, []);

  useEffect(() => {
    if (!resultScrollRequest) return;
    const frame = window.requestAnimationFrame(() => {
      const results = resultContainerRef.current;
      const scrollContainer = results?.closest<HTMLElement>(".main");
      if (results && scrollContainer) {
        const top = results.getBoundingClientRect().top - scrollContainer.getBoundingClientRect().top + scrollContainer.scrollTop - 14;
        scrollContainer.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
        return;
      }
      results?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [resultScrollRequest]);

  const requestResultScroll = (): void => {
    setResultScrollRequest((current) => current + 1);
  };

  const syncSearchUrl = (
    nextQuery: string,
    nextScope = DEFAULT_PORTAL_SCOPE,
  ): void => {
    if (typeof window === "undefined") return;

    const searchParams = new URLSearchParams(window.location.search || "");
    const keyword = String(nextQuery ?? "").trim();

    if (keyword) {
      searchParams.set("q", keyword);
      if (nextScope !== DEFAULT_PORTAL_SCOPE) {
        searchParams.set("scope", nextScope);
      } else {
        searchParams.delete("scope");
      }
    } else {
      searchParams.delete("q");
      if (nextScope !== DEFAULT_PORTAL_SCOPE) {
        searchParams.set("scope", nextScope);
      } else {
        searchParams.delete("scope");
      }
    }

    const nextUrl = `${window.location.pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`;
    const currentUrl = `${window.location.pathname}${window.location.search}`;
    if (nextUrl !== currentUrl) {
      window.history.replaceState({}, "", nextUrl);
    }
  };

  const resetSearchState = (nextScope = scope): void => {
    initialSearchBootstrapPendingRef.current = false;
    const preservedScope = validScopeKeys.has(nextScope)
      ? nextScope
      : DEFAULT_PORTAL_SCOPE;
    requestSeq.current += 1;
    aiRequestSeq.current += 1;
    aiAbortController.current?.abort();
    aiAbortController.current = null;
    setQuery("");
    setScope(preservedScope);
    setResult(null);
    setRecommendations(null);
    setRecommendationsLoading(false);
    setRecommendationsError(false);
    setSearchLoading(false);
    setSearchError("");
    setSearchedTerm("");
    setActiveResultTab("search");
    setAiQuery("");
    setAiResponse(null);
    setAiLoading(false);
    setAiError(null);
    setAiExecutionEvents([]);
    setAiExecutionStatus(null);
    syncSearchUrl("", preservedScope);
  };

  const clearSearch = (nextScope = scope) => {
    resetSearchState(nextScope);
    inputRef.current?.focus();
  };

  const runSearch = (
    rawQuery: string,
    rawScope = DEFAULT_PORTAL_SCOPE,
  ): void => {
    const keyword = String(rawQuery ?? "").trim();
    const nextScope = validScopeKeys.has(rawScope)
      ? rawScope
      : DEFAULT_PORTAL_SCOPE;

    if (!publicAccessReady) return;
    if (!keyword) {
      clearSearch(nextScope);
      return;
    }
    const seq = ++requestSeq.current;
    setActiveResultTab("search");
    requestResultScroll();
    if (aiQuery !== keyword) {
      aiRequestSeq.current += 1;
      aiAbortController.current?.abort();
      aiAbortController.current = null;
      setAiQuery("");
      setAiResponse(null);
      setAiLoading(false);
      setAiError(null);
      setAiExecutionEvents([]);
      setAiExecutionStatus(null);
    }
    setQuery(keyword);
    setScope(nextScope);
    setResult(null);
    setRecommendations(null);
    setRecommendationsLoading(true);
    setRecommendationsError(false);
    setSearchLoading(true);
    setSearchError("");
    setSearchedTerm(keyword);
    syncSearchUrl(keyword, nextScope);

    unifiedSearch(keyword, nextScope)
      .then((data) => {
        if (seq !== requestSeq.current) return;
        setResult(data);
        setSearchLoading(false);
        requestResultScroll();
      })
      .catch((error: unknown) => {
        if (seq !== requestSeq.current) return;
        setSearchError(
          error instanceof Error ? error.message : t("results.searchFailedFallback"),
        );
        setResult(null);
        setSearchLoading(false);
        requestResultScroll();
      });

    // Recommendations are independent: a slow or failed optional provider never
    // delays or replaces the deterministic keyword result.
    getRagRecommendations(keyword)
      .then((data) => {
        if (seq !== requestSeq.current) return;
        setRecommendations(data);
        setRecommendationsLoading(false);
      })
      .catch(() => {
        if (seq !== requestSeq.current) return;
        setRecommendations(null);
        setRecommendationsError(true);
        setRecommendationsLoading(false);
      });
  };

  const runAiAsk = (rawQuery = query): void => {
    const question = String(rawQuery ?? "").trim();
    if (!publicAccessReady || !aiEnabled || !question) return;
    setActiveResultTab("ai");
    requestResultScroll();
    const seq = ++aiRequestSeq.current;
    aiAbortController.current?.abort();
    const controller = new AbortController();
    aiAbortController.current = controller;
    setQuery(question);
    setAiQuery(question);
    setAiResponse(null);
    setAiLoading(true);
    setAiError(null);
    setAiExecutionEvents([]);
    setAiExecutionRunId((current) => current + 1);
    setAiExecutionStatus("running");
    if (searchedTerm !== question) {
      requestSeq.current += 1;
      setResult(null);
      setRecommendations(null);
      setRecommendationsLoading(false);
      setRecommendationsError(false);
      setSearchLoading(false);
      setSearchError("");
      setSearchedTerm("");
    }
    syncSearchUrl(question, scope);

    askAiWithExecution(
      question,
      (event) => {
        if (seq !== aiRequestSeq.current) return;
        setAiExecutionEvents((current) => [...current, event]);
        if (event.event === "answer") {
          const response = event.data?.["response"];
          if (response && typeof response === "object") setAiResponse(response as AiAskResponse);
        } else if (event.event === "done") {
          const finalStatus = event.data?.["status"];
          if (finalStatus === "completed" || finalStatus === "failed" || finalStatus === "cancelled") {
            setAiExecutionStatus(finalStatus);
          }
        }
      },
      "all",
      10,
      controller.signal,
    )
      .then(({ response, status }) => {
        if (seq !== aiRequestSeq.current) return;
        aiAbortController.current = null;
        setAiResponse(response);
        setAiLoading(false);
        setAiExecutionStatus(status);
        requestResultScroll();
      })
      .catch((error: unknown) => {
        if (seq !== aiRequestSeq.current) return;
        aiAbortController.current = null;
        setAiLoading(false);
        if (controller.signal.aborted) {
          setAiError({ kind: "cancelled" });
          setAiExecutionStatus("cancelled");
          return;
        }
        if (error instanceof AiAskExecutionContractError) {
          setAiError({ kind: "contract", message: error.message });
        } else if (error instanceof Error) {
          setAiError({ kind: "message", message: error.message });
        } else {
          setAiError({ kind: "unavailable" });
        }
        setAiExecutionStatus("failed");
        requestResultScroll();
      });
  };

  const cancelAiAsk = (): void => {
    if (!aiAbortController.current) return;
    aiRequestSeq.current += 1;
    aiAbortController.current.abort();
    aiAbortController.current = null;
    setAiLoading(false);
    setAiError({ kind: "cancelled" });
    setAiExecutionStatus("cancelled");
    requestResultScroll();
  };

  useEffect(() => {
    let cancelled = false;
    if (!publicAccessReady) {
      setAiEnabled(false);
      return () => {
        cancelled = true;
      };
    }
    getAiAskAvailability()
      .then((status) => {
        if (cancelled) return;
        setAiEnabled(status.enabled);
        if (!status.enabled) {
          setActiveResultTab("search");
          aiRequestSeq.current += 1;
          aiAbortController.current?.abort();
          aiAbortController.current = null;
          setAiQuery("");
          setAiResponse(null);
          setAiLoading(false);
          setAiError(null);
          setAiExecutionEvents([]);
          setAiExecutionStatus(null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAiEnabled(false);
          setActiveResultTab("search");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [publicAccessReady]);

  useEffect(() => {
    let cancelled = false;
    if (!publicAccessReady) {
      setStatsLoading(true);
      return () => {
        cancelled = true;
      };
    }
    setStatsLoading(true);
    setStatsError("");

    getPortalStats()
      .then((rows) => {
        if (cancelled) return;
        setStats(rows);
        setStatsLoading(false);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setStatsError(
          error instanceof Error ? error.message : t("statistics.loadError"),
        );
        setStatsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [availableModules, publicAccessReady]);

  useEffect(() => {
    let cancelled = false;
    if (!publicAccessReady) {
      setHotKeywords([]);
      return () => {
        cancelled = true;
      };
    }

    getHotKeywords()
      .then((items) => {
        if (!cancelled) setHotKeywords(items);
      })
      .catch(() => {
        // Recommendations are optional: a failed request must not block search.
        if (!cancelled) setHotKeywords([]);
      });

    return () => {
      cancelled = true;
    };
  }, [publicAccessReady]);

  useEffect(() => {
    if (!publicAccessReady) return;
    const requestedScope = new URLSearchParams(initialSearchLocationRef.current).get("scope");
    if (requestedScope && !validScopeKeys.has(requestedScope) && availableModules.length === 0) {
      // The app shell may mount before its visible-module list is ready. Keep a
      // scoped deep link intact until that list can validate it instead of
      // silently rewriting it to the default scope.
      return;
    }
    const initialSearch = readPortalSearchParams(validScopeKeys, initialSearchLocationRef.current);
    const nextScope = validScopeKeys.has(scope) ? scope : initialSearch.scope;
    const initialQuery = initialSearchBootstrapPendingRef.current ? initialSearch.query : "";
    initialSearchBootstrapPendingRef.current = false;
    const activeQuery = String(searchedTerm || query || initialQuery).trim();

    if (nextScope !== scope) {
      setScope(nextScope);
    }

    if (!activeQuery) {
      syncSearchUrl("", nextScope);
      return;
    }

    runSearch(activeQuery, nextScope);
    // This synchronization intentionally runs only when the available module set or
    // public access readiness changes. The called search updates state, so adding its
    // render-scoped dependencies would loop.
  }, [availableModules, publicAccessReady]);

  const doSearch = (): void => runSearch(query, scope);

  const pickHot = (term: string): void => {
    setQuery(term);
    runSearch(term, scope);
  };

  const pickScope = (nextScope: string): void => {
    setScope(nextScope);
    const activeQuery = String(query || searchedTerm || "").trim();
    if (activeQuery) {
      runSearch(activeQuery, nextScope);
      return;
    }
    syncSearchUrl("", nextScope);
  };

  const handleNavigate = (
    itemOrGroup: SearchNavigationTarget,
    term: string,
  ): void => {
    onNavigate?.(itemOrGroup, term);
  };

  const hasResult = result !== null && !searchLoading && !searchError;
  const groups = hasResult && result ? result.groups : [];
  const hasSubmittedQuery = Boolean(searchedTerm || aiQuery);
  const aiResponseFailed = !aiResponse?.metadataCount && (
    aiResponse?.status === "retrieval_unavailable"
    || aiResponse?.status === "generation_unavailable"
    || aiResponse?.status === "ambiguous_scope"
    || aiResponse?.status === "metadata_count_unavailable"
  );
  const searchTabStatus = searchLoading ? t("status.searching") : searchError ? t("status.searchFailed") : searchedTerm ? t("status.searched") : t("status.notSearched");
  const aiProgressInterrupted = aiError !== null
    && aiExecutionStatus !== "cancelled"
    && !receivedTerminalEvent(aiExecutionEvents);
  const aiTabStatus = aiLoading ? tAi("status.asking") : aiProgressInterrupted ? tAi("status.interrupted") : aiError || aiResponseFailed ? tAi("status.failed") : aiResponse ? tAi("status.completed") : tAi("status.notAsked");
  const searchedAssetIds = new Set(
    groups
      .flatMap((group) => group.items.map((item) => item.assetId))
      .filter((assetId): assetId is number => Number.isInteger(assetId) && Number(assetId) > 0),
  );

  return (
    <div className={`search-portal${searchedTerm || aiQuery ? " has-search-results" : ""}`}>
      <div className="sp-hero">
        <h1>{t("portal.title")}</h1>
        <p>{t("portal.description")}</p>
      </div>

      <div className="sp-search-wrap">
        <div className="sp-searchbox">
          <span className="sp-ico">
            <Icon name="search" size={20} />
          </span>
          <Input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(event) => {
              initialSearchBootstrapPendingRef.current = false;
              setQuery(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") doSearch();
            }}
            placeholder={t("portal.searchPlaceholder")}
            aria-label={t("portal.searchAriaLabel")}
            autoFocus
          />
          <Button variant="primary" type="button" className="sp-search-btn" aria-label={t("portal.searchButton")} onClick={doSearch}>
            <Icon name="search" size={17} />
            <span className="sp-btn-text">{t("portal.searchButton")}</span>
          </Button>
          {aiEnabled ? (
            <Button
              variant="tertiary"
              type="button"
              className="sp-ask-btn"
              aria-label={t("portal.askAiButton")}
              disabled={!query.trim() || (aiLoading && query.trim() === aiQuery)}
              onClick={() => runAiAsk(query)}
            >
              <span className="sp-ask-mark" aria-hidden="true">✦</span>
              <span>{t("portal.askAiButton")}</span>
            </Button>
          ) : null}
        </div>
      </div>

      <div className="sp-scopes" role="group" aria-label={t("portal.scopeAriaLabel")}>
        {scopeOptions.map((item) => (
          <Button
            key={item.key}
            variant="tertiary"
            type="button"
            className={`sp-scope-chip${scope === item.key ? " active" : ""}`}
            aria-pressed={scope === item.key}
            onClick={() => pickScope(item.key)}
          >
            {resolvePortalScopeLabel(item, t)}
          </Button>
        ))}
      </div>

      {hotTags.length > 0 ? (
        <div className="sp-hot">
          <span className="sp-hot-label">{t("portal.popular")}</span>
          {hotTags.map((item) => (
            <Button
              type="button"
              key={item.id}
              variant="tertiary"
              className="sp-hot-item"
              onClick={() => pickHot(item.keyword)}
            >
              <span className={isMonospaceHotKeyword(item.keyword) ? "mono" : ""}>
                {item.keyword}
              </span>
            </Button>
          ))}
        </div>
      ) : null}

      {hasSubmittedQuery ? (
        <div className="sp-results" ref={resultContainerRef} aria-live="polite">
          <div
            className="sp-result-tabs"
            role="tablist"
            aria-label={t("portal.resultTabsAriaLabel")}
            onKeyDown={(event) => {
              const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)'));
              const currentTab = event.target instanceof HTMLElement
                ? event.target.closest<HTMLButtonElement>('[role="tab"]')
                : null;
              const currentIndex = currentTab ? tabs.indexOf(currentTab) : -1;
              if (currentIndex < 0) return;
              let nextIndex = -1;
              if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % tabs.length;
              else if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
              else if (event.key === "Home") nextIndex = 0;
              else if (event.key === "End") nextIndex = tabs.length - 1;
              if (nextIndex < 0) return;
              const nextTab = tabs[nextIndex];
              if (!nextTab) return;
              event.preventDefault();
              nextTab.focus();
              setActiveResultTab(nextTab.dataset["resultTab"] === "ai" ? "ai" : "search");
            }}
          >
            <Button
              variant="tertiary"
              type="button"
              role="tab"
              id="sp-search-tab"
              aria-controls="sp-search-panel"
              aria-selected={activeResultTab === "search"}
              data-result-tab="search"
              tabIndex={activeResultTab === "search" ? 0 : -1}
              className={`sp-result-tab${activeResultTab === "search" ? " active" : ""}`}
              onClick={() => setActiveResultTab("search")}
            >
              <span>{t("portal.searchTab")}</span><span className="sp-result-tab-status">{searchTabStatus}</span>
            </Button>
            <Button
              variant="tertiary"
              type="button"
              role="tab"
              id="sp-ai-tab"
              aria-controls="sp-ai-panel"
              aria-selected={activeResultTab === "ai"}
              data-result-tab="ai"
              tabIndex={activeResultTab === "ai" ? 0 : -1}
              className={`sp-result-tab${activeResultTab === "ai" ? " active" : ""}`}
              onClick={() => setActiveResultTab("ai")}
            >
              <span>{t("portal.aiTab")}</span><span className="sp-result-tab-status">{aiEnabled || aiQuery ? aiTabStatus : tAi("status.unavailable")}</span>
            </Button>
          </div>
          <div className="sp-result-panel sp-search-panel" role="tabpanel" id="sp-search-panel" aria-labelledby="sp-search-tab" hidden={activeResultTab !== "search"}>
            {searchedTerm ? (
              <>
                <div className="sp-panel-query">{t("portal.searchQuestion", { query: searchedTerm })}</div>
          {!searchLoading && !searchError && result?.partial ? (
            <ActionErrorBanner title={t("results.searchPartialTitle")} message={t("results.searchPartialMessage")} />
          ) : null}
          {searchLoading ? (
            <LoadingState
              title={t("results.searchingTitle", { query: searchedTerm })}
              desc=""
              label={t("results.searchingLabel")}
              className="sp-result-loading"
            />
          ) : searchError ? (
            <ErrorState title={searchError} desc="" className="sp-result-error" />
          ) : groups.length === 0 ? (
            <div className="sp-empty">
              <div className="sp-empty-ic">
                <Icon name="inbox" size={26} />
              </div>
              <EmptyState
                title={t(result?.partial ? "results.partialTitle" : "results.noExactMatchTitle")}
                desc={t(result?.partial ? "results.partialDescription" : "results.noResultsDescription", { query: searchedTerm })}
                className="sp-empty-adapter"
              />
              {!result?.partial && aiEnabled ? (
                <Button
                  variant="primary"
                  className="sp-empty-ai-action"
                  type="button"
                  aria-label={t("results.askAiForAsset")}
                  disabled={aiLoading}
                  onClick={() => runAiAsk(searchedTerm)}
                >
                  {t("results.askAiForAsset")}
                </Button>
              ) : null}
              <Button
                variant="primary"
                className="sp-empty-action"
                type="button"
                aria-label={t("results.clearSearch")}
                onClick={() => clearSearch(scope)}
              >
                {t("results.clearSearch")}
              </Button>
            </div>
          ) : (
            <>
              <div className="sp-business-group-title">{t("results.assetGroupTitle")}</div>
              <div className="sp-result-summary">
                {t(result?.partial ? "results.loadedPrefix" : "results.totalPrefix")} <b>{result?.total}</b> {t("results.summarySuffix", { query: searchedTerm })}
              </div>
              {groups.map((group) => (
                <div key={group.type} className="sp-group">
                  <div className="sp-group-head">
                    <span className="sp-group-title">{resolveSearchGroupLabel(group, t)}</span>
                    <span className="sp-group-count">
                      {group.hasMore
                        ? t("results.groupShowing", { shown: group.items.length, total: group.count })
                        : t("results.groupCount", { count: group.count })}
                    </span>
                  </div>
                  <div className="sp-group-list">
                    {group.items.map((item) => (
                      <Button
                        variant="tertiary"
                        type="button"
                        key={item.id}
                        className="sp-hit"
                        onClick={() => handleNavigate(item, searchedTerm)}
                      >
                        <span className="sp-hit-main">
                          <span className="sp-hit-title mono">
                            {item.title}
                          </span>
                          <span className="sp-hit-sub">
                            {item.subtitle}
                            {item.category ? ` · ${item.category}` : ""}
                          </span>
                        </span>
                        {item.meta || formatMatchedField(item, t("results.matchedPrefix")) ? (
                          <span className="sp-hit-facts">
                            {item.meta ? (
                              <span className="sp-hit-meta">{item.meta}</span>
                            ) : null}
                            {formatMatchedField(item, t("results.matchedPrefix")) ? (
                              <span className="sp-hit-match">
                                {formatMatchedField(item, t("results.matchedPrefix"))}
                              </span>
                            ) : null}
                          </span>
                        ) : null}
                        <span className="sp-hit-go">
                          <Icon name="arrow" size={14} />
                        </span>
                      </Button>
                    ))}
                  </div>
                  {group.hasMore === true ? (
                    <Button
                      variant="tertiary"
                      type="button"
                      className="sp-group-more"
                      aria-label={t("results.seeAllAriaLabel", { group: resolveSearchGroupLabel(group, t) })}
                      onClick={() => handleNavigate(group, searchedTerm)}
                    >
                      {t("results.seeAll", { count: group.count })}
                      <Icon name="arrow" size={13} />
                    </Button>
                  ) : null}
                </div>
              ))}
            </>
          )}
          {!searchLoading && !searchError ? (
            <RagRecommendationsSection
              loading={recommendationsLoading}
              failed={recommendationsError}
              response={recommendations}
              searchedAssetIds={searchedAssetIds}
              term={searchedTerm}
              onNavigate={handleNavigate}
            />
          ) : null}
              </>
            ) : (
              <div className="sp-tab-empty">
                <p>{query.trim() ? t("results.queryNotSearched", { query: query.trim() }) : t("results.emptyQueryNotSearched")}</p>
                <Button variant="tertiary" type="button" className="sp-panel-action" disabled={!query.trim()} onClick={doSearch}>
                  {t("results.searchCurrentQuestion")}
                </Button>
              </div>
            )}
          </div>
          <div className="sp-result-panel sp-ai-panel" role="tabpanel" id="sp-ai-panel" aria-labelledby="sp-ai-tab" hidden={activeResultTab !== "ai"}>
            {aiQuery ? (
              <>
                <div className="sp-panel-query">{tAi("section.question", { query: aiQuery })}</div>
                <AiAskSection
                  query={aiQuery}
                  loading={aiLoading}
                  error={aiError}
                  response={aiResponse}
                  executionEvents={aiExecutionEvents}
                  executionStatus={aiExecutionStatus}
                  executionRunId={aiExecutionRunId}
                  onRetry={() => runAiAsk(aiQuery)}
                  onCancel={cancelAiAsk}
                  onNavigate={handleNavigate}
                />
              </>
            ) : (
              <div className="sp-tab-empty">
                {aiEnabled ? (
                  <>
                    <p>{query.trim() ? t("results.queryNotAsked", { query: query.trim() }) : t("results.emptyQuestion")}</p>
                    <Button variant="tertiary" type="button" className="sp-panel-action" disabled={!query.trim()} onClick={() => runAiAsk(query)}>
                      {t("results.startAiAsk")}
                    </Button>
                  </>
                ) : <p>{tAi("failures.aiUnavailableSearchAvailable")}</p>}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="sp-stats">
          {!publicAccessReady ? (
            <LoadingState
              title={t("statistics.prepareTitle")}
              desc=""
              label={t("statistics.prepareLabel")}
              className="sp-stats-hint"
            />
          ) : statsLoading ? (
            <LoadingState
              title={t("statistics.loadingTitle")}
              desc=""
              label={t("statistics.loadingLabel")}
              className="sp-stats-hint"
            />
          ) : statsError ? (
            <ErrorState title={statsError} desc="" className="sp-stats-hint sp-stats-error" />
          ) : (
            <div className="sp-stats-grid">
              {stats.map((item) => (
                <div key={item.label} className="sp-stat-card">
                  <div className="sp-stat-num">{item.value}</div>
                  <div className="sp-stat-label">{resolvePortalStatLabel(item.label, t)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
