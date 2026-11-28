import { expect, test, type Page } from "@playwright/test";

type PermissionMode = "admin" | "readonly" | "none";
type FixtureOptions = {
  brandingReadGate?: () => Promise<void>;
  brandingReadStatus?: (attempt: number) => number;
};

const quota = {
  parameterCode: "AI_LLM_DAILY_LIMIT",
  dailyLimit: 50,
  used: 4,
  remaining: 46,
  businessDate: "2026-11-18",
  timezone: "Asia/Shanghai",
};

const ragConfig = {
  retrievalMode: "local",
  enabled: false,
  serviceUrl: "",
  strategy: "auto",
  topK: 5,
  timeoutMs: 2000,
  tokenConfigured: false,
};

const brandingConfig = {
  site: {
    title: { "zh-CN": "测试站点", "en-US": "Test site" },
    display_name: { "zh-CN": "测试门户", "en-US": "Test portal" },
    announcement: { "zh-CN": "", "en-US": "" },
    logo_url: "/brand-icon.svg",
    favicon_url: "/favicon.ico",
  },
  hero: {
    title: { "zh-CN": "测试首页", "en-US": "Test home" },
    subtitle: { "zh-CN": "", "en-US": "" },
    search_placeholder: { "zh-CN": "搜索", "en-US": "Search" },
  },
  login: {
    hint: { "zh-CN": "请联系管理员。", "en-US": "Contact an administrator." },
    quick_demo_login_enabled: false,
  },
};

const defaultBrandingConfig = {
  ...brandingConfig,
  site: {
    ...brandingConfig.site,
    title: { "zh-CN": "数据资产门户", "en-US": "Data Asset Portal" },
    display_name: { "zh-CN": "数据资产门户", "en-US": "Data Asset Portal" },
  },
  hero: {
    ...brandingConfig.hero,
    title: { "zh-CN": "数据资产门户", "en-US": "Data Asset Portal" },
  },
};

async function installFixtures(page: Page, mode: PermissionMode, language = "zh-CN", options: FixtureOptions = {}) {
  const permissions = mode === "admin"
    ? ["system:param:read", "system:param:write"]
    : mode === "readonly" ? ["system:param:read"] : [];
  const requests: Array<{ method: string; path: string; body?: unknown }> = [];
  let brandingReadAttempts = 0;

  await page.addInitScript((selectedLanguage) => {
    localStorage.removeItem("dap_auth");
    localStorage.setItem("dap-language", selectedLanguage);
  }, language);

  await page.route(/^https?:\/\/[^/]+\/api(?:\/|$)/, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api/, "");
    const method = request.method();
    const body = request.postDataJSON?.();
    requests.push({ method, path, body });

    if (path === "/auth/me") {
      return route.fulfill({ json: { data: { user: "qa-admin", role: "admin", permissions } } });
    }
    if (path === "/public-catalog/config") {
      return route.fulfill({ json: { profile: "internal", exportEnabled: false } });
    }
    if (path === "/system/public-config") {
      const isEnglish = url.searchParams.get("lang") === "en-US";
      return route.fulfill({ json: { data: {
        site: {
          title: isEnglish ? "Test site" : "测试站点",
          display_name: isEnglish ? "Test portal" : "测试门户",
          announcement: "",
          logo_url: "/brand-icon.svg",
          favicon_url: "/favicon.ico",
        },
        hero: {
          title: isEnglish ? "Test home" : "测试首页",
          subtitle: "",
          search_placeholder: isEnglish ? "Search" : "搜索",
        },
        login: { hint: isEnglish ? "Contact an administrator." : "请联系管理员。", quick_demo_login_enabled: false },
        version: "qa-v1",
      } } });
    }
    if (path === "/system/param-dicts/categories") {
      return route.fulfill({ json: { items: [{ code: "GENERAL", name: "通用参数", desc: "通用系统参数", status: "enabled", count: 0 }] } });
    }
    if (path === "/system/param-dicts/page") {
      return route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 20 } });
    }
    if (path === "/system/ai-llm-daily-quota" && method === "GET") {
      return route.fulfill({ json: { data: quota } });
    }
    if (path === "/system/ai-llm-daily-quota" && method === "PUT") {
      return route.fulfill({ json: { data: { ...quota, ...body } } });
    }
    if (path === "/system/rag-search-config" && method === "GET") {
      return route.fulfill({ json: { data: ragConfig } });
    }
    if (path === "/system/rag-search-config" && method === "PUT") {
      return route.fulfill({ json: { data: { ...ragConfig, ...body } } });
    }
    if (path === "/system/rag-search-config/diagnostics") {
      return route.fulfill({ json: { data: { status: "disabled", reasonCode: "disabled", health: "unknown", ready: false, tokenConfigured: false } } });
    }
    if (path === "/system/branding-config" && method === "GET") {
      brandingReadAttempts += 1;
      await options.brandingReadGate?.();
      const status = options.brandingReadStatus?.(brandingReadAttempts) ?? 200;
      if (status !== 200) {
        return route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ message: "branding service unavailable" }) });
      }
      return route.fulfill({ json: { data: { config: brandingConfig, version: "qa-v1" } } });
    }
    if (path === "/system/branding-config" && method === "PUT") {
      return route.fulfill({ json: { data: { config: body, version: "qa-saved-v2" } } });
    }
    if (path === "/system/branding-config/reset" && method === "POST") {
      return route.fulfill({ json: { data: { config: defaultBrandingConfig, version: "qa-default-v1" } } });
    }
    if (path === "/system/menus") {
      return route.fulfill({ json: { items: [] } });
    }
    return route.fulfill({ json: { items: [] } });
  });

  return requests;
}

test("system parameter dictionary is clean and AI and branding have independent entries", async ({ page }) => {
  const requests = await installFixtures(page, "admin");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/system-management/param-dicts");

  await expect(page.locator(".page-title")).toContainText("参数字典");
  await expect(page.locator(".llm-quota-panel, .rag-config-panel, .branding-config-panel")).toHaveCount(0);
  await expect(page.getByText("AI 管理", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("站点品牌配置", { exact: true }).first()).toBeVisible();
  expect(requests.some(({ path }) => path === "/system/ai-llm-daily-quota")).toBe(false);
  expect(requests.some(({ path }) => path.startsWith("/system/rag-search-config"))).toBe(false);
  expect(requests.some(({ path }) => path === "/system/branding-config")).toBe(false);

  await page.getByText("AI 管理", { exact: true }).first().click();
  await expect(page).toHaveURL(/\/system-management\/ai$/);
  await expect(page.locator(".page-title")).toContainText("AI 管理");
  const quotaPanel = page.locator(".llm-quota-panel");
  const ragPanel = page.locator(".rag-config-panel").filter({ hasText: "AI 检索与 RAG 配置" });
  await expect(quotaPanel).toContainText("今日剩余 46 次");
  await expect(quotaPanel).toContainText("已用 4 / 剩余 46 次");
  await expect(quotaPanel).toContainText("00:00");
  await expect(ragPanel).toContainText("合法范围：1–20 的整数。");
  await expect(ragPanel).toContainText("合法范围：250–10,000 的整数。");
  await expect(ragPanel).toContainText("Token 不写入参数表");
  await expect(page.locator(".rag-config-panel")).toHaveCount(2);

  await ragPanel.locator('input[type="number"]').first().fill("6");
  await ragPanel.getByRole("button", { name: "保存配置" }).click();
  await expect(ragPanel).toContainText("AI 问答检索与 RAG 配置已保存");
  const ragUpdate = requests.find(({ path, method }) => path === "/system/rag-search-config" && method === "PUT");
  expect(ragUpdate?.body).toMatchObject({ retrievalMode: "local", topK: 6 });

  const aiRequestCount = requests.filter(({ path }) => path === "/system/ai-llm-daily-quota" || path.startsWith("/system/rag-search-config")).length;
  await page.getByText("站点品牌配置", { exact: true }).first().click();
  await expect(page).toHaveURL(/\/system-management\/branding$/);
  await expect(page.locator(".page-title")).toContainText("站点品牌配置");
  await expect(page.locator(".branding-config-panel")).toBeVisible();
  await expect(page.locator(".llm-quota-panel, .rag-config-panel:not(.branding-config-panel)")).toHaveCount(0);
  expect(requests.filter(({ path }) => path === "/system/ai-llm-daily-quota" || path.startsWith("/system/rag-search-config")).length).toBe(aiRequestCount);
  expect(requests.some(({ path }) => path === "/system/branding-config")).toBe(true);
});

test("read-only users can inspect AI settings but cannot change them; English copy is available", async ({ page }) => {
  const requests = await installFixtures(page, "readonly", "en-US");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/system-management/ai");

  await expect(page.locator(".page-title")).toHaveText("AI management");
  await expect(page.getByText("Daily AI question quota", { exact: true })).toBeVisible();
  await expect(page.getByText("AI retrieval and RAG settings", { exact: true })).toBeVisible();
  await expect(page.getByText(/Changes require system:param:write permission/)).toBeVisible();
  await expect(page.locator(".llm-quota-panel input[type=number]").first()).toBeDisabled();
  await expect(page.locator(".llm-quota-panel button")).toBeDisabled();
  await expect(page.locator(".rag-config-panel input").first()).toBeDisabled();
  await expect(page.locator(".rag-config-panel button").filter({ hasText: "Save settings" })).toBeDisabled();
  expect(requests.some(({ path, method }) => path === "/system/ai-llm-daily-quota" && method === "PUT")).toBe(false);
  expect(requests.some(({ path, method }) => path === "/system/rag-search-config" && method === "PUT")).toBe(false);

  await page.getByText("Site branding", { exact: true }).first().click();
  await expect(page).toHaveURL(/\/system-management\/branding$/);
  await expect(page.locator(".page-title")).toHaveText("Site branding settings");
  await expect(page.locator(".branding-config-panel")).toBeVisible();
  await expect(page.locator(".branding-actions button").first()).toBeDisabled();
});

test("users without system parameter read permission cannot open AI configuration", async ({ page }) => {
  const requests = await installFixtures(page, "none");
  await page.goto("/system-management/ai");

  await expect(page.getByRole("heading", { name: "无权访问系统管理页面" })).toBeVisible();
  await expect(page.locator(".llm-quota-panel, .rag-config-panel")).toHaveCount(0);
  expect(requests.some(({ path }) => path === "/system/ai-llm-daily-quota")).toBe(false);
  expect(requests.some(({ path }) => path.startsWith("/system/rag-search-config"))).toBe(false);
});

test("branding can be edited and saved after the persisted configuration loads", async ({ page }) => {
  let finishRead!: () => void;
  const readGate = new Promise<void>((resolve) => { finishRead = resolve; });
  const requests = await installFixtures(page, "admin", "en-US", { brandingReadGate: () => readGate });
  await page.goto("/system-management/branding");

  await expect(page.getByRole("status").filter({ hasText: "Loading site branding settings" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save settings" })).toHaveCount(0);
  finishRead();

  const title = page.getByRole("textbox", { name: "Browser and site title (zh-CN)" });
  await expect(title).toBeEnabled();
  await title.fill("Persisted QA Portal");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Site branding settings were saved" })).toBeVisible();

  const update = requests.find(({ path, method }) => path === "/system/branding-config" && method === "PUT");
  expect(update?.body).toMatchObject({ site: { title: { "zh-CN": "Persisted QA Portal" } } });
});

test("restoring all branding defaults uses the portal name in both locales", async ({ page }) => {
  const requests = await installFixtures(page, "admin");
  await page.goto("/system-management/branding");

  await expect(page.getByRole("textbox", { name: "浏览器标题与站点标题 (zh-CN)" })).toHaveValue("测试站点");
  await page.getByRole("button", { name: "恢复全部默认" }).click();
  await expect(page.getByRole("status").filter({ hasText: "站点文案与资源已恢复默认值" })).toBeVisible();

  for (const field of ["浏览器标题与站点标题", "产品展示名称", "首页主标题"]) {
    await expect(page.getByRole("textbox", { name: `${field} (zh-CN)` })).toHaveValue("数据资产门户");
    await expect(page.getByRole("textbox", { name: `${field} (en-US)` })).toHaveValue("Data Asset Portal");
  }
  expect(requests.some(({ path, method }) => path === "/system/branding-config/reset" && method === "POST")).toBe(true);
});

test("failed branding reads expose only retry and never write local defaults", async ({ page }) => {
  const requests = await installFixtures(page, "admin", "en-US", { brandingReadStatus: () => 503 });
  await page.goto("/system-management/branding");

  await expect(page.getByRole("alert")).toContainText("Could not load site branding settings");
  const retry = page.getByRole("button", { name: "Reload settings" });
  await expect(retry).toBeEnabled();
  await retry.click();
  await expect(page.getByRole("alert")).toContainText("Could not load site branding settings");

  await expect(page.locator("input[type=file]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save settings" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Restore all defaults" })).toHaveCount(0);
  const brandingRequests = requests.filter(({ path }) => path === "/system/branding-config" || path.startsWith("/system/branding-config/assets/"));
  expect(brandingRequests.some(({ method }) => method === "GET")).toBe(true);
  expect(brandingRequests.every(({ method }) => method === "GET")).toBe(true);
});

test("retrying a failed branding read enables editing only after the persisted config loads", async ({ page }) => {
  const retryState = { available: false };
  const requests = await installFixtures(page, "admin", "en-US", { brandingReadStatus: () => retryState.available ? 200 : 503 });
  await page.goto("/system-management/branding");

  await expect(page.getByRole("alert")).toContainText("Could not load site branding settings");
  retryState.available = true;
  await page.getByRole("button", { name: "Reload settings" }).click();

  const title = page.getByRole("textbox", { name: "Browser and site title (zh-CN)" });
  await expect(title).toBeEnabled();
  await title.fill("Recovered QA Portal");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Site branding settings were saved" })).toBeVisible();

  const updates = requests.filter(({ path, method }) => path === "/system/branding-config" && method === "PUT");
  expect(updates).toHaveLength(1);
  expect(updates[0]?.body).toMatchObject({ site: { title: { "zh-CN": "Recovered QA Portal" } } });
});
