import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

async function setMockAuthAndLocale(
  page: Page,
  mode: "guest" | "admin",
  locale: "zh-CN" | "en-US" = "zh-CN",
): Promise<void> {
  await page.addInitScript(({ authMode, language }) => {
    localStorage.setItem("dap-language", language);
    localStorage.removeItem("dap_auth");
    if (authMode === "admin") {
      localStorage.setItem("dap_auth", JSON.stringify({ role: "admin", user: "admin", name: "管理员" }));
    }
  }, { authMode: mode, language: locale });
}

function trackApiRequests(page: Page): string[] {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) requests.push(request.url());
  });
  return requests;
}

async function captureRequestedDownloadName(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const target = window as typeof window & { __dapRequestedDownloadName?: string };
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      target.__dapRequestedDownloadName = this.download;
      return click.call(this);
    };
  });
}

async function requestedDownloadName(page: Page): Promise<string | undefined> {
  return page.evaluate(() => (window as typeof window & { __dapRequestedDownloadName?: string }).__dapRequestedDownloadName);
}

test("root validation, route, and unsaved values follow locale changes without refetching", async ({ page }) => {
  test.setTimeout(60_000);
  await setMockAuthAndLocale(page, "admin");
  await page.setViewportSize({ width: 1280, height: 900 });
  const requests = trackApiRequests(page);

  await page.goto("/root-management?q=trans");
  await expect(page.locator(".root-page .page-title")).toContainText("词根库", { timeout: 20_000 });
  await page.getByRole("main").getByRole("button", { name: "新增词根" }).click();
  await expect(page.getByRole("heading", { name: "新增词根" })).toBeVisible();

  const abbreviation = page.getByLabel("词根缩写");
  const chineseName = page.getByLabel("中文名");
  await abbreviation.fill("bad_root");
  await chineseName.fill("保留的词根名称");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const summary = page.locator(".dap-ui-form-error-summary");
  await expect(summary).toContainText("词根缩写仅支持小写字母和数字，不允许下划线");

  const route = page.url();
  const requestCount = requests.length;
  await page.getByRole("button", { name: "切换到英文" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
  await expect(page.getByRole("heading", { name: "Add root" })).toBeVisible();
  await expect(summary).toContainText("Root abbreviations may contain lowercase letters and numbers only; underscores are not allowed.");
  await expect(page.getByLabel("Root abbreviation")).toHaveValue("bad_root");
  await expect(page.getByLabel("Chinese name")).toHaveValue("保留的词根名称");
  await expect(page).toHaveURL(route);
  expect(requests).toHaveLength(requestCount);
});

test("push job editor localizes known frequency labels but preserves values and form state", async ({ page }) => {
  test.setTimeout(60_000);
  await setMockAuthAndLocale(page, "admin");
  await page.setViewportSize({ width: 1280, height: 900 });
  const requests = trackApiRequests(page);

  await page.goto("/push?view=list");
  await expect(page.locator(".page-title")).toContainText("下游系统推送", { timeout: 20_000 });
  const firstSystem = page.locator("table.dt tbody tr").first();
  await expect(firstSystem).toBeVisible();
  const systemName = await firstSystem.locator(".sys-name").innerText();
  await firstSystem.click();
  await expect(page.getByRole("button", { name: "新增接口" })).toBeVisible();
  await page.getByRole("button", { name: "新增接口" }).click();
  await expect(page.getByRole("heading", { name: "新增推送接口" })).toBeVisible();

  await page.getByLabel("作业名称").fill("保留的推送作业");
  await page.getByLabel("湖仓来源文件名").fill("contract.csv");
  await page.getByLabel("字段1字段名").fill("contract_id");
  await page.getByLabel("字段1中文名").fill("合同编号");
  const frequency = page.getByRole("combobox", { name: "推送频率" });
  await frequency.click();
  await page.getByRole("option", { name: "每月", exact: true }).click();
  const pushDay = page.getByRole("combobox", { name: "推送日" });
  await expect(pushDay).toContainText("1 号");

  const route = page.url();
  const requestCount = requests.length;
  await page.getByRole("button", { name: "切换到英文" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
  await expect(page.getByRole("heading", { name: "Add push interface" })).toBeVisible();
  await expect(page.getByLabel("Job name")).toHaveValue("保留的推送作业");
  await expect(page.getByLabel("Warehouse source filename")).toHaveValue("contract.csv");
  await expect(page.getByLabel("Field 1 name")).toHaveValue("contract_id");
  await expect(page.getByLabel("Field 1 Chinese name")).toHaveValue("合同编号");
  await expect(page.getByRole("combobox", { name: "Push frequency" })).toContainText("Monthly");
  await expect(page.getByRole("combobox", { name: "Push day" })).toContainText("Day 1");
  await expect(page.locator("#push-job-editor-form")).toContainText(systemName);
  await expect(page).toHaveURL(route);
  expect(requests).toHaveLength(requestCount);
});

test("code-table search and CSV headers follow the selected locale while records remain unchanged", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await setMockAuthAndLocale(page, "admin");
  await page.setViewportSize({ width: 1280, height: 900 });
  await captureRequestedDownloadName(page);
  const requests = trackApiRequests(page);

  await page.goto("/code-table-maintenance?q=STATUS");
  await expect(page.locator(".code-table-page .page-title")).toContainText("码值表维护", { timeout: 20_000 });
  await expect(page.locator(".code-table-page table.dt tbody tr").first()).toBeVisible();
  const route = page.url();
  const firstRow = page.locator(".code-table-page table.dt tbody tr").first();
  const firstCode = await firstRow.locator("td").nth(0).innerText();
  const firstName = await firstRow.locator("td").nth(1).innerText();

  const zhDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出", exact: true }).click();
  const zhDownload = await zhDownloadPromise;
  expect(await requestedDownloadName(page)).toBe("手工码值表清单.csv");
  const zhPath = testInfo.outputPath("phase3-code-tables-zh.csv");
  await zhDownload.saveAs(zhPath);
  const zhCsv = await readFile(zhPath, "utf8");
  expect(zhCsv.split(/\r?\n/, 1)[0]).toContain("表编码,表名称,表样式,负责人,状态,说明,更新时间");
  expect(zhCsv).toContain(firstCode);
  expect(zhCsv).toContain(firstName);

  const requestCount = requests.length;
  await page.getByRole("button", { name: "切换到英文" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
  await expect(page.locator(".code-table-page .page-title")).toContainText("Code Table Management");
  await expect(page.locator(".code-table-page table.dt tbody tr").first().locator("td").first()).toHaveText(firstCode);
  await expect(page).toHaveURL(route);
  expect(requests).toHaveLength(requestCount);

  const enDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const enDownload = await enDownloadPromise;
  expect(await requestedDownloadName(page)).toBe("Manual Code Tables.csv");
  const enPath = testInfo.outputPath("phase3-code-tables-en.csv");
  await enDownload.saveAs(enPath);
  const enCsv = await readFile(enPath, "utf8");
  expect(enCsv.split(/\r?\n/, 1)[0]).toContain("Table code,Table name,Table style,Owner,Status,Description,Updated at");
  expect(enCsv).toContain(firstCode);
  expect(enCsv).toContain(firstName);
});

test("system-management permission gates remain unchanged across locale switches", async ({ page }) => {
  await setMockAuthAndLocale(page, "guest");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/system-management/users");
  await expect(page.getByRole("heading", { name: "登录后访问系统管理" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "新增用户" })).toHaveCount(0);
  const route = page.url();

  await page.getByRole("button", { name: "切换到英文" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
  await expect(page.getByRole("heading", { name: "Sign in to access system management" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create user" })).toHaveCount(0);
  await expect(page).toHaveURL(route);

  await page.getByRole("button", { name: "Switch language to Chinese" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page.getByRole("heading", { name: "登录后访问系统管理" })).toBeVisible();
  await expect(page.getByRole("button", { name: "新增用户" })).toHaveCount(0);
});
