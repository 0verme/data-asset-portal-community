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
import { Icon } from "./ui.jsx";
import { getPortalStats } from "../api/portal.js";
import { unifiedSearch } from "../api/search.js";
import {
  DEFAULT_PORTAL_SCOPE,
  filterPortalHotTagsByModules,
  filterPortalScopesByModules,
} from "../config/portalSearch.js";

function readPortalSearchParams(validScopeKeys) {
  if (typeof window === "undefined") {
    return { query: "", scope: DEFAULT_PORTAL_SCOPE };
  }

  const searchParams = new URLSearchParams(window.location.search || "");
  const nextScope = searchParams.get("scope");

  return {
    query: searchParams.get("q") || "",
    scope: validScopeKeys.has(nextScope) ? nextScope : DEFAULT_PORTAL_SCOPE,
  };
}

function formatMatchedField(item) {
  const first = item?.matchedFields?.[0];
  if (!first?.label || !first?.value) return "";
  return `命中：${first.label} ${first.value}`;
}

export function SearchPortalPage({
  onNavigate,
  availableModules = [],
  authenticated = true,
  onRequireLogin,
}) {
  const scopeOptions = useMemo(
    () => filterPortalScopesByModules(availableModules),
    [availableModules],
  );
  const hotTags = useMemo(
    () => filterPortalHotTagsByModules(availableModules),
    [availableModules],
  );
  const validScopeKeys = useMemo(
    () => new Set(scopeOptions.map((item) => item.key)),
    [scopeOptions],
  );
  const initialSearchRef = useRef(readPortalSearchParams(validScopeKeys));
  const [query, setQuery] = useState(initialSearchRef.current.query);
  const [scope, setScope] = useState(initialSearchRef.current.scope);
  const [stats, setStats] = useState([]);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState("");
  const [result, setResult] = useState(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [searchedTerm, setSearchedTerm] = useState("");

  const inputRef = useRef(null);
  const requestSeq = useRef(0);

  const syncSearchUrl = (nextQuery, nextScope = DEFAULT_PORTAL_SCOPE) => {
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

  const resetSearchState = (nextScope = scope) => {
    const preservedScope = validScopeKeys.has(nextScope) ? nextScope : DEFAULT_PORTAL_SCOPE;
    requestSeq.current += 1;
    setQuery("");
    setScope(preservedScope);
    setResult(null);
    setSearchLoading(false);
    setSearchError("");
    setSearchedTerm("");
    syncSearchUrl("", preservedScope);
  };

  const clearSearch = (nextScope = scope) => {
    resetSearchState(nextScope);
    inputRef.current?.focus();
  };

  const runSearch = (rawQuery, rawScope = DEFAULT_PORTAL_SCOPE) => {
    const keyword = String(rawQuery ?? "").trim();
    const nextScope = validScopeKeys.has(rawScope) ? rawScope : DEFAULT_PORTAL_SCOPE;

    if (!keyword) {
      clearSearch(nextScope);
      return;
    }
    if (!authenticated) {
      setSearchError("请先登录后搜索。");
      setResult(null);
      setSearchLoading(false);
      setSearchedTerm(keyword);
      onRequireLogin?.();
      return;
    }

    const seq = ++requestSeq.current;
    setQuery(keyword);
    setScope(nextScope);
    setResult(null);
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
      .catch((error) => {
        if (seq !== requestSeq.current) return;
        setSearchError(error?.message || "搜索失败，请稍后再试。");
        setResult(null);
        setSearchLoading(false);
      });
  };

  useEffect(() => {
    let cancelled = false;
    if (!authenticated) {
      setStats([]);
      setStatsLoading(false);
      setStatsError("");
      setResult(null);
      setSearchError("");
      setSearchedTerm("");
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
      .catch((error) => {
        if (cancelled) return;
        setStatsError(error?.message || "资产统计加载失败");
        setStatsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [availableModules, authenticated]);

  useEffect(() => {
    if (!authenticated) return;
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
    // authentication state changes. The called search updates state, so adding its
    // render-scoped dependencies would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableModules, authenticated]);

  useEffect(() => {
    if (!authenticated) return;
    const initialQuery = String(initialSearchRef.current.query || "").trim();
    if (!initialQuery) return;
    runSearch(initialQuery, initialSearchRef.current.scope);
    // Bootstrap the URL query once per authentication bootstrap; re-running on the
    // render-scoped callback would repeat the search.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated]);

  const doSearch = () => runSearch(query, scope);

  const pickHot = (term) => {
    setQuery(term);
    runSearch(term, scope);
  };

  const pickScope = (nextScope) => {
    setScope(nextScope);
    const activeQuery = String(query || searchedTerm || "").trim();
    if (activeQuery) {
      runSearch(activeQuery, nextScope);
      return;
    }
    syncSearchUrl("", nextScope);
  };

  const handleNavigate = (itemOrGroup, term) => {
    if (typeof onNavigate === "function") {
      onNavigate(itemOrGroup, term);
    }
  };

  const hasResult = Boolean(result) && !searchLoading && !searchError;
  const groups = hasResult ? result.groups : [];

  return (
    <div className="search-portal">
      <div className="sp-hero">
        <h1>数据资产管理与血缘分析平台</h1>
        <p>一个入口，搜索系统、字段、词根、指标、报表、API、资产、下游推送和码值表。</p>
      </div>

      <div className="sp-search-wrap">
        <div className="sp-searchbox">
          <span className="sp-ico"><Icon name="search" size={20} /></span>
          <input
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
          <button className="sp-search-btn" onClick={doSearch}>
            <Icon name="search" size={17} />
            <span className="sp-btn-text">搜索</span>
          </button>
        </div>
      </div>

      <div className="sp-scopes" role="group" aria-label="搜索范围">
        {scopeOptions.map((item) => (
          <button
            key={item.key}
            className={`sp-scope-chip${scope === item.key ? " active" : ""}`}
            aria-pressed={scope === item.key}
            onClick={() => pickScope(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="sp-hot">
        <span className="sp-hot-label">热门</span>
        {hotTags.map((item) => (
          <button key={item.q} className="sp-hot-item" onClick={() => pickHot(item.q)}>
            <span className={item.mono ? "mono" : ""}>{item.label || item.q}</span>
          </button>
        ))}
      </div>

      {searchedTerm ? (
        <div className="sp-results" aria-live="polite">
          {searchLoading ? (
            <div className="sp-result-hint">正在搜索 “{searchedTerm}”...</div>
          ) : searchError ? (
            <div className="sp-result-hint sp-result-error">{searchError}</div>
          ) : groups.length === 0 ? (
            <div className="sp-empty">
              <div className="sp-empty-ic"><Icon name="inbox" size={26} /></div>
              <h4>没有找到匹配的资产</h4>
              <p>没有与 “{searchedTerm}” 相关的资产、系统、字段、词根、指标、报表、API、码值表或下游推送。</p>
              <button className="btn primary sp-empty-action" type="button" aria-label="清空搜索" onClick={() => clearSearch(scope)}>清空搜索</button>
            </div>
          ) : (
            <>
              <div className="sp-result-summary">
                共 <b>{result.total}</b> 条结果，匹配 “{searchedTerm}”
              </div>
              {groups.map((group) => (
                <div key={group.type} className="sp-group">
                  <div className="sp-group-head">
                    <span className="sp-group-title">{group.label}</span>
                    <span className="sp-group-count">{group.count} 条</span>
                  </div>
                  <div className="sp-group-list">
                    {group.items.map((item) => (
                      <button
                        key={item.id}
                        className="sp-hit"
                        onClick={() => handleNavigate(item, searchedTerm)}
                      >
                        <span className="sp-hit-main">
                          <span className="sp-hit-title mono">{item.title}</span>
                          <span className="sp-hit-sub">
                            {item.subtitle}
                            {item.category ? ` · ${item.category}` : ""}
                          </span>
                        </span>
                        {item.meta ? <span className="sp-hit-meta">{item.meta}</span> : null}
                        {formatMatchedField(item) ? (
                          <span className="sp-hit-match">{formatMatchedField(item)}</span>
                        ) : null}
                        <span className="sp-hit-go"><Icon name="arrow" size={14} /></span>
                      </button>
                    ))}
                  </div>
                  {group.count > group.items.length ? (
                    <button className="sp-group-more" onClick={() => handleNavigate(group, searchedTerm)}>
                      查看全部 {group.count} 条
                      <Icon name="arrow" size={13} />
                    </button>
                  ) : null}
                </div>
              ))}
            </>
          )}
        </div>
      ) : (
        <div className="sp-stats">
          {!authenticated ? (
            <div className="sp-stats-hint">登录后查看资产统计与搜索结果。</div>
          ) : statsLoading ? (
            <div className="sp-stats-hint">正在加载资产统计...</div>
          ) : statsError ? (
            <div className="sp-stats-hint sp-stats-error">{statsError}</div>
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
