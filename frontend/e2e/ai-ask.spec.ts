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
  stage("planning", "已完成问题分析与查询规划。", {
    originalQuery: query,
    queryType: "natural_language",
    keyConcepts: ["合成账户余额"],
    queries: [query],
    planningMode: "structured_llm",
    fallbackReason: null,
  });
  const hasCandidates = Array.isArray(response.candidates) && response.candidates.length > 0;
  stage("rag-round-1", "首轮检索结束。", { round: 1, queryCount: 1, requestCount: 1, resultCount: hasCandidates ? 1 : 0 });
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
    stage("generating", response.generationStatus === "completed" ? "模型已基于已核实证据完成回答。" : "模型生成回答失败。", {
      evidenceCount: hasCandidates ? 1 : 0,
      errorCode: response.reasonCode === "llm_timeout" ? "llm_timeout" : undefined,
    });
  }
  emit("answer", "answer", "已完成问答并返回可信证据。", { response });
  emit("done", "done", "问答执行完成。", {
    status: response.status === "answered" || response.status === "partial_answer" || response.status === "insufficient_evidence" ? "completed" : "failed",
  });
  return { status: 200, contentType: "text/event-stream", body: `: keep-alive\n\n${events.join("")}` };
}

async function mockPortalApis(page: Page, options: {
  aiEnabled?: boolean;
  askFailureCount?: number;
  delayFirstAsk?: boolean;
} = {}) {
  const asked: Array<{ query: string; scope: string; topK: number }> = [];
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
      return json({ items: [{
        id: "1", code: "dwm", name: "数据仓库", path: "/data-warehouse",
        icon: "database", order: 1, status: "enabled", adminOnly: false,
        desc: "合成浏览器测试菜单", navPlacement: "primary",
      }] });
    }
    if (path === "/api/portal/stats") return json({ items: [] });
    if (path === "/api/search/hot-keywords") return json({ items: [] });
    if (path === "/api/search/recommendations") {
      return json({ query: url.searchParams.get("q") || "", status: "disabled", recommendations: [], count: 0, elapsedMs: 0, reasonCode: "disabled" });
    }
    if (path === "/api/ai/status") return json({ enabled: aiEnabled });
    if (path === "/api/ai/ask/stream") {
      const payload = route.request().postDataJSON() as { query: string; scope: string; topK: number };
      asked.push(payload);
      if (options.delayFirstAsk && payload.query.includes("cancel-first")) {
        await new Promise((resolve) => setTimeout(resolve, 500));
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
      if (query.includes("search-error")) {
        return json({ error: { code: "SEARCH_UNAVAILABLE", message: "传统搜索暂不可用" } }, 503);
      }
      if (query.includes("未登记")) {
        return json({ query, scope: "all", groups: [], total: 0, partial: false, failedGroups: [] });
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
    setAiEnabled(value: boolean) { aiEnabled = value; },
  };
}

async function openAiPortal(page: Page, options?: { aiEnabled?: boolean; askFailureCount?: number; delayFirstAsk?: boolean }) {
  const fixtures = await mockPortalApis(page, options);
  await page.addInitScript(() => {
    localStorage.removeItem("dap_auth");
    sessionStorage.removeItem("dap_auth");
  });
  await page.goto("/");
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

test("Enter and Search stay deterministic; explicit AI preserves query and opens the verified asset", async ({ page }) => {
  const fixtures = await openAiPortal(page);
  const input = page.getByRole("textbox", { name: "搜索数据资产" });
  const query = "candidate account balance";
  await input.fill(query);
  await input.press("Enter");
  await expect(page.locator(".sp-hit").first()).toBeVisible();
  expect(fixtures.asked).toEqual([], "Enter must not call the AI endpoint");

  await page.getByRole("button", { name: "问 AI", exact: true }).click();
  await expect(page.getByLabel("AI 回答摘要")).toContainText(query);
  await expect(page.getByText("答案引用的目录资产", { exact: true })).toBeVisible();
  const progress = page.locator(".sp-ai-execution");
  await expect(progress).not.toHaveAttribute("open", "");
  await progress.locator(":scope > summary").click();
  await expect(progress).toContainText("已读取 1 张表，核实 1 个字段。");
  await expect(progress).toContainText("已完成");
  expect(fixtures.asked[0]).toEqual({ query, scope: "all", topK: 10 });
  await expect(input).toHaveValue(query);

  for (const width of [1440, 1280, 860, 600]) {
    await page.setViewportSize({ width, height: 900 });
    await expectNoHorizontalOverflow(page);
  }

  await page.getByRole("button", { name: `查看字段详情：${longField}` }).click();
  await expect(page).toHaveURL(/\/data-warehouse(?:\/|\?)/);
  await expect(page).toHaveURL(new RegExp(`assetId=${ASSET_ID}`));
});

test("list answer is explicitly partial and keeps verified table/field references clickable", async ({ page }) => {
  await openAiPortal(page);
  const input = page.getByRole("textbox", { name: "搜索数据资产" });
  await input.fill("我们行有哪些存款字段和表？");
  await page.getByRole("button", { name: "问 AI", exact: true }).click();

  await expect(page.getByLabel("AI 部分回答")).toContainText("不代表完整清单");
  await expect(page.getByRole("status")).toContainText("有界检索结果可能不完整");
  await expect(page.getByText("答案引用的目录资产", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: `查看字段详情：${longField}` })).toBeVisible();
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

  await input.fill("replacement question");
  await page.getByRole("button", { name: "问 AI", exact: true }).click();
  await expect(page.getByLabel("AI 回答摘要")).toContainText("replacement question");
  expect(fixtures.asked.map((item) => item.query)).toEqual([
    "cancel-first question", "replacement question",
  ]);
});
