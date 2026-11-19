import { expect, test, type Page } from "@playwright/test";

test.skip(process.env["VITE_API_MODE"] !== "remote", "Run with the Remote portal stats contract.");

const statItems = ([
  ["源系统", 8], ["源表", 12], ["源字段", 72], ["指标", 36], ["下游系统", 6], ["下游推送文件", 6],
  ["主题域", 8], ["主题表", 224], ["报表", 8], ["API", 10], ["词根", 40], ["码值表", 0],
] as const).map(([label, value]) => ({ label, value }));

async function routePortal(page: Page) {
  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (!pathname.startsWith("/api/")) return route.continue();
    const json = (json: unknown, status = 200) => route.fulfill({ status, json });
    switch (pathname) {
      case "/api/auth/me": return json({ message: "Anonymous" }, 401);
      case "/api/public-catalog/config": return json({ profile: "internal", exportEnabled: false });
      case "/api/ai/status": return json({ enabled: true });
      case "/api/portal/stats": return json({ items: statItems });
      case "/api/system/menus": return json({ items: [
        ["dwm", "数据仓库", "/data-warehouse"], ["report", "报表资产", "/report-assets"],
        ["indicator", "指标维护", "/indicator-maintenance"], ["apiAsset", "API资产", "/api-assets"],
      ].map(([code, name, path], index) => ({
        id: String(index), code, name, path, icon: "database", order: index,
        status: "enabled", adminOnly: false, navPlacement: "primary",
      })) });
      case "/api/search/hot-keywords": return json({ items: ["catalog_events", "资产目录", "数据质量"].map((keyword, index) => ({
        id: index + 1, keyword, category: "all", sortOrder: index,
      })) });
      default: return json({ items: [] });
    }
  });
}

const appearances = [
  { name: "light", theme: "light", accent: { kind: "preset", preset: "purple" }, density: "comfortable", language: "zh-CN" },
  { name: "dark", theme: "dark", accent: { kind: "preset", preset: "purple" }, density: "comfortable", language: "zh-CN" },
  { name: "compact", theme: "dark", accent: { kind: "preset", preset: "blue" }, density: "compact", language: "zh-CN" },
  { name: "system", theme: "system", accent: { kind: "preset", preset: "green" }, density: "comfortable", language: "en-US" },
  { name: "orange", theme: "light", accent: { kind: "preset", preset: "orange" }, density: "comfortable", language: "en-US" },
  { name: "custom", theme: "dark", accent: { kind: "custom", hex: "#b54c78" }, density: "compact", language: "en-US" },
] as const;

for (const { name, theme, accent, density, language } of appearances) {
  test(`homepage keeps the full statistics grid usable with ${name} appearance`, async ({ page }, testInfo) => {
    await routePortal(page);
    await page.addInitScript((settings) => {
      localStorage.setItem("dap-appearance:v1:%2F", JSON.stringify(settings.preference));
      localStorage.setItem("dap-language", settings.language);
    }, { preference: { version: 1, themeMode: theme, accent, density, effects: "subtle" }, language });
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "no-preference" });
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto("/");
    const root = page.locator("html");
    await expect(root).toHaveAttribute("data-theme", theme === "system" ? "dark" : theme);
    await expect(root).toHaveAttribute("data-accent", accent.kind === "preset" ? accent.preset : "custom");
    await expect(root).toHaveAttribute("data-density", density);
    await expect(root).toHaveAttribute("lang", language);

    const grid = page.locator(".sp-stats-grid");
    await expect(grid.locator(".sp-stat-num")).toHaveText(statItems.map(({ value }) => String(value)));
    await expect(grid.locator(".sp-stat-label")).toHaveText(statItems.map(({ label }) => label));
    await expect(grid.locator("a, button, [tabindex], svg")).toHaveCount(0);
    await expect(grid.locator(".sp-stat-card").first().locator(":scope > :first-child")).toHaveClass("sp-stat-label");
    await expect(page.locator(".sp-hot-item").first()).toHaveText("catalog_events");
    await expect(page.getByRole("button", { name: "问 AI", exact: true })).toBeDisabled();
    await page.getByRole("heading", { level: 1 }).click();

    for (const [width, columns] of [[1440, 6], [861, 6], [860, 3], [768, 3], [601, 3], [600, 2], [390, 2], [320, 2]] as const) {
      await page.setViewportSize({ width, height: width === 1440 ? 960 : 844 });
      const rendered = await grid.evaluate((element) => {
        const boxes = [...document.querySelectorAll(".sp-searchbox, .sp-searchbox input, .sp-searchbox button, .sp-scope-chip, .sp-hot-item, .sp-stat-card")]
          .map((control) => control.getBoundingClientRect());
        const firstRowY = element.firstElementChild!.getBoundingClientRect().top;
        return {
          columns: [...element.children].filter((card) => card.getBoundingClientRect().top === firstRowY).length,
          maxRight: Math.max(document.documentElement.scrollWidth, ...boxes.map(({ right }) => right)),
          minLeft: Math.min(...boxes.map(({ left }) => left)),
          minActionHeight: Math.min(...[...document.querySelectorAll(".sp-search-actions button")]
            .map((action) => action.getBoundingClientRect().height)),
        };
      });
      expect(rendered.columns).toBe(columns);
      expect(rendered.maxRight).toBeLessThanOrEqual(width);
      expect(rendered.minLeft).toBeGreaterThanOrEqual(0);
      expect(rendered.minActionHeight).toBeGreaterThanOrEqual(44);
      if (process.env["DAP_PORTAL_CAPTURE"] === "1"
        && ((name === "light" && width !== 768) || (width === 1440 && ["dark", "compact"].includes(name)))) {
        await page.screenshot({ path: testInfo.outputPath(`homepage-${name}-${width}.png`), animations: "disabled" });
      }
    }
  });
}

test("homepage renders only the statistics visible to the current catalog", async ({ page }) => {
  await routePortal(page);
  const visible = statItems.slice(6, 8);
  let releaseResponse!: () => void;
  const responseGate = new Promise<void>((resolve) => { releaseResponse = resolve; });
  await page.route("**/api/portal/stats", async (route) => {
    await responseGate;
    return route.fulfill({ json: { items: visible } });
  });
  try {
    await page.goto("/");
    const loading = page.getByRole("status", { name: "正在加载资产统计…" });
    await expect(loading.locator(".sp-stat-placeholder")).toHaveCount(12);
  } finally {
    releaseResponse();
  }
  await expect(page.locator(".sp-stat-label")).toHaveText(visible.map(({ label }) => label));
  await expect(page.locator(".sp-stat-num")).toHaveText(visible.map(({ value }) => String(value)));
  expect(await statDividers(page)).toEqual([{ below: false, next: true }, { below: false, next: false }]);
});

async function statDividers(page: Page) {
  return page.locator(".sp-stat-card").evaluateAll((cells) => cells.map((cell) => ({
    below: getComputedStyle(cell, "::before").content === '""',
    next: getComputedStyle(cell, "::after").content === '""',
  })));
}

test("partial rows draw only adjacent dividers and wrap long labels and values", async ({ page }) => {
  await routePortal(page);
  const longItem = {
    label: "long-catalog-label-without-spaces".repeat(4),
    value: "123456789012345678901234567890",
  };
  await page.route("**/api/portal/stats", (route) =>
    route.fulfill({ json: { items: [...statItems.slice(0, 10), longItem] } }));

  await page.goto("/");
  const cells = page.locator(".sp-stat-card");
  await expect(cells.last().locator(".sp-stat-label")).toHaveText(longItem.label);
  await expect(cells.last().locator(".sp-stat-num")).toHaveText(longItem.value);
  await expect(cells).toHaveCount(11);
  for (const [width, columns] of [[1440, 6], [768, 3], [320, 2]] as const) {
    await page.setViewportSize({ width, height: 1024 });
    expect(await statDividers(page)).toEqual(Array.from({ length: 11 }, (_, index) => ({
      below: index + columns < 11,
      next: index < 10 && (index + 1) % columns !== 0,
    })));
    const content = await cells.last().locator(".sp-stat-label, .sp-stat-num").evaluateAll((elements) =>
      elements.map((element) => ({ width: element.clientWidth, contentWidth: element.scrollWidth })));
    expect(content).toHaveLength(2);
    for (const { width, contentWidth } of content) expect(contentWidth).toBeLessThanOrEqual(width);
  }
});

test("homepage distinguishes zero and unknown values from an empty catalog and request errors", async ({ page }) => {
  await routePortal(page);
  let status = 200;
  let body: object = { items: [{ label: "主题表", value: 0 }, { label: "词根", value: null }, { label: "API" }] };
  await page.route("**/api/portal/stats", (route) => route.fulfill({ status, json: body }));

  await page.goto("/");
  await expect(page.locator(".sp-stat-num")).toHaveText(["0", "-", "-"]);

  body = { items: [] };
  await page.reload();
  await expect(page.getByText("暂无资产统计", { exact: true })).toBeVisible();
  await expect(page.locator(".sp-stat-card")).toHaveCount(0);

  for (const [httpStatus, code, message] of [
    [500, "INTERNAL_ERROR", "合成统计请求失败"],
    [503, "PORTAL_STATS_UNAVAILABLE", "统计暂时不可用，请稍后重试。"],
  ] as const) {
    status = httpStatus;
    body = { error: { code, message } };
    await page.reload();
    await expect(page.getByText("资产统计加载失败", { exact: true })).toBeVisible();
    await expect(page.getByText(message, { exact: true })).toBeVisible();
    await expect(page.locator(".sp-stat-card")).toHaveCount(0);
  }
});
