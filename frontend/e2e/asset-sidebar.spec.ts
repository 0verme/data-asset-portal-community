import { expect, test, type Page, type TestInfo } from "@playwright/test";

const ASSET_PATH = "/data-warehouse";
const VIEWPORTS = [1920, 1440, 1280, 1024, 768, 390] as const;
type AuthMode = "guest" | "admin";

async function setMockAuth(page: Page, mode: AuthMode) {
  await page.addInitScript((authMode) => {
    localStorage.removeItem("dap_auth");
    if (authMode === "admin") {
      localStorage.setItem("dap_auth", JSON.stringify({ role: "admin", user: "admin", name: "管理员" }));
    }
  }, mode);
}

async function openAssetList(page: Page, auth: AuthMode) {
  await setMockAuth(page, auth);
  await page.goto(`${ASSET_PATH}?layout=list`);
  await expect(page.locator(".asset-page .page-title")).toContainText("数据资产", { timeout: 20_000 });
  await expect(page.locator(".asset-page table.dt tbody tr").first()).toBeVisible({ timeout: 20_000 });
}

async function openMobileSidebar(page: Page, width: number) {
  const sidebar = page.locator("#mobile-sidebar");
  if (width <= 768) {
    await page.getByRole("button", { name: "打开导航" }).click();
    await expect(sidebar).toHaveClass(/open/);
    await expect.poll(() => sidebar.evaluate((element) => Math.round(element.getBoundingClientRect().left))).toBeGreaterThanOrEqual(0);
  }
}

async function captureViewport(page: Page, testInfo: TestInfo, auth: AuthMode, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await openMobileSidebar(page, width);
  const metrics = await page.evaluate(() => {
    const sidebar = document.querySelector<HTMLElement>("#mobile-sidebar");
    return {
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      sidebarWidth: sidebar ? Math.round(sidebar.getBoundingClientRect().width) : null,
      filterGroups: sidebar ? [...sidebar.querySelectorAll(".asset-sidebar-filter-group")].map((group) => ({
        title: group.querySelector(".asset-sidebar-filter-heading")?.textContent?.trim() || "",
        itemCount: group.querySelectorAll(".side-item").length,
      })) : [],
      addTableButtons: [...document.querySelectorAll("button")]
        .filter((button) => button.textContent?.trim() === "新增表")
        .map((button) => ({
          visible: Boolean(button.getClientRects().length),
          x: Math.round(button.getBoundingClientRect().x),
          y: Math.round(button.getBoundingClientRect().y),
        })),
    };
  });
  expect(metrics.documentWidth).toBeLessThanOrEqual(width);
  expect(metrics.filterGroups).toHaveLength(2);
  const pageCreate = page.locator(".asset-page .page-head").getByRole("button", { name: "新增表" });
  const sidebarCreate = page.locator("#mobile-sidebar").getByRole("button", { name: "新增表" });
  await expect(pageCreate).toHaveCount(auth === "admin" ? 1 : 0);
  await expect(sidebarCreate).toHaveCount(0);
  if (auth === "admin") {
    await expect(pageCreate).toBeVisible();
    const box = await pageCreate.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
  }
  await testInfo.attach(`${auth}-list-${width}-measurements`, {
    body: JSON.stringify(metrics, null, 2),
    contentType: "application/json",
  });
  if (width <= 768) {
    await page.screenshot({ path: testInfo.outputPath(`${auth}-list-drawer-${width}.png`), fullPage: true });
    await page.keyboard.press("Escape");
    await expect(page.locator("#mobile-sidebar")).not.toHaveClass(/open/);
    await expect.poll(() => page.locator("#mobile-sidebar").evaluate((element) => Math.round(element.getBoundingClientRect().right))).toBeLessThanOrEqual(0);
  }
  await page.screenshot({ path: testInfo.outputPath(`${auth}-list-${width}.png`), fullPage: true });
}

test("asset sidebar and primary create action remain usable at all required responsive widths", async ({ browser }, testInfo) => {
  test.setTimeout(90_000);
  for (const auth of ["guest", "admin"] as const) {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await openAssetList(page, auth);
      for (const width of VIEWPORTS) {
        await captureViewport(page, testInfo, auth, width);
      }
    } finally {
      await context.close();
    }
  }
});

test("page create action owns the list while sidebar create remains available from detail/edit", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openAssetList(page, "admin");
  const pageCreate = page.locator(".asset-page .page-head").getByRole("button", { name: "新增表" });
  const sidebarCreate = page.locator("#mobile-sidebar").getByRole("button", { name: "新增表" });
  await expect(pageCreate).toHaveCount(1);
  await expect(sidebarCreate).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("admin-list.png"), fullPage: true });

  await page.getByRole("row", { name: /dwm_trade_order_item_di/ }).click();
  await expect(page.getByRole("button", { name: "编辑表" })).toBeVisible();
  await expect(page.locator(".asset-page .page-head").getByRole("button", { name: "新增表" })).toHaveCount(0);
  await expect(sidebarCreate).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath("admin-detail.png"), fullPage: true });

  await page.getByRole("button", { name: "编辑表" }).click();
  await expect(page.getByText("编辑数据表", { exact: true })).toBeVisible();
  await expect(page.locator(".asset-page .page-head").getByRole("button", { name: "新增表" })).toHaveCount(0);
  await expect(sidebarCreate).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath("admin-edit.png"), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "打开导航" }).click();
  await expect(page.locator("#mobile-sidebar")).toHaveClass(/open/);
  await expect.poll(() => page.locator("#mobile-sidebar").evaluate((element) => Math.round(element.getBoundingClientRect().left))).toBeGreaterThanOrEqual(0);
  await sidebarCreate.scrollIntoViewIfNeeded();
  await expect(sidebarCreate).toBeVisible();
  const sidebarButtonBox = await sidebarCreate.boundingBox();
  expect(sidebarButtonBox).not.toBeNull();
  expect(sidebarButtonBox!.x).toBeGreaterThanOrEqual(0);
  expect(sidebarButtonBox!.x + sidebarButtonBox!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath("admin-edit-mobile-sidebar.png"), fullPage: true });
});

test("asset filter groups collapse independently and preserve URL, selection, count, tooltip, theme, and reset contracts", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openAssetList(page, "guest");
  const groups = page.locator("#mobile-sidebar .asset-sidebar-filter-group");
  await expect(groups).toHaveCount(2);
  const layerGroup = groups.nth(0);
  const domainGroup = groups.nth(1);
  const layerHeading = layerGroup.getByRole("button", { name: "数据分层", exact: true });
  const domainHeading = domainGroup.getByRole("button", { name: "主题域", exact: true });
  const initialUrl = page.url();

  await expect(layerHeading).toHaveAttribute("aria-expanded", "true");
  await expect(domainHeading).toHaveAttribute("aria-expanded", "true");
  await expect(layerHeading).toHaveAttribute("aria-controls", /.+/);
  await expect(domainHeading).toHaveAttribute("aria-controls", /.+/);

  await domainHeading.focus();
  await page.keyboard.press("Space");
  await expect(domainHeading).toHaveAttribute("aria-expanded", "false");
  await expect(layerHeading).toHaveAttribute("aria-expanded", "true");
  await expect(domainGroup.getByRole("button", { name: /交易/ })).toBeHidden();
  await expect(page).toHaveURL(initialUrl);

  await page.keyboard.press("Enter");
  await expect(domainHeading).toHaveAttribute("aria-expanded", "true");
  const layerOption = layerGroup.getByRole("button", { name: /DWA 应用明细层/ });
  await layerOption.hover();
  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).toContainText("DWA 应用明细层");
  await expect(layerOption).toHaveAttribute("aria-describedby", /.+/);
  await page.screenshot({ path: testInfo.outputPath("asset-filter-tooltip-light-1280.png"), fullPage: true });

  const transaction = domainGroup.getByRole("button", { name: /交易/ });
  const middleLayer = layerGroup.getByRole("button", { name: /DWM 中间层/ });
  await transaction.click();
  await expect(page).toHaveURL(/domain=%E4%BA%A4%E6%98%93/);
  await expect(transaction).toHaveAttribute("aria-pressed", "true");
  await expect(transaction).toContainText("28");
  await domainHeading.click();
  await expect(domainHeading).toHaveAttribute("aria-expanded", "false");
  await expect(page).toHaveURL(/domain=%E4%BA%A4%E6%98%93/);
  await expect(layerHeading).toHaveAttribute("aria-expanded", "true");
  await domainHeading.click();
  await expect(domainHeading).toHaveAttribute("aria-expanded", "true");

  const allDomains = domainGroup.getByRole("button", { name: /全部主题域/ });
  await allDomains.click();
  await expect(page).not.toHaveURL(/domain=/);
  await expect(allDomains).toHaveAttribute("aria-pressed", "true");
  await middleLayer.click();
  await expect(page).toHaveURL(/layer=DWM/);
  await transaction.click();
  await expect(page).toHaveURL(/domain=%E4%BA%A4%E6%98%93/);
  await expect(page).toHaveURL(/layer=DWM/);
  await expect(transaction).toHaveAttribute("aria-pressed", "true");
  await expect(transaction).toContainText("4");
  await expect(middleLayer).toContainText("4");
  await expect(allDomains).toContainText("32");
  await allDomains.click();
  await expect(page).not.toHaveURL(/domain=/);
  await expect(page).toHaveURL(/layer=DWM/);
  await expect(allDomains).toHaveAttribute("aria-pressed", "true");
  const allLayers = layerGroup.getByRole("button", { name: /全部层级/ });
  await allLayers.click();
  await expect(page).not.toHaveURL(/(?:domain|layer)=/);
  await expect(allLayers).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "切换到深色主题" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await transaction.click();
  await expect(transaction).toHaveAttribute("aria-pressed", "true");
  const selectedColors = await transaction.evaluate((element) => ({
    background: getComputedStyle(element).backgroundColor,
    color: getComputedStyle(element).color,
  }));
  expect(selectedColors.background).not.toBe("rgba(0, 0, 0, 0)");
  expect(selectedColors.color).not.toBe(selectedColors.background);
  await page.screenshot({ path: testInfo.outputPath("asset-filter-selected-dark-1280.png"), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await openMobileSidebar(page, 390);
  await domainHeading.scrollIntoViewIfNeeded();
  await expect(domainHeading).toHaveAttribute("aria-expanded", "true");
  await domainHeading.click();
  await expect(domainHeading).toHaveAttribute("aria-expanded", "false");
  await expect(domainGroup.getByRole("button", { name: /交易/ })).toBeHidden();
  await domainHeading.click();
  await expect(domainHeading).toHaveAttribute("aria-expanded", "true");
  await page.screenshot({ path: testInfo.outputPath("asset-filter-mobile-dark-390.png"), fullPage: false });
  await page.keyboard.press("Escape");
  await expect(page.locator("#mobile-sidebar")).not.toHaveClass(/open/);
  await page.setViewportSize({ width: 1280, height: 900 });

  await allDomains.click();
  await middleLayer.click();
  await transaction.click();
  await expect(page).toHaveURL(/domain=%E4%BA%A4%E6%98%93/);
  await expect(page).toHaveURL(/layer=DWM/);
  await layerHeading.click();
  await expect(layerHeading).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: "字段映射", exact: true }).click();
  await expect(page).toHaveURL(/field-mapping/);
  await page.getByRole("button", { name: "数据仓库", exact: true }).click();
  await expect(page).toHaveURL(/data-warehouse/);
  await expect(page).not.toHaveURL(/(?:domain|layer)=/);
  const returnedGroups = page.locator("#mobile-sidebar .asset-sidebar-filter-group");
  await expect(returnedGroups.nth(0).getByRole("button", { name: "数据分层", exact: true })).toHaveAttribute("aria-expanded", "true");
  await expect(returnedGroups.nth(1).getByRole("button", { name: "主题域", exact: true })).toHaveAttribute("aria-expanded", "true");
  await expect(returnedGroups.nth(0).getByRole("button", { name: /全部层级/ })).toHaveAttribute("aria-pressed", "true");
  await expect(returnedGroups.nth(1).getByRole("button", { name: /全部主题域/ })).toHaveAttribute("aria-pressed", "true");
});

test("guest can open asset details without write actions", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openAssetList(page, "guest");
  await page.getByRole("row", { name: /dwm_trade_order_item_di/ }).click();
  await expect(page.getByText("订单商品明细中间表", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "新增表" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "编辑表" })).toHaveCount(0);
});
