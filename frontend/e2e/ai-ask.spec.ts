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

function sseResponse(response: ReturnType<typeof answer> | Record<string, unknown>) {
  const events: string[] = [];
  const emit = (id: string, status: string, extra: Record<string, unknown> = {}) => {
    events.push(`event: progress\ndata: ${JSON.stringify({ id, status, elapsedMs: status === "pending" || status === "running" ? 0 : 2, ...extra })}\n\n`);
  };
  const stage = (id: string, extra: Record<string, unknown> = {}) => {
    emit(id, "pending");
    emit(id, "running");
    emit(id, "completed", extra);
  };
  stage("analyzing");
  if (response.status === "retrieval_unavailable") {
    emit("retrieving", "pending");
    emit("retrieving", "running");
    emit("retrieving", "failed", { errorCode: response.reasonCode === "retrieval_timeout" ? "timeout" : "unavailable" });
  } else {
    stage("retrieving");
    const candidates = Array.isArray(response.candidates) ? response.candidates as Array<{ assetId: number; assetType: string; fieldId?: number | null }> : [];
    const tableCount = new Set(candidates.map((item) => item.assetId)).size;
    const fieldCount = new Set(candidates.filter((item) => item.assetType === "field" && item.fieldId).map((item) => `${item.assetId}:${item.fieldId}`)).size;
    stage("counting", { tableCount, fieldCount });
    stage("organizing");
    if (response.generationStatus !== "not_run") {
      if (response.status === "generation_unavailable") {
        emit("generating", "pending");
        emit("generating", "running");
        emit("generating", "failed", { errorCode: response.reasonCode === "llm_timeout" ? "timeout" : "unavailable" });
      } else stage("generating");
    }
    if (response.status === "answered" || response.status === "partial_answer" || response.status === "insufficient_evidence") stage("completed");
  }
  events.push(`event: result\ndata: ${JSON.stringify(response)}\n\n`);
  return {
    status: 200,
    contentType: "text/event-stream",
    body: events.join(""),
  };
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
    if (path === "/api/ai/ask/progress") {
      const payload = route.request().postDataJSON() as { query: string; scope: string; topK: number };
      asked.push(payload);
      if (payload.query.includes("deterministic-count")) {
        return route.fulfill(sseResponse({
          status: "statistical_answer",
          answer: "",
          citations: [], candidates: [],
          retrievalStatus: "available", generationStatus: "not_run", resultsTruncated: false,
          elapsedMs: 3,
          statisticalResult: {
            metric: "table_count", value: 118,
            filters: [
              { dimension: "domain", value: "国业", displayName: "主题域" },
              { dimension: "layer", value: "DM", displayName: "数据分层" },
            ],
            source: "dap_catalog", complete: true,
            sourceLink: "/data-warehouse?domain=%E5%9B%BD%E4%B8%9A&layer=DM",
          },
        }));
      }
      if (options.delayFirstAsk && (payload.query.includes("cancel-first") || payload.query.includes("slow-old"))) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        try {
          return await route.fulfill(sseResponse(answer(payload.query)));
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
        }));
      }
      if (payload.query.includes("timeout")) {
        return route.fulfill(sseResponse({
          status: "generation_unavailable",
          answer: "AI 问答暂不可用，请稍后重试。",
          citations: [], candidates: [],
          retrievalStatus: "available", generationStatus: "unavailable", resultsTruncated: false,
          reasonCode: "llm_timeout", elapsedMs: 12000,
        }));
      }
      return route.fulfill(sseResponse(answer(payload.query)));
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
  await expect(page.getByText("答案引用的目录资产", { exact: true })).toBeVisible();
  const progress = page.locator(".sp-ai-progress");
  await expect(progress).not.toHaveAttribute("open", "");
  await progress.locator("summary").click();
  await expect(progress).toContainText("1 张表 · 1 个字段");
  await expect(progress).toContainText("回答完成");
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
  const progress = page.locator(".sp-ai-progress");
  await progress.locator("summary").click();
  await expect(progress).toContainText("0 张表 · 0 个字段");
  await expect(progress).not.toContainText("正在生成回答");
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
  await page.getByRole("tab", { name: /搜索结果/ }).click();
  await expect(page.getByText("尚未对“cancel-first running query”执行传统搜索。")).toBeVisible();
  await page.getByRole("tab", { name: /AI 问答/ }).click();
  await expect(page.getByRole("button", { name: "取消问答" })).toBeVisible();
  expect(fixtures.asked).toHaveLength(1);
  await expect(page.getByLabel("AI 回答摘要")).toContainText(query);
  expect(fixtures.asked).toHaveLength(1);
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
  await expect(statistic).toContainText("主题域=国业");
  await expect(statistic).toContainText("数据分层=DM");
  await expect(statistic.getByRole("link", { name: "查看筛选后的全部资产" })).toHaveAttribute("href", /\/data-warehouse\?/);
  await expect(page.locator(".sp-ai-candidate")).toHaveCount(0);
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
  const timeoutAlert = page.locator(".sp-ai-group [role=alert]");
  await expect(timeoutAlert).toBeVisible();
  await expect(page.locator(".sp-ai-progress")).not.toHaveAttribute("open", "");
  const failurePrecedesProgress = await page.evaluate(() => {
    const alert = document.querySelector(".sp-ai-group [role=alert]");
    const progress = document.querySelector(".sp-ai-progress");
    return Boolean(alert && progress && (alert.compareDocumentPosition(progress) & Node.DOCUMENT_POSITION_FOLLOWING));
  });
  expect(failurePrecedesProgress).toBe(true, "AI failures should be announced before collapsed execution details");
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

  await input.fill("replacement question");
  await page.getByRole("button", { name: "问 AI", exact: true }).click();
  await expect(page.getByLabel("AI 回答摘要")).toContainText("replacement question");
  expect(fixtures.asked.map((item) => item.query)).toEqual([
    "cancel-first question", "replacement question",
  ]);
});
