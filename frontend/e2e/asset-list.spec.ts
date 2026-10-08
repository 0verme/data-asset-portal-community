import { expect, test, type Page, type TestInfo } from "@playwright/test";

const APP_ASSET_PATH = "/data-warehouse";

async function setMockAuth(page: Page, mode: "guest" | "admin" | "readonly") {
  await page.addInitScript((authMode) => {
    localStorage.removeItem("dap_auth");
    if (authMode === "guest") return;
    const auth = authMode === "admin"
      ? { role: "admin", user: "admin", name: "管理员" }
      : { role: "maintainer", user: "只读审阅员", name: "只读审阅员", permissions: [] };
    localStorage.setItem("dap_auth", JSON.stringify(auth));
  }, mode);
}

async function openAssetList(page: Page, auth: "guest" | "admin" | "readonly" = "guest", query = "") {
  await setMockAuth(page, auth);
  const search = new URLSearchParams({ layout: "list" });
  if (query) search.set("q", query);
  await page.goto(`${APP_ASSET_PATH}?${search.toString()}`);
  await expect(page.locator(".asset-page .page-title")).toContainText("数据资产", { timeout: 20_000 });
  await expect(page.locator(".asset-page table.dt tbody tr").first()).toBeVisible({ timeout: 20_000 });
}

async function captureViewport(page: Page, testInfo: TestInfo, width: number, name: string) {
  await page.setViewportSize({ width, height: 900 });
  const sidebar = page.locator("#mobile-sidebar");
  if (width <= 768) {
    if (!(await sidebar.evaluate((element) => element.classList.contains("open")))) {
      await page.getByRole("button", { name: "打开导航" }).click();
    }
    await expect(sidebar).toHaveClass(/open/);
    await expect(sidebar.locator(".asset-sidebar-filter-group").first()).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`${name}-filters-${width}.png`), fullPage: true });
    await page.keyboard.press("Escape");
    await expect(sidebar).not.toHaveClass(/open/);
    await expect.poll(() => sidebar.evaluate((element) => element.getBoundingClientRect().right <= 0)).toBe(true);
    await expect(page.locator(".asset-page table.mobile-card-table")).toBeVisible();
    const tableDisplay = await page.locator(".asset-page table.mobile-card-table").evaluate((table) => getComputedStyle(table).display);
    expect(tableDisplay).toBe("block");
  }
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
  await page.screenshot({ path: testInfo.outputPath(`${name}-${width}.png`), fullPage: true });
}

test("guest and read-only users can browse assets but do not get asset-write controls", async ({ page }) => {
  await openAssetList(page, "guest");
  await expect(page.locator(".asset-page table.dt tbody tr").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "新增表" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /上一页/ })).toBeDisabled();
  await page.getByRole("button", { name: /下一页/ }).click();
  await expect(page.locator(".oplog-pager-info")).toHaveText("第 2 / 12 页");
  await expect(page.getByRole("button", { name: /上一页/ })).toBeEnabled();

  await openAssetList(page, "readonly");
  await expect(page.locator(".asset-page table.dt tbody tr").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "新增表" })).toHaveCount(0);
});

test("admin retains create controls while list/search uses the existing asset query contract", async ({ page }) => {
  await openAssetList(page, "admin");
  await expect(page.getByRole("button", { name: "新增表" })).toHaveCount(2);

  const search = page.getByRole("textbox", { name: "全局搜索" });
  await search.fill("订单商品");
  await expect(page).toHaveURL(/q=%E8%AE%A2%E5%8D%95%E5%95%86%E5%93%81/);
  await expect(page.locator(".asset-page table.dt tbody")).toContainText("订单商品明细中间表");
  await expect(page.locator(".asset-page table.dt tbody")).not.toContainText("会员基础画像全量表");

  await search.fill("no-such-asset-357");
  await expect(page.locator(".dap-ui-empty-state")).toBeVisible();
  await expect(page.getByText("未找到匹配的数据表")).toBeVisible();
});

test("asset filter, list/card/group modes, URL state, and browser history remain connected", async ({ page }) => {
  await openAssetList(page, "readonly");

  const list = page.getByRole("button", { name: "列表" });
  const card = page.getByRole("button", { name: "卡片" });
  const group = page.getByRole("button", { name: "分组" });
  await expect(list).toHaveAttribute("aria-pressed", "true");
  await card.click();
  await expect(card).toHaveAttribute("aria-pressed", "true");
  await expect(page).toHaveURL(/layout=card/);
  await expect(page.locator(".asset-page .tcard").first()).toBeVisible();

  await group.click();
  await expect(group).toHaveAttribute("aria-pressed", "true");
  await expect(page).toHaveURL(/layout=group/);
  await expect(page.locator(".asset-page .group-sec").first()).toBeVisible();

  const domainGroup = page.locator("#mobile-sidebar .asset-sidebar-filter-group")
    .filter({ has: page.getByText("主题域", { exact: true }) });
  await domainGroup.getByRole("button", { name: /交易/ }).click();
  await expect(page).toHaveURL(/domain=%E4%BA%A4%E6%98%93/);
  await expect(domainGroup.getByRole("button", { name: /交易/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".asset-page .group-sec")).toContainText("交易");

  await page.getByRole("button", { name: "列表" }).click();
  await expect(page).not.toHaveURL(/layout=/);
  await expect(page.locator(".asset-page table.dt tbody tr").first()).toBeVisible();

  const search = page.getByRole("textbox", { name: "全局搜索" });
  await search.fill("订单商品");
  await expect(page).toHaveURL(/q=%E8%AE%A2%E5%8D%95%E5%95%86%E5%93%81/);
  const targetRow = page.getByRole("row", { name: /dwm_trade_order_item_di/ });
  await expect(targetRow).toBeVisible();
  await targetRow.click();
  await expect(page).toHaveURL(/\/data-warehouse\/dwm_/);
  await expect(page.getByText("订单商品明细中间表", { exact: true })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/domain=%E4%BA%A4%E6%98%93/);
  await expect(page).toHaveURL(/q=%E8%AE%A2%E5%8D%95%E5%95%86%E5%93%81/);
  await expect(page.getByRole("row", { name: /dwm_trade_order_item_di/ })).toBeVisible();
});

test("asset list remains readable at desktop and mobile widths and preserves the theme on reload", async ({ page }, testInfo) => {
  await openAssetList(page, "readonly");
  for (const width of [960, 768, 480, 390]) {
    await captureViewport(page, testInfo, width, "asset-list-light");
  }

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("button", { name: "切换到深色主题" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).toHaveAttribute("data-mode", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator(".asset-page table.dt tbody tr").first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("asset-list-dark-1280.png"), fullPage: true });
});
