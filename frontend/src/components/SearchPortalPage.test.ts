import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const searchPagePath = fileURLToPath(new URL("./SearchPortalPage.tsx", import.meta.url));
const searchStylesPath = fileURLToPath(new URL("../styles/search.css", import.meta.url));
const executionPanelPath = fileURLToPath(new URL("./AiAskExecutionPanel.tsx", import.meta.url));
const stepDetailPath = fileURLToPath(new URL("./StepDetail.tsx", import.meta.url));
const stepSummaryPath = fileURLToPath(new URL("./StepSummary.tsx", import.meta.url));
const stepGroupingPath = fileURLToPath(new URL("./aiAskStepSummary.ts", import.meta.url));
const executionStylesPath = fileURLToPath(new URL("../styles/aiAskExecution.css", import.meta.url));
const executionApiPath = fileURLToPath(new URL("../api/aiAskExecution.ts", import.meta.url));

test("empty search results expose a clear action that preserves scope and focus", async () => {
  const [source, styles] = await Promise.all([
    readFile(searchPagePath, "utf8"),
    readFile(searchStylesPath, "utf8"),
  ]);

  assert.match(source, /groups\.length === 0 \?/);
  assert.match(source, /<EmptyState[\s\S]*?title=\{t\(result\?\.partial \? "results\.partialTitle" : "results\.noExactMatchTitle"\)\}/);
  assert.match(source, /!result\?\.partial && aiEnabled/);
  assert.match(source, /aria-label=\{t\("results\.askAiForAsset"\)\}/);
  assert.match(source, /onClick=\{\(\) => runAiAsk\(searchedTerm\)\}/);
  assert.match(source, /className="sp-empty-action"/);
  assert.match(source, /aria-label=\{t\("results\.clearSearch"\)\}/);
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
  assert.match(source, /t\("results\.seeAll", \{ count: group\.count \}\)/);
  assert.match(source, /t\("results\.groupShowing", \{ shown: group\.items\.length, total: group\.count \}\)/);
});

test("查看全部 navigates the group with the searched keyword", async () => {
  const source = await readFile(searchPagePath, "utf8");

  assert.match(source, /onClick=\{\(\) => handleNavigate\(group, searchedTerm\)\}/);
  assert.match(source, /onNavigate\?\.\(itemOrGroup, term\)/);
  assert.match(source, /aria-label=\{t\("results\.seeAllAriaLabel", \{ group: resolveSearchGroupLabel\(group, t\) \}\)\}/);
});

test("portal scope parsing is the shared whitelist parser", async () => {
  const source = await readFile(searchPagePath, "utf8");

  assert.match(source, /readPortalSearchParams/);
  assert.match(source, /readPortalSearchParams\(initialScopeKeys, initialSearchLocationRef\.current\)/);
  assert.match(source, /requestedScope && !validScopeKeys\.has\(requestedScope\) && availableModules\.length === 0/);
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
  assert.match(source, /\.catch\(\(\) => \{[\s\S]*?if \(!cancelled\) \{[\s\S]*?setAiEnabled\(false\)/);
  assert.match(source, /if \(event\.key === "Enter"\) doSearch\(\)/);
  assert.match(source, /onClick=\{\(\) => runAiAsk\(query\)\}/);
  assert.match(source, /askAiWithExecution\(\s*question/);
  assert.match(source, /syncSearchUrl\(question, scope\)/);
  assert.match(source, /setAiQuery\(""\)/);
  assert.match(source, /if \(searchedTerm !== question\)[\s\S]*?setSearchedTerm\(""\)/);
  assert.match(source, /response\?\.status === "retrieval_unavailable"/);
  assert.match(source, /response\?\.status === "generation_unavailable"/);
  assert.match(source, /response\.status === "insufficient_evidence"/);
  assert.match(source, /response\.status === "partial_answer"/);
  assert.match(source, /aiResponseFailed = !aiResponse\?\.metadataCount/);
  assert.match(source, /response\.statisticalResult \? <AiAskStatisticalCard/);
  assert.match(source, /!response\?\.metadataCount && response\?\.status === "ambiguous_scope"/);
  assert.match(source, /t\(item\.relevance === "direct" \? "section\.directRelevance" : "section\.relatedLead"\)/);
  assert.match(source, /onRetry=\{\(\) => runAiAsk\(aiQuery\)\}/);
  assert.match(source, /onCancel=\{cancelAiAsk\}/);
  assert.match(source, /onNavigate\?\.\(target, query\)/);
  assert.match(source, /module: "dwm"[\s\S]*?assetId: item\.assetId/);
});

test("submitted search and AI use one mutually exclusive accessible result panel", async () => {
  const [source, styles] = await Promise.all([
    readFile(searchPagePath, "utf8"),
    readFile(searchStylesPath, "utf8"),
  ]);
  assert.match(source, /role="tablist"[\s\S]*?aria-label=\{t\("portal\.resultTabsAriaLabel"\)\}/);
  assert.match(source, /role="tab"[\s\S]*?id="sp-search-tab"/);
  assert.match(source, /role="tab"[\s\S]*?id="sp-ai-tab"/);
  assert.match(source, /setActiveResultTab\("search"\)/);
  assert.match(source, /setActiveResultTab\("ai"\)/);
  assert.match(source, /id="sp-search-panel"[\s\S]*?hidden=\{activeResultTab !== "search"\}/);
  assert.match(source, /id="sp-ai-panel"[\s\S]*?hidden=\{activeResultTab !== "ai"\}/);
  assert.match(source, /event\.key === "ArrowRight"/);
  assert.match(source, /scrollContainer\.scrollTo\(\{ top: Math\.max\(0, top\), behavior: "smooth" \}\)/);
  assert.match(source, /results\?\.scrollIntoView\(\{ behavior: "smooth", block: "start" \}\)/);
  assert.match(styles, /\.sp-results \{[^}]*scroll-margin-top: 14px/);
});

test("statistics cards identify asset type, exact source and the matching catalog entry", async () => {
  const source = await readFile(searchPagePath, "utf8");
  assert.match(source, /result\.metric === "report_count"/);
  assert.match(source, /t\("statistics\.assetType", \{ type: assetType \}\)/);
  assert.match(source, /t\("statistics\.dataSource", \{ source: sourceLabel \}\)/);
  assert.match(source, /t\("statistics\.scope", \{ filters: filterSummary \|\| t\("statistics\.allCatalog"\) \}\)/);
  assert.match(source, /"statistics\.viewAllReports"/);
  assert.match(source, /"statistics\.viewAllFilteredAssets"/);
});

test("AI answers remain explanatory while only DAP candidate cards navigate responsively", async () => {
  const [source, styles, api] = await Promise.all([
    readFile(searchPagePath, "utf8"),
    readFile(searchStylesPath, "utf8"),
    readFile(fileURLToPath(new URL("../api/aiAsk.ts", import.meta.url)), "utf8"),
  ]);

  assert.match(source, /t\("section\.answerSummaryAriaLabel"\)/);
  assert.match(source, /onNavigate=\{handleNavigate\}/);
  assert.match(source, /t\("section\.candidateDetailAriaLabel", \{ type: t\(isField \? "section\.field" : "section\.table"\)/);
  assert.match(source, /ref: item\.tableName,[\s\S]*?assetId: item\.assetId/);
  assert.match(source, /t\("section\.evidenceSource", \{ reason: item\.matchReason \}\)/);
  assert.match(source, /t\("section\.sourcesTitle"\)/);
  assert.match(source, /selectVerifiedCitedCandidates\(response\.candidates, response\.citations\)/);
  assert.match(source, /item\.relevance === "direct"/);
  assert.match(source, /t\(response\.resultsTruncated \? "section\.partialAnswerTruncated" : "section\.partialAnswerRelated"\)/);
  assert.match(styles, /\.sp-ai-candidate \{[\s\S]*?width: 100%[\s\S]*?min-width: 0/);
  assert.match(styles, /\.sp-ai-candidate-main \{[\s\S]*?overflow-wrap: anywhere/);
  assert.match(styles, /@media \(max-width: 600px\)[\s\S]*?\.sp-ai-candidate \{ padding: 12px/);
  assert.match(api, /suppressTimeoutPayloadLogging: true/);
  assert.doesNotMatch(api, /fetch\(.*AI_LLM|AI_LLM_BASE_URL/);
});

test("AI progress displays real SSE execution, search evidence, authoritative verification, and collapsible status", async () => {
  const [source, panel, detail, summary, grouping, styles, api] = await Promise.all([
    readFile(searchPagePath, "utf8"),
    readFile(executionPanelPath, "utf8"),
    readFile(stepDetailPath, "utf8"),
    readFile(stepSummaryPath, "utf8"),
    readFile(stepGroupingPath, "utf8"),
    readFile(executionStylesPath, "utf8"),
    readFile(executionApiPath, "utf8"),
  ]);

  assert.match(source, /askAiWithExecution\(/);
  assert.match(source, /setAiExecutionEvents\(\(current\) => \[\.\.\.current, event\]\)/);
  assert.match(panel, /open=\{status === "running" \|\| expanded\}/);
  assert.match(panel, /useState\(status === "running"\)/);
  assert.match(panel, /setExpanded\(true\)/);
  assert.match(panel, /previous === "running" && status === "completed"/);
  assert.match(panel, /setExpanded\(false\)/);
  assert.match(panel, /groupSteps\(displayedSteps\)/);
  assert.match(panel, /t\("execution\.summary\.completedVerified"/);
  assert.match(panel, /t\("execution\.summary\.completedWithoutCounts"\)/);
  assert.match(panel, /t\("execution\.summary\.sourcesTraceable"\)/);
  assert.match(panel, /formatSafeAiAskDiagnostics\(events, status, query\)/);
  assert.match(panel, /t\("execution\.copyDebug"\)/);
  assert.match(panel, /t\("execution\.details"\)/);
  assert.match(source, /citationCount=\{response\?\.citations\.length \?\? 0\}/);
  assert.match(panel, /<StepSummary steps=\{displayedSteps\}/);
  assert.match(panel, /<StepDetail steps=\{displayedSteps\}/);
  assert.match(detail, /retrievalMode|effectiveMode/);
  assert.match(detail, /channelsUsed/);
  assert.match(detail, /matchedTerms/);
  assert.match(detail, /verifiedTableCount/);
  assert.match(detail, /step\.id === "metadata-count"/);
  assert.match(detail, /tableCount/);
  assert.match(detail, /reportCount/);
  assert.match(detail, /dap_authoritative_metadata/);
  assert.match(detail, /t\("execution\.detail\.rankingFusion"\)/);
  assert.match(panel, /t\("execution\.cancel"\)/);
  assert.match(summary, /t\("execution\.summary\.identifyConcept"/);
  assert.match(summary, /t\("execution\.summary\.multiRouteRetrieval"/);
  assert.match(summary, /TECHNICAL_TERMS/);
  assert.match(grouping, /export function groupSteps/);
  assert.match(styles, /\.sp-ai-stage-list/);
  assert.match(styles, /\.sp-ai-execution-details/);
  assert.match(styles, /\.sp-ai-execution-collapsed-summary/);
  assert.match(styles, /\.sp-ai-execution-details-link/);
  assert.match(styles, /\.sp-ai-execution-actions/);
  assert.match(api, /requestRemoteEventStream\("\/ai\/ask\/stream"/);
  assert.match(api, /parseAiAskResponse\(data\["response"\]\)/);
  assert.match(api, /event\.requestId !== requestId/);
  assert.match(api, /AbortSignal/);
  assert.doesNotMatch(api, /token|apiKey|baseUrl/i);
  assert.doesNotMatch(api, /setInterval\(/);
  assert.match(styles, /\.sp-ai-execution \{[^}]*background: var\(--surface\)/);
  assert.match(styles, /\.sp-ai-execution-step-failed[\s\S]*?var\(--danger\)/);
});

test("AI execution panel never reports an unreported request count as zero requests", async () => {
  const [panel, detail, source] = await Promise.all([
    readFile(executionPanelPath, "utf8"),
    readFile(stepDetailPath, "utf8"),
    readFile(searchPagePath, "utf8"),
  ]);

  // 请求次数必须走统一口径，未知不得冒充 0 次。
  assert.match(detail, /from "\.\.\/api\/aiAskExecutionSummary\.ts"/);
  assert.match(detail, /requestCountEvidence\(data\)/);
  assert.match(detail, /requestCountReported/);
  assert.match(detail, /execution\.detail\.requestCountUnreportedNote/);
  assert.doesNotMatch(detail, /requestCount \?\? 0/);

  // 未收到后端 done 时不得直接断言后端检索失败。
  assert.match(panel, /receivedTerminalEvent\(events\)/);
  assert.match(panel, /t\("execution\.missingTerminalEvent"\)/);

  // 前端契约解析失败与后端失败必须可区分。
  assert.match(source, /AiAskExecutionContractError/);
  assert.match(source, /t\("failures\.contractError", \{ message: error\.message \}\)/);
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
  assert.match(source, /sp-business-group-title">\{t\("results\.assetGroupTitle"\)\}/);
  assert.match(source, /!searchLoading && !searchError \? \([\s\S]*?<RagRecommendationsSection/);
  assert.match(source, /t\("recommendations\.title"\)/);
  assert.doesNotMatch(source, /智能解答|关键词检索|向量检索|混合检索|检索模式/);
  assert.match(api, /status: 'disabled'[\s\S]*recommendations: \[\]/);
  assert.match(api, /suppressUnauthorizedEvent: true/);
  assert.doesNotMatch(api, /similarityScore|confidenceScore|retrievalScore/);
});
