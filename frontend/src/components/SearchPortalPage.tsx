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
  filterPortalHotKeywordsByModules,
  filterPortalScopesByModules,
  isMonospaceHotKeyword,
  readPortalSearchParams,
  type PortalHotKeyword,
} from "../config/portalSearch.ts";

type SearchNavigationTarget = SearchResultItem | SearchResultGroup;

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
  const initialSearchRef = useRef(readPortalSearchParams(validScopeKeys));
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
  const hotTags = useMemo(
    () => filterPortalHotKeywordsByModules(hotKeywords, availableModules),
    [hotKeywords, availableModules],
  );

  const inputRef = useRef<HTMLInputElement | null>(null);
  const requestSeq = useRef(0);

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
    const preservedScope = validScopeKeys.has(nextScope)
      ? nextScope
      : DEFAULT_PORTAL_SCOPE;
    requestSeq.current += 1;
    setQuery("");
    setScope(preservedScope);
    setResult(null);
    setRecommendations(null);
    setRecommendationsLoading(false);
    setRecommendationsError(false);
    setSearchLoading(false);
    setSearchError("");
    setSearchedTerm("");
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
      })
      .catch((error: unknown) => {
        if (seq !== requestSeq.current) return;
        setSearchError(
          error instanceof Error ? error.message : "搜索失败，请稍后再试。",
        );
        setResult(null);
        setSearchLoading(false);
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
    const nextScope = validScopeKeys.has(scope) ? scope : DEFAULT_PORTAL_SCOPE;
    const activeQuery = String(searchedTerm || query || "").trim();

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

  useEffect(() => {
    if (!publicAccessReady) return;
    const initialQuery = String(initialSearchRef.current.query || "").trim();
    if (!initialQuery) return;
    runSearch(initialQuery, initialSearchRef.current.scope);
    // Bootstrap the URL query once per authentication bootstrap; re-running on the
    // render-scoped callback would repeat the search.
  }, [publicAccessReady]);

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
  const searchedAssetIds = new Set(
    groups
      .flatMap((group) => group.items.map((item) => item.assetId))
      .filter((assetId): assetId is number => Number.isInteger(assetId) && Number(assetId) > 0),
  );

  return (
    <div className="search-portal">
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
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") doSearch();
            }}
            placeholder="搜索资产、系统、字段、指标、报表、API、码值表、负责人或下游推送"
            aria-label="搜索数据资产"
            autoFocus
          />
          <Button variant="primary" type="button" className="sp-search-btn" onClick={doSearch}>
            <Icon name="search" size={17} />
            <span className="sp-btn-text">搜索</span>
          </Button>
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

      {searchedTerm ? (
        <div className="sp-results" aria-live="polite">
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
                title={result?.partial ? "已查询模块暂无匹配" : "没有找到匹配的资产"}
                desc={result?.partial ? "部分模块加载失败，当前无法确认完整搜索结果。" : `没有与 “${searchedTerm}” 相关的资产、系统、字段、词根、指标、报表、API、码值表或下游推送。`}
                className="sp-empty-adapter"
              />
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
