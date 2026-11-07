import { expect, test, type Page } from "@playwright/test";

const ASSET_ID = 42;
const FIELD_ID = 99;
const longName = `SYNTHETIC_${"VERY_LONG_ASSET_IDENTIFIER_".repeat(7)}`.slice(0, 220);
const longField = `BALANCE_${"LONG_FIELD_IDENTIFIER_".repeat(8)}`.slice(0, 240);

function candidate() {
  return {
    assetId: ASSET_ID,
    fieldId: FIELD_ID,
    assetType: "field",
    tableName: longName,
    tableDisplayName: "合成账户余额表（响应式长名称）",
    tableDescription: "使用完全合成的元数据验证长描述不会造成横向溢出。".repeat(5),
    fieldName: longField,
    fieldDisplayName: "账户余额金额字段",
    fieldDescription: "合成字段含义；用于浏览器布局和来源展示验证。".repeat(5),
    domain: "合成账户主题域",
    layer: "DWS",
    source: "dap_catalog",
    matchReason: "字段、所属表和稳定 ID 均来自本测试的 DAP 目录 fixture。",
    relevance: "direct",
  };
}

function answer(query: string) {
  const isList = /有哪些|列出|清单/.test(query);
  return {
    status: isList ? "partial_answer" : "answered",
    answer: isList
      ? `本次检索确认部分资产：${longName}，字段 ${longField}。以上仅为本次检索确认的部分资产，不代表完整清单。`
      : `已根据合成目录为“${query}”找到相关候选，请核对下方 DAP 资产卡片。`,
    citations: [{ assetId: ASSET_ID, fieldId: FIELD_ID, source: "dap_catalog" }],
    candidates: [candidate()],
    retrievalStatus: "available",
    generationStatus: "completed",
    resultsTruncated: isList,
    reasonCode: isList ? "partial_results" : null,
    elapsedMs: 12,
  };
}

function sseResponse(response: ReturnType<typeof answer> | Record<string, unknown>, query: string) {
  const events: string[] = [];
  const requestId = "0123456789abcdef0123456789abcdef";
  const emit = (event: string, stepId: string, message: string, data: Record<string, unknown> = {}) => {
    events.push(`event: ${event}\ndata: ${JSON.stringify({
      request_id: requestId,
      step_id: stepId,
      timestamp: "2026-01-01T00:00:00.000Z",
      message,
      data,
    })}\n\n`);
  };
  const stage = (stepId: string, message: string, data: Record<string, unknown> = {}) => {
    emit("step_start", stepId, message, data);
    emit("step_complete", stepId, message, data);
  };
  const hasCandidates = Array.isArray(response.candidates) && response.candidates.length > 0;
  const isMetadataCountStatus = [
    "metadata_count_answered", "ambiguous_scope", "metadata_count_unavailable",
  ].includes(String(response.status));
  if (isMetadataCountStatus) {
    const evidence = typeof response.metadataCount === "object" && response.metadataCount !== null
      ? response.metadataCount as { value?: unknown }
      : null;
    const tableCount = Number.isSafeInteger(evidence?.value) ? Number(evidence?.value) : undefined;
    if (response.status === "metadata_count_answered" && tableCount !== undefined) {
      stage("metadata-count", "DAP 目录精确 COUNT 已完成。", { intent: "metadata_count", tableCount });
    } else {
      emit("step_start", "metadata-count", "正在按当前 DAP 目录确认统计口径。", { intent: "metadata_count" });
      emit("step_error", "metadata-count", "未能确认可核实的统计数值。", {
        intent: "metadata_count",
        errorCode: typeof response.reasonCode === "string" ? response.reasonCode : "unavailable",
      });
    }
  } else {
    stage("planning", "已完成问题分析与查询规划。", {
      originalQuery: query,
      queryType: "natural_language",
      keyConcepts: ["合成账户余额"],
      queries: [query],
      planningMode: "structured_llm",
      fallbackReason: null,
    });
    if (response.status === "retrieval_unavailable") {
      emit("step_start", "rag-round-1", "开始第 1 轮检索。", { round: 1, queryCount: 1, maxRequests: 3 });
      emit("step_error", "rag-round-1", "资产检索暂不可用。", {
        round: 1,
        queryCount: 1,
        requestCount: 0,
        errorCode: response.reasonCode === "retrieval_timeout" ? "timeout" : "unavailable",
      });
    } else {
      stage("rag-round-1", "首轮检索结束。", {
        round: 1, queryCount: 1, requestCount: 1, resultCount: hasCandidates ? 1 : 0,
      });
      const searchId = "0123456789abcdef";
      const hit = hasCandidates ? {
        rank: 1,
        assetId: ASSET_ID,
        fieldId: FIELD_ID,
        entityType: "field",
        name: longField,
        retrievalChannels: ["vector", "bm25"],
        matchedTerms: ["合成余额字段", "真实命中词"],
      } : null;
      emit("step_start", `search-${searchId}`, `检索：${query}`, {
        searchId, query, round: 1, status: "running", requestCount: 1,
        retrievalMode: "auto", startedAt: "2026-01-01T00:00:00.000Z",
      });
      emit("step_complete", `search-${searchId}`, `检索完成：${query}`, {
        searchId, query, round: 1, requestCount: 1, resultCount: hasCandidates ? 1 : 0,
        verifiedCount: hasCandidates ? 1 : 0, effectiveMode: "hybrid", requestedMode: "auto",
        channelsUsed: hasCandidates ? ["vector", "bm25"] : [], hits: hit ? [hit] : [], status: "available",
      });
      stage("merge", "已按跨查询排名融合合并并去重候选。", {
        requestCount: 1, retrievalRounds: 1, resultCount: hasCandidates ? 1 : 0,
        deduplicatedCount: hasCandidates ? 1 : 0, selectedAssetIds: hasCandidates ? [ASSET_ID] : [],
        fusionMethod: "reciprocal_rank_fusion",
      });
      if (hasCandidates) {
        stage("verification", "权威资产明细核实完成。", {
          verifiedTableCount: 1, verifiedFieldCount: 1, candidateCount: 1,
          source: "dap_authoritative_metadata",
        });
        stage("asset-42", `已读取资产明细：${longName}`, {
          assetId: ASSET_ID, tableName: longName, fieldCount: 1, source: "dap_authoritative_metadata",
        });
        stage("field-42-99", `已核实字段：${longField}`, {
          assetId: ASSET_ID, fieldId: FIELD_ID, fieldName: longField,
          tableName: longName, source: "dap_authoritative_metadata",
        });
      }
      if (response.generationStatus !== "not_run") {
        if (response.status === "generation_unavailable") {
          emit("step_start", "generating", "正在生成回答。", { evidenceCount: hasCandidates ? 1 : 0 });
          emit("step_error", "generating", "模型生成回答失败。", {
            errorCode: response.reasonCode === "llm_timeout" ? "llm_timeout" : "unavailable",
          });
        } else {
          stage("generating", "模型已基于已核实证据完成回答。", { evidenceCount: hasCandidates ? 1 : 0 });
        }
      }
    }
  }
  emit("answer", "answer", "已完成问答并返回可信证据。", { response });
  emit("done", "done", "问答执行完成。", {
    status: response.status === "answered" || response.status === "partial_answer" || response.status === "insufficient_evidence" || response.status === "metadata_count_answered"
      ? "completed"
      : "failed",
  });
  return { status: 200, contentType: "text/event-stream", body: `: keep-alive\n\n${events.join("")}` };
}

async function mockPortalApis(page: Page, options: {
  aiEnabled?: boolean;
  askFailureCount?: number;
  delayFirstAsk?: boolean;
  recommendationCount?: number;
  holdMenus?: boolean;
} = {}) {
  const asked: Array<{ query: string; scope: string; topK: number }> = [];
  const searches: Array<{ query: string; scope: string }> = [];
  let notifyMenuRequest: () => void = () => {};
  let releaseMenuResponse: () => void = () => {};
  const menuRequestStarted = new Promise<void>((resolve) => { notifyMenuRequest = resolve; });
  const menuResponseGate = new Promise<void>((resolve) => { releaseMenuResponse = resolve; });
  let aiEnabled = options.aiEnabled ?? true;
  let askFailuresRemaining = options.askFailureCount ?? 0;

  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (!path.startsWith("/api/")) return route.continue();
    const json = (body: unknown, status = 200) => route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });

    if (path === "/api/auth/me") return json({ message: "anonymous" }, 401);
    if (path === "/api/public-catalog/config") return json({ profile: "internal", exportEnabled: false });
    if (path === "/api/system/menus") {
      notifyMenuRequest();
      if (options.holdMenus) await menuResponseGate;
      return json({ items: [{
        id: "1", code: "dwm", name: "数据仓库", path: "/data-warehouse",
        icon: "database", order: 1, status: "enabled", adminOnly: false,
        desc: "合成浏览器测试菜单", navPlacement: "primary",
      }] });
    }
    if (path === "/api/portal/stats") return json({ items: [] });
    if (path === "/api/search/hot-keywords") return json({ items: [] });
    if (path === "/api/search/recommendations") {
      const query = url.searchParams.get("q") || "";
      const recommendations = Array.from({ length: options.recommendationCount ?? 0 }, (_, index) => ({
        assetId: 100 + index,
        assetType: "table",
        name: `SYNTHETIC_RECOMMENDATION_${index + 1}`,
        displayName: `合成推荐资产 ${index + 1}`,
        description: "仅用于验证搜索与问答 Tab 互斥显示。",
        domain: "合成主题域",
        layer: "DWS",
        evidence: ["合成测试依据"],
      }));
      return json({
        query,
        status: recommendations.length ? "available" : "disabled",
        recommendations,
        count: recommendations.length,
        elapsedMs: 0,
        reasonCode: recommendations.length ? null : "disabled",
      });
    }
    if (path === "/api/ai/status") return json({ enabled: aiEnabled });
    if (path === "/api/ai/ask/stream") {
      const payload = route.request().postDataJSON() as { query: string; scope: string; topK: number };
      asked.push(payload);
      if (payload.query.includes("deterministic-count")) {
        return route.fulfill(sseResponse({
          status: "metadata_count_answered",
          answer: "当前 DAP 目录中，合成主题域、数据集市层共有 118 张数据表。",
          citations: [], candidates: [],
          retrievalStatus: "not_run", generationStatus: "not_run", resultsTruncated: false,
          elapsedMs: 3,
          metadataCount: {
            metric: "table_count", value: 118,
            filters: {
              domain: { code: "SYN521", displayName: "合成主题域", matchedAs: "catalog_value", inferred: false },
              layer: { code: "DM", displayName: "数据集市层", matchedAs: "catalog_alias", inferred: true },
            },
            source: "dap_catalog", complete: true, catalogProfile: "strict",
            sourceLink: "/data-warehouse?domain=%E5%90%88%E6%88%90%E4%B8%BB%E9%A2%98%E5%9F%9F&layer=DM",
          },
        }));
      }
      if (payload.query.includes("ambiguous-metadata-count")) {
        return route.fulfill(sseResponse({
          status: "ambiguous_scope",
          answer: "无法从当前 DAP 目录唯一确认统计范围，请明确主题域或数据分层后重试。",
          citations: [], candidates: [], retrievalStatus: "not_run", generationStatus: "not_run",
          resultsTruncated: false, reasonCode: "ambiguous_scope", elapsedMs: 3,
        }));
      }
      if (options.delayFirstAsk && (payload.query.includes("cancel-first") || payload.query.includes("slow-old"))) {
        // Wide enough that the "still running" window survives tab switching,
        // summary toggling and assertions on slower engines (WebKit), where the
        // same steps take noticeably longer than in Chromium.
        await new Promise((resolve) => setTimeout(resolve, 2500));
        try {
          return await route.fulfill(sseResponse(answer(payload.query), payload.query));
        } catch {
          return;
        }
      }
      if (askFailuresRemaining > 0 && payload.query.includes("retry")) {
        askFailuresRemaining -= 1;
        return json({ error: { code: "MOCK_PROVIDER_UNAVAILABLE", message: "Mock provider unavailable" } }, 503);
      }
      if (payload.query.includes("未登记")) {
        return route.fulfill(sseResponse({
          status: "insufficient_evidence",
          answer: "当前元数据不足以确认。",
          citations: [], candidates: [],
          retrievalStatus: "available", generationStatus: "not_run", resultsTruncated: false,
          reasonCode: "insufficient_evidence", elapsedMs: 3,
        }, payload.query));
      }
      if (payload.query.includes("timeout")) {
        return route.fulfill(sseResponse({
          status: "generation_unavailable",
          answer: "AI 问答暂不可用，请稍后重试。",
          citations: [], candidates: [],
          retrievalStatus: "available", generationStatus: "unavailable", resultsTruncated: false,
          reasonCode: "llm_timeout", elapsedMs: 12000,
        }, payload.query));
      }
      return route.fulfill(sseResponse(answer(payload.query), payload.query));
    }
    if (path === "/api/search") {
      const query = url.searchParams.get("q") || "";
      const scope = url.searchParams.get("scope") || "all";
      searches.push({ query, scope });
      if (query.includes("search-error")) {
        return json({ error: { code: "SEARCH_UNAVAILABLE", message: "传统搜索暂不可用" } }, 503);
      }
      if (query.includes("未登记") || query.includes("no-match")) {
        return json({ query, scope, groups: [], total: 0, partial: false, failedGroups: [] });
      }
      return json({
        query,
        scope: url.searchParams.get("scope") || "all",
        groups: [{
          type: "asset", label: "资产", module: "dwm", count: 1, hasMore: false,
          items: [{
            id: `asset:${ASSET_ID}`, title: longName,
            subtitle: "合成 DAP 目录表", meta: "合成账户主题域 / DWS",
            module: "dwm", ref: longName, type: "asset", category: "资产",
            assetId: ASSET_ID, matchedFields: [],
          }],
        }],
        total: 1,
        partial: false,
        failedGroups: [],
      });
    }
    if (path === "/api/assets/42") {
      return json({ data: { assetId: ASSET_ID, name: longName, cn: "合成账户余额表", fields: [] } });
    }
    return json({ items: [] });
  });
  return {
    asked,
    searches,
    waitForMenuRequest: () => menuRequestStarted,
    releaseMenus: () => releaseMenuResponse(),
    setAiEnabled(value: boolean) { aiEnabled = value; },
  };
}

async function openAiPortal(page: Page, options?: { aiEnabled?: boolean; askFailureCount?: number; delayFirstAsk?: boolean; recommendationCount?: number; holdMenus?: boolean }, path = "/") {
  const fixtures = await mockPortalApis(page, options);
  await page.addInitScript(() => {
    localStorage.removeItem("dap_auth");
    sessionStorage.removeItem("dap_auth");
  });
  await page.goto(path);
  await expect(page.getByRole("heading", { name: "数据资产管理与血缘分析平台" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "搜索数据资产" })).toBeVisible();
  return fixtures;
}

async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    candidate: document.querySelector(".sp-ai-candidate")?.getBoundingClientRect().right ?? 0,
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.candidate).toBeLessThanOrEqual(dimensions.viewport);
}

test("Enter and Search stay deterministic; explicit AI preserves query and opens the verified asset", async ({ page }, testInfo) => {
  const fixtures = await openAiPortal(page);
  const input = page.getByRole("textbox", { name: "搜索数据资产" });
  const query = "candidate account balance";
  await input.fill(query);
  await input.press("Enter");
  await expect(page.locator(".sp-hit").first()).toBeVisible();
  expect(fixtures.asked).toEqual([], "Enter must not call the AI endpoint");

  await page.getByRole("button", { name: "问 AI", exact: true }).click();
  const aiTab = page.getByRole("tab", { name: /AI 问答/ });
  await expect(aiTab).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#sp-search-panel .sp-hit").first()).toBeHidden({ timeout: 3000 });
  await expect(page.getByLabel("AI 回答摘要")).toContainText(query);
  await expect(page.getByRole("region", { name: "已核实引用来源" })).toBeVisible();
  const progress = page.locator(".sp-ai-execution");
  await expect(progress).not.toHaveAttribute("open", "");
  await expect(progress.locator(":scope > summary")).toContainText("已核实 1 张表 · 1 个字段 · 来源可追溯");
  await expect(progress.locator(":scope > summary")).toContainText("查看详细过程");
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.screenshot({ path: testInfo.outputPath("ai-ask-summary-light-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("ai-ask-summary-light-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 960 });
  await progress.locator(":scope > summary").click();
  await expect(progress).toContainText("已完成");
  await progress.locator(".sp-ai-execution-details > summary").click();
  await expect(progress).toContainText("已读取 1 张表，核实 1 个字段。");
  await expect(progress.locator(".sp-ai-execution-details")).toHaveAttribute("open", "");
  await page.screenshot({ path: testInfo.outputPath("ai-ask-full-steps-light-desktop.png"), fullPage: true });
  await page.getByRole("button", { name: "切换到深色主题" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({ path: testInfo.outputPath("ai-ask-full-steps-dark-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("ai-ask-full-steps-dark-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.getByRole("button", { name: "切换到浅色主题" }).click();
  await page.getByRole("tab", { name: /搜索结果/ }).click();
  await expect(page.locator(".sp-hit").first()).toBeVisible();
  await page.getByRole("tab", { name: /AI 问答/ }).click();
  await expect(page.getByLabel("AI 回答摘要")).toContainText(query);
  expect(fixtures.asked).toHaveLength(1, "Tab switching must not repeat the model request");
  expect(fixtures.searches).toHaveLength(1, "Tab switching must not repeat traditional search");
  expect(fixtures.asked[0]).toEqual({ query, scope: "all", topK: 10 });
  await expect(input).toHaveValue(query);
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.screenshot({ path: testInfo.outputPath("search-ai-tabs-answer-1440.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath("search-ai-tabs-answer-390.png"), fullPage: true });

  for (const width of [1920, 1440, 1280, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expectNoHorizontalOverflow(page);
  }

  await page.getByRole("button", { name: `查看字段详情：${longField}` }).click();
  await expect(page).toHaveURL(/\/data-warehouse(?:\/|\?)/);
  await expect(page).toHaveURL(new RegExp(`assetId=${ASSET_ID}`));
});

test("existing q/scope URL filters restore the traditional search result mode", async ({ page }) => {
  const query = "candidate account balance";
  const fixtures = await openAiPortal(page, undefined, `/?q=${encodeURIComponent(query)}&scope=asset`);
  const input = page.getByRole("textbox", { name: "搜索数据资产" });
  await expect(input).toHaveValue(query);
  await expect(page.getByRole("group", { name: "搜索范围" }).getByRole("button", { name: "资产", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("tab", { name: /搜索结果/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#sp-search-panel .sp-hit").first()).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe(query);
  await expect.poll(() => new URL(page.url()).searchParams.get("scope")).toBe("asset");
  expect(fixtures.searches.some((item) => item.query === query && item.scope === "asset")).toBe(true);
});

test("clearing a scoped deep-link before menus load does not restore its initial query", async ({ page }) => {
  const query = "candidate account balance";
  const fixtures = await openAiPortal(
    page,
    { holdMenus: true },
    `/?q=${encodeURIComponent(query)}&scope=asset`,
  );
  await fixtures.waitForMenuRequest();

  const input = page.getByRole("textbox", { name: "搜索数据资产" });
  await expect(input).toHaveValue(query);
  await input.fill("");
  await input.press("Enter");
  await expect(input).toHaveValue("");
  await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBeNull();

  fixtures.releaseMenus();
  await expect(page.getByRole("button", { name: "资产", exact: true })).toBeVisible();
  await expect(input).toHaveValue("");
  await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBeNull();
  expect(fixtures.searches).toHaveLength(0);
});

test("list answer is explicitly partial and keeps verified table/field references clickable", async ({ page }) => {
  await openAiPortal(page);
  const input = page.getByRole("textbox", { name: "搜索数据资产" });
  await input.fill("我们行有哪些存款字段和表？");
  await page.getByRole("button", { name: "问 AI", exact: true }).click();

  await expect(page.getByLabel("AI 部分回答")).toContainText("不代表完整清单");
  await expect(page.getByRole("status")).toContainText("有界检索结果可能不完整");
  const sources = page.getByRole("region", { name: "已核实引用来源" });
  await expect(sources).toBeVisible();
  await expect(sources).toContainText("已核实引用");
  await expect(page.getByRole("button", { name: `查看字段详情：${longField}` })).toBeVisible();
});

test("safe diagnostics copy excludes user text, asset names, and arbitrary event data", async ({ page }) => {
  await page.addInitScript(() => {
    const pageWindow = window as Window & { __copiedDiagnostics?: string };
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text: string) => { pageWindow.__copiedDiagnostics = text; } },
    });
  });
  await openAiPortal(page);
  const privateQuery = "PRIVATE_PROMPT_DO_NOT_COPY";
  await page.getByRole("textbox", { name: "搜索数据资产" }).fill(privateQuery);
  await page.getByRole("button", { name: "问 AI", exact: true }).click();
  await expect(page.getByLabel("AI 回答摘要")).toBeVisible();
  const execution = page.locator(".sp-ai-execution-shell");
  await execution.getByRole("button", { name: "复制排查信息" }).click();
  await expect(execution.getByText("已复制排查信息")).toBeVisible();

  const copied = await page.evaluate(() => (window as Window & { __copiedDiagnostics?: string }).__copiedDiagnostics || "");
  expect(copied).toContain("dap-ai-ask-diagnostics-v1");
  expect(copied).toContain("requestCount");
  expect(copied).not.toContain(privateQuery);
  expect(copied).not.toContain(longName);
  expect(copied).not.toContain(longField);
  expect(copied).not.toContain("matchedTerms");
});

test("true zero-match offers AI with the existing query; no-evidence refusal is explicit", async ({ page }) => {
  const fixtures = await openAiPortal(page);
  const query = "未登记业务字段在哪里？";
  const input = page.getByRole("textbox", { name: "搜索数据资产" });
  await input.fill(query);
  await page.getByRole("button", { name: "搜索" }).click();
  await expect(page.getByRole("heading", { name: "没有找到精确匹配的资产" })).toBeVisible();
  await page.getByRole("button", { name: "问 AI 找资产" }).click();
  await expect(page.getByText("当前元数据不足以确认。", { exact: true })).toBeVisible();
  const progress = page.locator(".sp-ai-execution");
  await progress.locator(":scope > summary").click();
  await expect(progress).toContainText("跨查询去重后保留 0 个候选资产身份。");
  await expect(progress).not.toContainText("模型已基于");
  expect(fixtures.asked[0]?.query).toBe(query);
  await expect(input).toHaveValue(query);
});

test("zero matches with five recommendations switches to AI without stacking or late scrolling", async ({ page }, testInfo) => {
  const fixtures = await openAiPortal(page, { recommendationCount: 5 });
  const query = "no-match recommendation query";
  const input = page.getByRole("textbox", { name: "搜索数据资产" });
  await input.fill(query);
  await page.getByRole("button", { name: "搜索" }).click();
  await expect(page.getByRole("heading", { name: "没有找到精确匹配的资产" })).toBeVisible();
  await expect(page.locator(".sp-rag-hit")).toHaveCount(5);

  await page.getByRole("button", { name: "问 AI 找资产" }).click();
  await expect(page.getByRole("tab", { name: /AI 问答/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#sp-search-panel .sp-rag-hit").first()).toBeHidden();
  await expect(page.getByLabel("AI 回答摘要")).toContainText(query);
  await expect.poll(() => page.evaluate(() => {
    const main = document.querySelector(".main")?.getBoundingClientRect();
    const results = document.querySelector(".sp-results")?.getBoundingClientRect();
    return main && results ? results.top - main.top : Number.POSITIVE_INFINITY;
  })).toBeLessThan(36);
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.screenshot({ path: testInfo.outputPath("search-ai-tabs-no-stack-1440.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("search-ai-tabs-no-stack-390.png"), fullPage: true });
  expect(fixtures.asked.map((item) => item.query)).toEqual([query]);
  expect(fixtures.searches).toHaveLength(1);
});

test("switching tabs during an AI request preserves running state and sends one request", async ({ page }) => {
  const fixtures = await openAiPortal(page, { delayFirstAsk: true });
  const query = "cancel-first running query";
  await page.getByRole("textbox", { name: "搜索数据资产" }).fill(query);
  await page.getByRole("button", { name: "问 AI", exact: true }).click();
  await expect(page.getByRole("button", { name: "取消问答" })).toBeVisible();
  await expect(page.locator(".sp-ai-execution")).toHaveAttribute("open", "");
  await page.getByRole("tab", { name: /搜索结果/ }).click();
  await expect(page.getByText("尚未对“cancel-first running query”执行传统搜索。")).toBeVisible();
  await page.getByRole("tab", { name: /AI 问答/ }).click();
  await expect(page.getByRole("button", { name: "取消问答" })).toBeVisible();
  expect(fixtures.asked).toHaveLength(1);
  await expect(page.getByLabel("AI 回答摘要")).toContainText(query);
  expect(fixtures.asked).toHaveLength(1);
});

test("execution stays expanded while running and auto-collapses with a detailed-process entry", async ({ page }) => {
  await openAiPortal(page, { delayFirstAsk: true });
  const input = page.getByRole("textbox", { name: "搜索数据资产" });
  await input.fill("slow-old auto-collapse question");
  await page.getByRole("button", { name: "问 AI", exact: true }).click();
  const progress = page.locator(".sp-ai-execution");
  await expect(progress).toHaveAttribute("open", "");
  await expect(page.getByRole("button", { name: "取消问答" })).toBeVisible();
  await progress.locator(":scope > summary").click();
  await expect(progress).toHaveAttribute("open", "");
  await expect(page.getByLabel("AI 回答摘要")).toContainText("slow-old auto-collapse question");
  await expect(progress).not.toHaveAttribute("open", "");
  await expect(progress.locator(":scope > summary")).toContainText("查看详细过程");
  await progress.locator(":scope > summary").click();
  await expect(progress).toHaveAttribute("open", "");
  await expect(progress.locator(".sp-ai-stage-list > li")).toHaveCount(4);
  const fullSteps = progress.locator(".sp-ai-execution-details");
  await expect(fullSteps).not.toHaveAttribute("open", "");
  await fullSteps.locator(":scope > summary").click();
  await expect(fullSteps).toHaveAttribute("open", "");
  await expect(progress).toContainText("RRF");
});

test("a running progress expansion never prevents automatic collapse after completion", async ({ page }) => {
  await openAiPortal(page, { delayFirstAsk: true });
  const input = page.getByRole("textbox", { name: "搜索数据资产" });
  await input.fill("slow-old expanded auto-collapse question");
  await page.getByRole("button", { name: "问 AI", exact: true }).click();
  const progress = page.locator(".sp-ai-execution");
  await expect(progress).toHaveAttribute("open", "");
  await expect(progress.locator(".sp-ai-stage-list > li")).toHaveCount(4);
  await expect(page.getByLabel("AI 回答摘要")).toContainText("slow-old expanded auto-collapse question");
  await expect(progress).not.toHaveAttribute("open", "");
  await expect(progress.locator(":scope > summary")).toContainText("查看详细过程");
});

test("a new AI question supersedes a slow old response without relabeling", async ({ page }) => {
  const fixtures = await openAiPortal(page, { delayFirstAsk: true });
  const input = page.getByRole("textbox", { name: "搜索数据资产" });
  await input.fill("slow-old question");
  const askButton = page.getByRole("button", { name: "问 AI", exact: true });
  await askButton.click();
  await expect(page.getByRole("button", { name: "取消问答" })).toBeVisible();
  await expect(askButton).toBeDisabled();

  await input.fill("new question after old request");
  await expect(askButton).toBeEnabled();
  await askButton.click();
  await expect.poll(() => fixtures.asked.length).toBe(2);
  await expect(page.getByLabel("AI 回答摘要")).toContainText("new question after old request");
  await page.waitForTimeout(1100);
  await expect(page.getByText("问答问题：new question after old request")).toBeVisible();
  await expect(page.getByLabel("AI 回答摘要")).toContainText("new question after old request");
  await expect(page.getByLabel("AI 回答摘要")).not.toContainText("slow-old question");
  expect(fixtures.asked.map((item) => item.query)).toEqual([
    "slow-old question", "new question after old request",
  ]);
});

test("future deterministic catalog counts render as structured evidence without RAG citations", async ({ page }) => {
  await openAiPortal(page);
  await page.getByRole("textbox", { name: "搜索数据资产" }).fill("deterministic-count question");
  await page.getByRole("button", { name: "问 AI", exact: true }).click();
  const statistic = page.getByRole("region", { name: "确定性统计结果" });
  await expect(statistic).toContainText("118 张表");
  await expect(statistic).toContainText("主题域=合成主题域");
  await expect(statistic).toContainText("数据分层=数据集市层");
  await expect(statistic.getByRole("link", { name: "查看筛选后的全部资产" })).toHaveAttribute("href", /\/data-warehouse\?/);
  await expect(page.locator(".sp-ai-candidate")).toHaveCount(0);
  const progress = page.locator(".sp-ai-execution");
  await progress.locator(":scope > summary").click();
  await expect(progress).toContainText("DAP 目录精确 COUNT：118 张表");
  await expect(page.getByRole("tab", { name: /AI 问答/ })).toContainText("已完成");
});

test("ambiguous authoritative count stays an explicit failure without a numeric result", async ({ page }) => {
  await openAiPortal(page);
  await page.getByRole("textbox", { name: "搜索数据资产" }).fill("ambiguous-metadata-count question");
  await page.getByRole("button", { name: "问 AI", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("无法从当前 DAP 目录唯一确认统计范围");
  await expect(page.getByRole("region", { name: "确定性统计结果" })).toHaveCount(0);
  await expect(page.locator(".sp-ai-candidate")).toHaveCount(0);
  await expect(page.getByRole("tab", { name: /AI 问答/ })).toContainText("执行失败");
});

test("AI disabled or failed status hides the action; ordinary search failure is not an empty state", async ({ page }) => {
  await openAiPortal(page, { aiEnabled: false });
  const input = page.getByRole("textbox", { name: "搜索数据资产" });
  await input.fill("search-error");
  await page.getByRole("button", { name: "搜索" }).click();
  await expect(page.getByText("传统搜索暂不可用")).toBeVisible();
  await expect(page.getByRole("button", { name: "问 AI", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "问 AI 找资产" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "没有找到精确匹配的资产" })).toHaveCount(0);
});

test("model timeout is distinguished and transient ask errors can be retried", async ({ page }) => {
  const fixtures = await openAiPortal(page, { askFailureCount: 1 });
  const input = page.getByRole("textbox", { name: "搜索数据资产" });
  await input.fill("timeout question");
  await page.getByRole("button", { name: "问 AI", exact: true }).click();
  await expect(page.getByText("模型生成超时，未生成回答", { exact: false })).toBeVisible();
  await expect(page.getByText("llm_timeout", { exact: false })).toHaveCount(0);
  const timeoutAlert = page.locator(".sp-ai-group [role=alert]");
  await expect(timeoutAlert).toBeVisible();
  const progress = page.locator(".sp-ai-execution");
  await expect(progress).toHaveAttribute("open", "");
  const failurePrecedesProgress = await page.evaluate(() => {
    const alert = document.querySelector(".sp-ai-group [role=alert]");
    const progress = document.querySelector(".sp-ai-execution");
    return Boolean(alert && progress && (alert.compareDocumentPosition(progress) & Node.DOCUMENT_POSITION_FOLLOWING));
  });
  expect(failurePrecedesProgress).toBe(true, "AI failures should be announced before execution details");
  await expect(timeoutAlert).not.toContainText("llm_timeout");

  await input.fill("retry candidate");
  await page.getByRole("button", { name: "问 AI", exact: true }).click();
  await expect(page.getByRole("button", { name: "重试" })).toBeVisible();
  await page.getByRole("button", { name: "重试" }).click();
  await expect(page.getByLabel("AI 回答摘要")).toBeVisible();
  expect(fixtures.asked).toHaveLength(3);
});

test("cancelled requests are explicit and cannot overwrite a subsequent answer", async ({ page }) => {
  const fixtures = await openAiPortal(page, { delayFirstAsk: true });
  const input = page.getByRole("textbox", { name: "搜索数据资产" });
  await input.fill("cancel-first question");
  await page.getByRole("button", { name: "问 AI", exact: true }).click();
  await expect(page.getByRole("button", { name: "取消问答" })).toBeVisible();
  await page.getByRole("button", { name: "取消问答" }).click();
  await expect(page.getByText("问答已取消。", { exact: true })).toBeVisible();
  await expect(page.locator(".sp-ai-execution")).toHaveAttribute("open", "");

  await input.fill("replacement question");
  await page.getByRole("button", { name: "问 AI", exact: true }).click();
  await expect(page.getByLabel("AI 回答摘要")).toContainText("replacement question");
  expect(fixtures.asked.map((item) => item.query)).toEqual([
    "cancel-first question", "replacement question",
  ]);
});
