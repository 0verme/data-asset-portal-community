import { expect, test } from "@playwright/test";

const modules = [
  { path: "/indicator-maintenance?dimension=DWM", zh: "指标管理", en: "Indicators", controlZh: "指标维度", controlEn: "Indicator dimensions", controlSelector: ".side-title" },
  { path: "/lineage?view=table", zh: "血缘分析", en: "Lineage", controlZh: "血缘视图", controlEn: "Lineage view", controlRole: "combobox", sidebarZh: "血缘资产导航", sidebarEn: "Lineage asset navigation" },
  { path: "/report-assets?view=list", zh: "报表资产", en: "Report assets", controlZh: "报表类型", controlEn: "Report type", controlSelector: ".side-title" },
  { path: "/api-assets?view=list", zh: "API 资产", en: "API assets", controlZh: "请求方式", controlEn: "HTTP method", controlSelector: ".side-title" },
  { path: "/field-mapping?tab=field", zh: "字段映射查询", en: "Field Mapping", controlZh: "查询条件", controlEn: "Filters", controlSelector: ".fm-card-title" },
] as const;

async function expectModuleControl(page: import("@playwright/test").Page, module: (typeof modules)[number], locale: "zh" | "en") {
  const label = locale === "zh" ? module.controlZh : module.controlEn;
  if ("controlRole" in module) {
    await expect(page.getByRole(module.controlRole, { name: label })).toBeVisible();
    return;
  }
  await expect(page.locator(module.controlSelector).filter({ hasText: label }).first()).toBeVisible();
}

async function expectModuleSidebar(page: import("@playwright/test").Page, module: (typeof modules)[number], locale: "zh" | "en") {
  if (!("sidebarZh" in module)) return;
  const label = locale === "zh" ? module.sidebarZh : module.sidebarEn;
  await expect(page.getByRole("heading", { name: label })).toBeVisible();
}

test("Phase 2 module language switches preserve route and do not trigger retrieval", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => localStorage.setItem("dap-language", "zh-CN"));
  const apiRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) apiRequests.push(request.url());
  });

  for (const module of modules) {
    await page.goto(module.path);
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    await expect(page.locator(".page-title")).toContainText(module.zh, { timeout: 20_000 });
    await expectModuleControl(page, module, "zh");
    await expectModuleSidebar(page, module, "zh");
    if ("sidebarZh" in module) {
      await page.getByRole("searchbox", { name: "Schema 名和表名搜索" }).fill("DWM");
    }
    await page.waitForLoadState("networkidle");

    const route = page.url();
    const requestsBeforeSwitch = apiRequests.length;
    await page.getByRole("button", { name: "切换到英文" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
    await expect(page.locator(".page-title")).toContainText(module.en);
    await expectModuleControl(page, module, "en");
    await expectModuleSidebar(page, module, "en");
    if ("sidebarZh" in module) {
      await expect(page.getByRole("searchbox", { name: "Search schemas and tables" })).toHaveValue("DWM");
    }
    await expect(page).toHaveURL(route);
    expect(apiRequests.length).toBe(requestsBeforeSwitch);

    await page.getByRole("button", { name: "Switch language to Chinese" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    await expect(page.locator(".page-title")).toContainText(module.zh);
    await expectModuleControl(page, module, "zh");
    await expectModuleSidebar(page, module, "zh");
    if ("sidebarZh" in module) {
      await expect(page.getByRole("searchbox", { name: "Schema 名和表名搜索" })).toHaveValue("DWM");
    }
    await expect(page).toHaveURL(route);
    expect(apiRequests.length).toBe(requestsBeforeSwitch);
  }
});
