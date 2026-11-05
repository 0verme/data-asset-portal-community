import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const searchPagePath = fileURLToPath(new URL("./SearchPortalPage.tsx", import.meta.url));
const searchStylesPath = fileURLToPath(new URL("../styles/search.css", import.meta.url));

test("empty search results expose a clear action that preserves scope and focus", async () => {
  const [source, styles] = await Promise.all([
    readFile(searchPagePath, "utf8"),
    readFile(searchStylesPath, "utf8"),
  ]);

  assert.match(source, /groups\.length === 0 \?/);
  assert.match(source, /<EmptyState[\s\S]*?title=\{result\?\.partial \? "已查询模块暂无匹配" : "没有找到精确匹配的资产"\}/);
  assert.match(source, /!result\?\.partial && aiEnabled/);
  assert.match(source, /aria-label="问 AI 找资产"/);
  assert.match(source, /onClick=\{\(\) => runAiAsk\(searchedTerm\)\}/);
  assert.match(source, /className="sp-empty-action"/);
  assert.match(source, /aria-label="清空搜索"/);
  assert.match(source, /onClick=\{\(\) => clearSearch\(scope\)\}/);
  assert.match(source, /const clearSearch = \(nextScope = scope\) => \{/);
  assert.match(source, /resetSearchState\(nextScope\);/);
  assert.match(source, /setScope\(preservedScope\);/);
  assert.match(source, /searchParams\.delete\("q"\);/);
  assert.match(source, /searchParams\.set\("scope", nextScope\);/);
  assert.match(source, /syncSearchUrl\("", preservedScope\);/);
  assert.match(source, /inputRef\.current\?\.focus\(\);/);
  assert.match(styles, /\.sp-empty-action \{ margin: 16px auto 0; \}/);
});

test("Portal Search uses only DAP UI adapters for controls and feedback", async () => {
  const source = await readFile(searchPagePath, "utf8");

  assert.match(source, /from "\.\.\/ui\/index\.ts"/);
  assert.doesNotMatch(source, /@cloudflare\/kumo/);
  assert.match(source, /<Input[\s>]/);
  assert.match(source, /<Button[\s>]/);
  assert.match(source, /<LoadingState[\s>]/);
  assert.match(source, /<ErrorState[\s>]/);
  assert.match(source, /<EmptyState[\s>]/);
});

test("empty recovery remains separate from loading, error, and result branches", async () => {
  const source = await readFile(searchPagePath, "utf8");
  const loadingIndex = source.indexOf("searchLoading ?");
  const errorIndex = source.indexOf("searchError ?");
  const emptyIndex = source.indexOf("groups.length === 0 ?");
  const resultIndex = source.indexOf("sp-result-summary");

  assert.ok(loadingIndex >= 0, "loading state should remain explicit");
  assert.ok(errorIndex > loadingIndex, "error state should follow loading state");
  assert.ok(emptyIndex > errorIndex, "empty state should follow the error branch");
  assert.ok(resultIndex > emptyIndex, "successful results should remain after the empty branch");
});

test("truncated groups render 查看全部 from the formal hasMore flag", async () => {
  const source = await readFile(searchPagePath, "utf8");

  assert.match(source, /group\.hasMore === true \? \(/);
  assert.doesNotMatch(
    source,
    /group\.count > group\.items\.length \? \(/,
    "hasMore must not be inferred from count vs items",
  );
  assert.match(source, /className="sp-group-more"/);
  assert.match(source, /查看全部 \{group\.count\} 条/);
  assert.match(source, /已显示 \$\{group\.items\.length\} \/ \$\{group\.count\} 条/);
});

test("查看全部 navigates the group with the searched keyword", async () => {
  const source = await readFile(searchPagePath, "utf8");

  assert.match(source, /onClick=\{\(\) => handleNavigate\(group, searchedTerm\)\}/);
  assert.match(source, /onNavigate\?\.\(itemOrGroup, term\)/);
  assert.match(source, /aria-label=\{`查看全部\$\{group\.label\}结果`\}/);
});

test("portal scope parsing is the shared whitelist parser", async () => {
  const source = await readFile(searchPagePath, "utf8");

  assert.match(source, /readPortalSearchParams/);
  assert.match(source, /useRef\(readPortalSearchParams\(validScopeKeys\)\)/);
});

test("recommendations load independently, hide when empty or failed, and reuse search clicks", async () => {
  const source = await readFile(searchPagePath, "utf8");

  assert.match(source, /getHotKeywords\(\)/);
  assert.match(source, /\.catch\(\(\) => \{/);
  assert.match(source, /setHotKeywords\(\[\]\)/);
  assert.match(source, /hotTags\.length > 0 \?/);
  assert.match(source, /onClick=\{\(\) => pickHot\(item\.keyword\)\}/);
  assert.match(source, /runSearch\(term, scope\)/);
  assert.doesNotMatch(source, /PORTAL_HOT_TAGS|订单|商品|会员|门店|库存|销售额/);
});

test("long recommendation chips wrap within their available width", async () => {
  const styles = await readFile(searchStylesPath, "utf8");

  assert.match(styles, /\.sp-hot-item[\s\S]*?max-width: 100%/);
  assert.match(styles, /overflow-wrap: anywhere/);
  assert.match(styles, /word-break: break-word/);
});

test("search result rows size from content instead of the Kumo control box", async () => {
  const [source, styles] = await Promise.all([
    readFile(searchPagePath, "utf8"),
    readFile(searchStylesPath, "utf8"),
  ]);

  // Kumo Button ships h-9 (36px) + w-max/shrink-0; list rows must release that box.
  const hitBlock = styles.match(/\.sp-hit \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(hitBlock, /height: auto/);
  assert.match(hitBlock, /width: 100%/);
  assert.match(hitBlock, /border-radius: 0/);
  assert.doesNotMatch(hitBlock, /height: 36px/);
  assert.match(styles, /\.sp-result-loading \{[^}]*max-width: 1200px/);
  assert.match(styles, /\.sp-results \{[^}]*max-width: 1200px/);
  assert.match(styles, /\.sp-hit-facts \{[\s\S]*?flex: 0 1 auto[\s\S]*?max-width: 56%/);
  assert.match(styles, /@media \(max-width: 860px\)[\s\S]*?\.sp-hit \{[\s\S]*?grid-template-columns/);

  // Metadata and matched fields travel together so they cannot crowd the arrow.
  assert.match(
    source,
    /<span className="sp-hit-facts">[\s\S]*?sp-hit-meta[\s\S]*?sp-hit-match[\s\S]*?<\/span>/,
  );
});

test("AI is explicitly enabled, Enter remains traditional search, and model requests are isolated", async () => {
  const source = await readFile(searchPagePath, "utf8");

  assert.match(source, /getAiAskAvailability\(\)/);
  assert.match(source, /\.catch\(\(\) => \{\s*if \(!cancelled\) setAiEnabled\(false\)/);
  assert.match(source, /if \(event\.key === "Enter"\) doSearch\(\)/);
  assert.match(source, /onClick=\{\(\) => runAiAsk\(query\)\}/);
  assert.match(source, /askAiWithProgress\(\s*question/);
  assert.match(source, /syncSearchUrl\(question, scope\)/);
  assert.match(source, /setAiQuery\(""\)/);
  assert.match(source, /if \(searchedTerm !== question\)[\s\S]*?setSearchedTerm\(""\)/);
  assert.match(source, /response\.status === "retrieval_unavailable"/);
  assert.match(source, /response\.status === "generation_unavailable"/);
  assert.match(source, /response\.status === "insufficient_evidence"/);
  assert.match(source, /response\.status === "partial_answer"/);
  assert.match(source, /相关线索 · 非直接结论/);
  assert.match(source, /onRetry=\{\(\) => runAiAsk\(aiQuery\)\}/);
  assert.match(source, /onCancel=\{cancelAiAsk\}/);
  assert.match(source, /onNavigate\?\.\(target, query\)/);
  assert.match(source, /module: "dwm"[\s\S]*?assetId: item\.assetId/);
});

test("AI answers remain explanatory while only DAP candidate cards navigate responsively", async () => {
  const [source, styles, api] = await Promise.all([
    readFile(searchPagePath, "utf8"),
    readFile(searchStylesPath, "utf8"),
    readFile(fileURLToPath(new URL("../api/aiAsk.ts", import.meta.url)), "utf8"),
  ]);

  assert.match(source, /AI 回答摘要/);
  assert.match(source, /onNavigate=\{handleNavigate\}/);
  assert.match(source, /aria-label=\{`查看\$\{isField \? "字段" : "数据表"\}详情：/);
  assert.match(source, /ref: item\.tableName,[\s\S]*?assetId: item\.assetId/);
  assert.match(source, /证据来源：DAP 资产目录/);
  assert.match(source, /答案引用的目录资产/);
  assert.match(source, /item\.relevance === "direct"/);
  assert.match(source, /response\.resultsTruncated[\s\S]*?有界检索结果可能不完整/);
  assert.match(styles, /\.sp-ai-candidate \{[\s\S]*?width: 100%[\s\S]*?min-width: 0/);
  assert.match(styles, /\.sp-ai-candidate-main \{[\s\S]*?overflow-wrap: anywhere/);
  assert.match(styles, /@media \(max-width: 600px\)[\s\S]*?\.sp-ai-candidate \{ padding: 12px/);
  assert.match(api, /suppressTimeoutPayloadLogging: true/);
  assert.doesNotMatch(api, /fetch\(.*AI_LLM|AI_LLM_BASE_URL/);
});

test("AI progress is backend-driven, collapsible, timed, count-backed, and never token-streamed", async () => {
  const [source, styles] = await Promise.all([
    readFile(searchPagePath, "utf8"),
    readFile(searchStylesPath, "utf8"),
  ]);

  assert.match(source, /<AiAskProgressPanel steps=\{progress\}/);
  assert.match(source, /open=\{loading \|\| expanded\}/);
  assert.match(source, /setExpanded\(loading\)/);
  assert.match(source, /"正在分析问题"/);
  assert.match(source, /"正在检索数据资产"/);
  assert.match(source, /"已找到相关表和字段"/);
  assert.match(source, /step\.tableCount/);
  assert.match(source, /step\.fieldCount/);
  assert.match(source, /formatAiAskElapsed\(step\.elapsedMs\)/);
  assert.match(source, /"正在生成回答"/);
  assert.match(source, /"回答完成"/);
  assert.match(source, /response\.reasonCode === "llm_timeout"/);
  assert.match(source, /errorCode: "cancelled"/);
  assert.doesNotMatch(source, /setInterval\(/);
  assert.doesNotMatch(source, /正在检索已登记资产并生成回答/);
  assert.match(styles, /\.sp-ai-progress \{[^}]*background: var\(--surface\)/);
  assert.match(styles, /\.sp-ai-progress-step-failed[\s\S]*?var\(--danger\)/);
});

test("RAG recommendations are a separate business group with asynchronous non-blocking state", async () => {
  const source = await readFile(searchPagePath, "utf8");
  const api = await readFile(fileURLToPath(new URL("../api/search.ts", import.meta.url)), "utf8");

  assert.match(source, /getRagRecommendations\(keyword\)/);
  assert.match(source, /unifiedSearch\(keyword, nextScope\)[\s\S]*?getRagRecommendations\(keyword\)/);
  assert.match(source, /if \(seq !== requestSeq\.current\) return;/);
  assert.match(source, /status === "disabled"\) return null/);
  assert.match(source, /searchedAssetIds\.has\(item\.assetId\)/);
  assert.match(source, /title: item\.displayName \|\| item\.name/);
  assert.match(source, /assetId: item\.assetId/);
  assert.match(source, /sp-business-group-title">资产搜索结果/);
  assert.match(source, /!searchLoading && !searchError \? \([\s\S]*?<RagRecommendationsSection/);
  assert.match(source, /相关资产推荐/);
  assert.doesNotMatch(source, /智能解答|关键词检索|向量检索|混合检索|检索模式/);
  assert.match(api, /status: 'disabled'[\s\S]*recommendations: \[\]/);
  assert.match(api, /suppressUnauthorizedEvent: true/);
  assert.doesNotMatch(api, /similarityScore|confidenceScore|retrievalScore/);
});
