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
import { Icon } from "./ui.tsx";
import { Button, EmptyState, ErrorState, Input, LoadingState } from "../ui/index.ts";
import { ActionErrorBanner } from "./common/ActionErrorBanner.tsx";
import { getPortalStats, type PortalStatItem } from "../api/portal.ts";
import { getHotKeywords } from "../api/hotKeywords.ts";
import {
  askAiWithProgress,
  getAiAskAvailability,
  type AiAskCandidate,
  type AiAskProgressStep,
  type AiAskResponse,
  type AiAskStatisticalResult,
} from "../api/aiAsk.ts";
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

function formatMatchedField(item: SearchResultItem): string {
  const parts = (item.matchedFields || [])
    .filter((match) => match?.label && match?.value)
    .slice(0, MAX_MATCHED_FIELD_LABELS)
    .map((match) => `${match.label} ${match.value}`);
  return parts.length ? `命中：${parts.join(" / ")}` : "";
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
  if (response?.status === "disabled") return null;

  if (
    failed ||
    response?.status === "unavailable" ||
    (response?.status === "degraded" && response.recommendations.length === 0)
  ) {
    return (
      <div className="sp-rag-unavailable" role="status">
        相关资产推荐暂不可用，关键词搜索不受影响。
      </div>
    );
  }

  if (loading && !response) {
    return (
      <div className="sp-rag-loading" role="status" aria-label="正在加载相关资产推荐">
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
    <section className="sp-rag-group" aria-label="相关资产推荐">
      <div className="sp-group-head">
        <span className="sp-group-title">相关资产推荐</span>
        <span className="sp-group-count">{recommendations.length} 条</span>
      </div>
      {response.status === "degraded" ? (
        <div className="sp-rag-unavailable" role="status">
          部分推荐暂不可用，以下结果已通过目录校验。
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
                  <span className="sp-rag-hit-type">{item.assetType === "field" ? "字段" : "数据表"}</span>
                </span>
                {item.displayName && item.displayName !== item.name ? (
                  <span className="sp-rag-hit-name">{item.name}</span>
                ) : null}
                {item.description ? <span className="sp-rag-hit-desc">{item.description}</span> : null}
                {item.relatedTable ? (
                  <span className="sp-rag-hit-table">所属表：{item.relatedTable.displayName || item.relatedTable.name}</span>
                ) : null}
                {item.evidence.length ? (
                  <span className="sp-rag-hit-evidence">匹配依据：{item.evidence.join("、")}</span>
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

type AiAskRunStatus = "running" | "completed" | "failed" | "cancelled";

const AI_ASK_STEP_TITLES: Record<AiAskProgressStep["id"], { running: string; completed: string; failed: string; pending: string }> = {
  analyzing: { running: "正在分析问题", completed: "已分析问题", failed: "问题分析失败", pending: "等待分析问题" },
  retrieving: { running: "正在检索数据资产", completed: "已完成检索", failed: "资产检索失败", pending: "等待检索资产" },
  counting: { running: "正在整理候选资产", completed: "已找到相关表和字段", failed: "候选整理失败", pending: "等待整理候选" },
  organizing: { running: "正在整理检索结果", completed: "已整理检索结果", failed: "结果整理失败", pending: "等待整理结果" },
  generating: { running: "正在生成回答", completed: "已生成回答", failed: "回答生成失败", pending: "等待生成回答" },
  completed: { running: "正在完成问答", completed: "回答完成", failed: "问答未完成", pending: "等待完成问答" },
};
const METADATA_COUNT_PROGRESS_TITLES: Record<AiAskProgressStep["status"], string> = {
  pending: "等待查询目录统计",
  running: "正在查询目录统计",
  completed: "已识别目录统计意图",
  failed: "统计意图识别失败",
};

function formatAiAskElapsed(elapsedMs: number): string {
  return elapsedMs < 1000
    ? `${Math.round(elapsedMs)} 毫秒`
    : `${(elapsedMs / 1000).toFixed(1)} 秒`;
}

function safeCatalogLink(value: string | null | undefined): string | null {
  return value && value.startsWith("/") && !value.startsWith("//") && !value.includes("\\")
    ? value
    : null;
}

function AiAskStatisticalCard({ result }: { result: AiAskStatisticalResult }) {
  const link = safeCatalogLink(result.sourceLink);
  const metricLabel = result.metric === "table_count" ? "张表" : result.metric === "field_count" ? "个字段" : "统计值";
  const filterSummary = result.filters.map((filter) =>
    `${filter.displayName || filter.dimension}=${filter.value}`,
  ).join("；");
  return (
    <section className="sp-ai-statistic" aria-label="确定性统计结果">
      <div className="sp-ai-statistic-head">
        <strong>{result.value} {metricLabel}</strong>
        <span>{result.complete ? "完整统计" : "部分统计"}</span>
      </div>
      <p>统计依据：DAP 资产目录{filterSummary ? ` · ${filterSummary}` : " · 全目录"}</p>
      {link ? <a className="sp-ai-statistic-link" href={link}>查看筛选后的全部资产</a> : null}
    </section>
  );
}

interface AiAskProgressPanelProps {
  steps: AiAskProgressStep[];
  status: AiAskRunStatus | null;
  loading: boolean;
  onCancel: () => void;
}

function AiAskProgressPanel({ steps, status, loading, onCancel }: AiAskProgressPanelProps) {
  const [expanded, setExpanded] = useState(loading);
  useEffect(() => {
    setExpanded(loading);
  }, [loading, status]);

  if (!status && !steps.length) return null;
  const summary = status === "running" ? "执行中"
    : status === "completed" ? "已完成"
      : status === "cancelled" ? "已取消"
        : "执行失败";
  const statusLabels = {
    pending: "等待中",
    running: "进行中",
    completed: "已完成",
    failed: "失败",
  } as const;
  const errorLabels = {
    timeout: "请求超时",
    unavailable: "服务不可用",
    invalid_response: "返回数据无效",
    disabled: "功能未启用",
    cancelled: "已取消",
  } as const;

  return (
    <details
      className="sp-ai-progress"
      open={loading || expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
      aria-label="AI 问答执行过程"
    >
      <summary className="sp-ai-progress-summary">
        <span>问答执行过程</span>
        <span className={`sp-ai-progress-overall sp-ai-progress-${status}`}>{summary}</span>
      </summary>
      {steps.length ? (
        <ol className="sp-ai-progress-list">
          {steps.map((step) => (
            <li className={`sp-ai-progress-step sp-ai-progress-step-${step.status}`} key={step.id}>
              <span className="sp-ai-progress-indicator" aria-hidden="true" />
              <span className="sp-ai-progress-step-main">
                <span className="sp-ai-progress-step-title">
                  {step.id === "analyzing" && step.intent === "metadata_count"
                    ? METADATA_COUNT_PROGRESS_TITLES[step.status]
                    : AI_ASK_STEP_TITLES[step.id][step.status]}
                </span>
                {step.id === "counting" && step.tableCount !== undefined && step.tableCount !== null ? (
                  <span className="sp-ai-progress-count">
                    {step.tableCount} 张表 · {step.fieldCount ?? 0} 个字段
                  </span>
                ) : null}
                {step.errorCode ? (
                  <span className="sp-ai-progress-error">{errorLabels[step.errorCode]}</span>
                ) : null}
              </span>
              <span className="sp-ai-progress-step-meta">
                <span>{statusLabels[step.status]}</span>
                {step.status !== "pending" ? <span>{formatAiAskElapsed(step.elapsedMs)}</span> : null}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="sp-ai-progress-waiting" role="status">正在连接问答服务并等待后端进度。</p>
      )}
      {loading ? (
        <Button variant="tertiary" type="button" className="sp-ai-cancel" onClick={onCancel}>
          取消问答
        </Button>
      ) : null}
    </details>
  );
}

interface AiAskSectionProps {
  query: string;
  loading: boolean;
  error: string;
  response: AiAskResponse | null;
  progress: AiAskProgressStep[];
  progressStatus: AiAskRunStatus | null;
  onRetry: () => void;
  onCancel: () => void;
  onNavigate: ((target: SearchNavigationTarget, term: string) => void) | undefined;
}

function AiAskSection({
  query,
  loading,
  error,
  response,
  progress,
  progressStatus,
  onRetry,
  onCancel,
  onNavigate,
}: AiAskSectionProps) {
  if (!query) return null;
  const responseFailure = !response?.metadataCount && response?.status === "retrieval_unavailable"
    ? response.reasonCode === "retrieval_timeout"
      ? "资产检索超时，无法基于目录回答；传统搜索不受影响。"
      : "资产检索暂不可用，无法确认候选资产；传统搜索不受影响。"
    : !response?.metadataCount && response?.status === "generation_unavailable"
      ? response.reasonCode === "llm_timeout"
        ? "模型生成超时，未生成回答；不会把未筛选候选当作答案。"
        : "模型暂不可用，未生成回答；不会把未筛选候选当作答案。"
      : !response?.metadataCount && response?.status === "ambiguous_scope"
        ? response.answer || "无法从当前目录唯一确认统计范围，请明确主题域或数据分层后重试。"
        : !response?.metadataCount && response?.status === "metadata_count_unavailable"
          ? response.answer || "当前 DAP 目录统计暂不可用，未返回统计值；请稍后重试。"
          : "";
  const failureMessage = error || responseFailure;
  return (
    <section className="sp-ai-group" aria-label="AI 问答结果">
      <div className="sp-group-head">
        <span className="sp-group-title">AI 回答</span>
        <span className="sp-group-count">单轮问答 · 基于已校验资产元数据</span>
      </div>
      {!loading && failureMessage ? (
        <div className="sp-ai-state sp-ai-error" role="alert">
          <span>{error
            ? progressStatus === "cancelled" ? error : `AI 问答请求失败：${error}`
            : failureMessage}</span>
          {progressStatus !== "cancelled" ? (
            <Button variant="tertiary" type="button" className="sp-ai-retry" onClick={onRetry}>
              重试
            </Button>
          ) : null}
        </div>
      ) : null}
      <div className="sp-ai-question">问题：{query}</div>
      <AiAskProgressPanel steps={progress} status={progressStatus} loading={loading} onCancel={onCancel} />
      {loading || failureMessage ? null : response ? (
        <>
          {response.retrievalStatus === "degraded" ? (
            <div className="sp-ai-state" role="status">检索部分降级；下方仅展示通过当前 DAP 目录校验的候选资产。</div>
          ) : null}
          {response.statisticalResult ? <AiAskStatisticalCard result={response.statisticalResult} /> : null}
          {response.status === "insufficient_evidence" ? (
            <div className="sp-ai-state" role="status">{response.answer}</div>
          ) : response.status === "partial_answer" ? (
            <>
              <div className="sp-ai-state" role="status">
                {response.resultsTruncated
                  ? "部分回答：本次有界检索结果可能不完整；请核对下方已验证候选。"
                  : "部分回答：仅找到相关线索，尚不足以直接确认问题结论。"}
              </div>
              <div className="sp-ai-summary" aria-label="AI 部分回答">{response.answer}</div>
            </>
          ) : !response.metadataCount && response.answer.trim() ? (
            <div className="sp-ai-summary" aria-label="AI 回答摘要">{response.answer}</div>
          ) : null}
          {response.candidates.length ? (
            <div className="sp-ai-candidates">
              <div className="sp-group-head">
                <span className="sp-group-title">答案引用的目录资产</span>
                <span className="sp-group-count">{response.candidates.length} 条</span>
              </div>
              <div className="sp-ai-list">
                {response.candidates.map((item) => {
                  const isField = item.assetType === "field";
                  const target = askCandidateTarget(item);
                  return (
                    <Button
                      key={askCandidateKey(item)}
                      variant="tertiary"
                      type="button"
                      className="sp-ai-candidate"
                      aria-label={`查看${isField ? "字段" : "数据表"}详情：${isField ? item.fieldName : item.tableName}`}
                      onClick={() => onNavigate?.(target, query)}
                    >
                      <span className="sp-ai-candidate-main">
                        <span className="sp-ai-candidate-heading">
                          <span className="sp-ai-candidate-title">{isField ? item.fieldDisplayName || item.fieldName : item.tableDisplayName || item.tableName}</span>
                          <span className="sp-ai-candidate-type">{isField ? "字段" : "数据表"}</span>
                          <span className={`sp-ai-candidate-relevance ${item.relevance === "direct" ? "direct" : "related"}`}>
                            {item.relevance === "direct" ? "直接相关" : "相关线索 · 非直接结论"}
                          </span>
                        </span>
                        <span className="sp-ai-candidate-name mono">{isField ? item.fieldName : item.tableName}</span>
                        {isField ? <span className="sp-ai-candidate-meta">所属表：{item.tableDisplayName || item.tableName}（{item.tableName}）</span> : null}
                        {(isField ? item.fieldDescription : item.tableDescription) ? (
                          <span className="sp-ai-candidate-desc">中文含义：{isField ? item.fieldDescription : item.tableDescription}</span>
                        ) : null}
                        <span className="sp-ai-candidate-meta">主题域/分层：{[item.domain, item.layer].filter(Boolean).join(" / ") || "未登记"}</span>
                        <span className="sp-ai-candidate-evidence">证据来源：DAP 资产目录 · {item.matchReason}</span>
                      </span>
                      <span className="sp-hit-go" aria-hidden="true"><Icon name="arrow" size={14} /></span>
                    </Button>
                  );
                })}
              </div>
            </div>
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
  const [aiError, setAiError] = useState("");
  const [aiProgress, setAiProgress] = useState<AiAskProgressStep[]>([]);
  const [aiProgressStatus, setAiProgressStatus] = useState<AiAskRunStatus | null>(null);
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
    setAiError("");
    setAiProgress([]);
    setAiProgressStatus(null);
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
      setAiError("");
      setAiProgress([]);
      setAiProgressStatus(null);
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
          error instanceof Error ? error.message : "搜索失败，请稍后再试。",
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
    setAiError("");
    setAiProgress([]);
    setAiProgressStatus("running");
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

    askAiWithProgress(
      question,
      (step) => {
        if (seq !== aiRequestSeq.current) return;
        setAiProgress((current) => {
          const index = current.findIndex((item) => item.id === step.id);
          if (index < 0) return [...current, step];
          const next = [...current];
          next[index] = step;
          return next;
        });
        if (step.status === "failed") setAiProgressStatus("failed");
        else if (step.id === "completed" && step.status === "completed") setAiProgressStatus("completed");
      },
      "all",
      10,
      controller.signal,
    )
      .then((response) => {
        if (seq !== aiRequestSeq.current) return;
        aiAbortController.current = null;
        setAiResponse(response);
        setAiLoading(false);
        setAiProgressStatus(
          (response.status === "metadata_count_answered" && response.metadataCount !== null) ||
          response.status === "answered" ||
          response.status === "partial_answer" ||
          response.status === "insufficient_evidence"
            ? "completed"
            : "failed",
        );
        requestResultScroll();
      })
      .catch((error: unknown) => {
        if (seq !== aiRequestSeq.current) return;
        aiAbortController.current = null;
        setAiLoading(false);
        if (controller.signal.aborted) {
          setAiError("问答已取消。");
          setAiProgressStatus("cancelled");
          setAiProgress((current) => current.map((step) => step.status === "running"
            ? { ...step, status: "failed", errorCode: "cancelled" }
            : step));
          return;
        }
        const message = error instanceof Error ? error.message : "AI 问答暂不可用，请重试。";
        const timedOut = /超时|timed out|timeout/i.test(message);
        setAiError(message);
        setAiProgressStatus("failed");
        requestResultScroll();
        setAiProgress((current) => current.map((step) => step.status === "running"
          ? { ...step, status: "failed", errorCode: timedOut ? "timeout" : "unavailable" }
          : step));
      });
  };

  const cancelAiAsk = (): void => {
    if (!aiAbortController.current) return;
    aiRequestSeq.current += 1;
    aiAbortController.current.abort();
    aiAbortController.current = null;
    setAiLoading(false);
    setAiError("问答已取消。");
    setAiProgressStatus("cancelled");
    requestResultScroll();
    setAiProgress((current) => current.map((step) => step.status === "running"
      ? { ...step, status: "failed", errorCode: "cancelled" }
      : step));
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
          setAiError("");
          setAiProgress([]);
          setAiProgressStatus(null);
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
          error instanceof Error ? error.message : "资产统计加载失败",
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
  const searchTabStatus = searchLoading ? "搜索中" : searchError ? "搜索失败" : searchedTerm ? "已搜索" : "未搜索";
  const aiTabStatus = aiLoading ? "问答中" : aiError || aiResponseFailed ? "执行失败" : aiResponse ? "已完成" : "未提问";
  const searchedAssetIds = new Set(
    groups
      .flatMap((group) => group.items.map((item) => item.assetId))
      .filter((assetId): assetId is number => Number.isInteger(assetId) && Number(assetId) > 0),
  );

  return (
    <div className={`search-portal${searchedTerm || aiQuery ? " has-search-results" : ""}`}>
      <div className="sp-hero">
        <h1>数据资产管理与血缘分析平台</h1>
        <p>
          一个入口，搜索系统、字段、词根、指标、报表、API、资产、下游推送和码值表。
        </p>
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
            placeholder="搜索资产、系统、字段、指标、报表、API、码值表、负责人或下游推送"
            aria-label="搜索数据资产"
            autoFocus
          />
          <Button variant="primary" type="button" className="sp-search-btn" aria-label="搜索" onClick={doSearch}>
            <Icon name="search" size={17} />
            <span className="sp-btn-text">搜索</span>
          </Button>
          {aiEnabled ? (
            <Button
              variant="tertiary"
              type="button"
              className="sp-ask-btn"
              aria-label="问 AI"
              disabled={!query.trim() || (aiLoading && query.trim() === aiQuery)}
              onClick={() => runAiAsk(query)}
            >
              <span className="sp-ask-mark" aria-hidden="true">✦</span>
              <span>问 AI</span>
            </Button>
          ) : null}
        </div>
      </div>

      <div className="sp-scopes" role="group" aria-label="搜索范围">
        {scopeOptions.map((item) => (
          <Button
            key={item.key}
            variant="tertiary"
            type="button"
            className={`sp-scope-chip${scope === item.key ? " active" : ""}`}
            aria-pressed={scope === item.key}
            onClick={() => pickScope(item.key)}
          >
            {item.label}
          </Button>
        ))}
      </div>

      {hotTags.length > 0 ? (
        <div className="sp-hot">
          <span className="sp-hot-label">热门</span>
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
            aria-label="搜索与问答结果"
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
              <span>搜索结果</span><span className="sp-result-tab-status">{searchTabStatus}</span>
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
              <span>AI 问答</span><span className="sp-result-tab-status">{aiEnabled || aiQuery ? aiTabStatus : "暂不可用"}</span>
            </Button>
          </div>
          <div className="sp-result-panel sp-search-panel" role="tabpanel" id="sp-search-panel" aria-labelledby="sp-search-tab" hidden={activeResultTab !== "search"}>
            {searchedTerm ? (
              <>
                <div className="sp-panel-query">搜索问题：{searchedTerm}</div>
          {!searchLoading && !searchError && result?.partial ? (
            <ActionErrorBanner title="搜索结果不完整" message="部分模块暂时不可用，以下仅展示已成功查询的结果，请重新搜索。" />
          ) : null}
          {searchLoading ? (
            <LoadingState
              title={`正在搜索 “${searchedTerm}”...`}
              desc=""
              label="正在搜索"
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
                title={result?.partial ? "已查询模块暂无匹配" : "没有找到精确匹配的资产"}
                desc={result?.partial ? "部分模块加载失败，当前无法确认完整搜索结果。" : `没有与 “${searchedTerm}” 相关的资产、系统、字段、词根、指标、报表、API、码值表或下游推送。`}
                className="sp-empty-adapter"
              />
              {!result?.partial && aiEnabled ? (
                <Button
                  variant="primary"
                  className="sp-empty-ai-action"
                  type="button"
                  aria-label="问 AI 找资产"
                  disabled={aiLoading}
                  onClick={() => runAiAsk(searchedTerm)}
                >
                  问 AI 找资产
                </Button>
              ) : null}
              <Button
                variant="primary"
                className="sp-empty-action"
                type="button"
                aria-label="清空搜索"
                onClick={() => clearSearch(scope)}
              >
                清空搜索
              </Button>
            </div>
          ) : (
            <>
              <div className="sp-business-group-title">资产搜索结果</div>
              <div className="sp-result-summary">
                {result?.partial ? "已加载" : "共"} <b>{result?.total}</b> 条结果，匹配 “{searchedTerm}”
              </div>
              {groups.map((group) => (
                <div key={group.type} className="sp-group">
                  <div className="sp-group-head">
                    <span className="sp-group-title">{group.label}</span>
                    <span className="sp-group-count">
                      {group.hasMore
                        ? `已显示 ${group.items.length} / ${group.count} 条`
                        : `${group.count} 条`}
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
                        {item.meta || formatMatchedField(item) ? (
                          <span className="sp-hit-facts">
                            {item.meta ? (
                              <span className="sp-hit-meta">{item.meta}</span>
                            ) : null}
                            {formatMatchedField(item) ? (
                              <span className="sp-hit-match">
                                {formatMatchedField(item)}
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
                      aria-label={`查看全部${group.label}结果`}
                      onClick={() => handleNavigate(group, searchedTerm)}
                    >
                      查看全部 {group.count} 条
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
                <p>{query.trim() ? `尚未对“${query.trim()}”执行传统搜索。` : "尚未输入要搜索的问题。"}</p>
                <Button variant="tertiary" type="button" className="sp-panel-action" disabled={!query.trim()} onClick={doSearch}>
                  搜索当前问题
                </Button>
              </div>
            )}
          </div>
          <div className="sp-result-panel sp-ai-panel" role="tabpanel" id="sp-ai-panel" aria-labelledby="sp-ai-tab" hidden={activeResultTab !== "ai"}>
            {aiQuery ? (
              <>
                <div className="sp-panel-query">问答问题：{aiQuery}</div>
              <AiAskSection
                query={aiQuery}
                loading={aiLoading}
                error={aiError}
                response={aiResponse}
                progress={aiProgress}
                progressStatus={aiProgressStatus}
                onRetry={() => runAiAsk(aiQuery)}
                onCancel={cancelAiAsk}
                onNavigate={handleNavigate}
              />
              </>
            ) : (
              <div className="sp-tab-empty">
              {aiEnabled ? (
                <>
                  <p>{query.trim() ? `尚未对“${query.trim()}”发起 AI 问答。` : "尚未输入要问的问题。"}</p>
                  <Button variant="tertiary" type="button" className="sp-panel-action" disabled={!query.trim()} onClick={() => runAiAsk(query)}>
                    开始问 AI
                  </Button>
                </>
              ) : <p>AI 问答暂不可用，传统搜索仍可使用。</p>}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="sp-stats">
          {!publicAccessReady ? (
            <LoadingState
              title="正在准备公开资产目录..."
              desc=""
              label="正在准备公开资产目录"
              className="sp-stats-hint"
            />
          ) : statsLoading ? (
            <LoadingState
              title="正在加载资产统计..."
              desc=""
              label="正在加载资产统计"
              className="sp-stats-hint"
            />
          ) : statsError ? (
            <ErrorState title={statsError} desc="" className="sp-stats-hint sp-stats-error" />
          ) : (
            <div className="sp-stats-grid">
              {stats.map((item) => (
                <div key={item.label} className="sp-stat-card">
                  <div className="sp-stat-num">{item.value}</div>
                  <div className="sp-stat-label">{item.label}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
