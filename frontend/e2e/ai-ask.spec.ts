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
  };
}

function answer(query: string) {
  return {
    status: "answered",
    answer: `已根据合成目录为“${query}”找到相关候选，请核对下方 DAP 资产卡片。`,
    citations: [{ assetId: ASSET_ID, fieldId: FIELD_ID, source: "dap_catalog" }],
    candidates: [candidate()],
    retrievalStatus: "available",
    generationStatus: "completed",
    reasonCode: null,
    elapsedMs: 12,
  };
}

async function mockPortalApis(page: Page, options: {
  aiEnabled?: boolean;
  askFailureCount?: number;
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
    if (path === "/api/ai/ask") {
      const payload = route.request().postDataJSON() as { query: string; scope: string; topK: number };
      asked.push(payload);
      if (askFailuresRemaining > 0 && payload.query.includes("retry")) {
        askFailuresRemaining -= 1;
        return json({ error: { code: "MOCK_PROVIDER_UNAVAILABLE", message: "Mock provider unavailable" } }, 503);
      }
      if (payload.query.includes("未登记")) {
        return json({
          status: "insufficient_evidence",
          answer: "当前元数据不足以确认。",
          citations: [], candidates: [],
          retrievalStatus: "available", generationStatus: "not_run",
          reasonCode: "insufficient_evidence", elapsedMs: 3,
        });
      }
      if (payload.query.includes("timeout")) {
        return json({
          status: "generation_unavailable",
          answer: "AI 问答暂不可用，请稍后重试。",
          citations: [], candidates: [candidate()],
          retrievalStatus: "available", generationStatus: "unavailable",
          reasonCode: "llm_timeout", elapsedMs: 12000,
        });
      }
      return json(answer(payload.query));
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

async function openAiPortal(page: Page, options?: { aiEnabled?: boolean; askFailureCount?: number }) {
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
  await expect(page.getByText("相关候选资产", { exact: true })).toBeVisible();
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

test("true zero-match offers AI with the existing query; no-evidence refusal is explicit", async ({ page }) => {
  const fixtures = await openAiPortal(page);
  const query = "未登记业务字段在哪里？";
  const input = page.getByRole("textbox", { name: "搜索数据资产" });
  await input.fill(query);
  await page.getByRole("button", { name: "搜索" }).click();
  await expect(page.getByRole("heading", { name: "没有找到精确匹配的资产" })).toBeVisible();
  await page.getByRole("button", { name: "问 AI 找资产" }).click();
  await expect(page.getByText("当前元数据不足以确认。", { exact: true })).toBeVisible();
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
  await expect(page.getByText("模型暂不可用，未生成回答", { exact: false })).toBeVisible();
  await expect(page.getByText("timeout", { exact: false })).toHaveCount(0);

  await input.fill("retry candidate");
  await page.getByRole("button", { name: "问 AI", exact: true }).click();
  await expect(page.getByRole("button", { name: "重试" })).toBeVisible();
  await page.getByRole("button", { name: "重试" }).click();
  await expect(page.getByLabel("AI 回答摘要")).toBeVisible();
  expect(fixtures.asked).toHaveLength(3);
});
