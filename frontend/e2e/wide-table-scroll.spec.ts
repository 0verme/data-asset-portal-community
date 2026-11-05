import { expect, test, type Page } from "@playwright/test";

async function setAdminSession(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem("dap_auth", JSON.stringify({ role: "admin", user: "table-admin", name: "表格回归管理员" }));
    localStorage.setItem("dap-theme", "light");
  });
}

test("menu wide table remains reachable at desktop/tablet widths and keeps the mobile card layout", async ({ page }, testInfo) => {
  await setAdminSession(page);
  await page.setViewportSize({ width: 1440, height: 650 });
  await page.goto("/system-management/menus");

  const table = page.locator("table.menu-management-table");
  const rows = table.locator("tbody tr");
  await expect(rows.first()).toBeVisible({ timeout: 20_000 });
  const headers = await table.locator("thead th").allTextContents();
  expect(headers.indexOf("导航位置")).toBeGreaterThanOrEqual(0);
  expect(headers.indexOf("操作")).toBeGreaterThan(headers.indexOf("导航位置"));
  await expect(page.getByRole("button", { name: "新增菜单" })).toBeVisible();

  const scrollRegion = page.getByRole("region", { name: "菜单管理表格" });
  const fixedRail = page.getByRole("scrollbar", { name: "菜单管理表格横向滚动" });
  await expect(fixedRail).toBeVisible({ timeout: 10_000 });
  const desktopMetrics = await scrollRegion.evaluate((element) => {
    const tableElement = element.querySelector("table");
    const main = element.closest(".main");
    return {
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      tableBottom: tableElement?.getBoundingClientRect().bottom ?? 0,
      mainBottom: main?.getBoundingClientRect().bottom ?? 0,
      railPosition: document.querySelector<HTMLElement>(".wide-table-sticky-scrollbar")?.getBoundingClientRect().top ?? -1,
    };
  });
  expect(desktopMetrics.scrollWidth).toBeGreaterThan(desktopMetrics.clientWidth);
  expect(desktopMetrics.tableBottom).toBeGreaterThan(desktopMetrics.mainBottom);
  expect(Math.abs(desktopMetrics.railPosition - desktopMetrics.mainBottom)).toBeLessThanOrEqual(2);
  const actionPane = page.getByRole("table", { name: "菜单操作" });
  await expect(actionPane).toBeVisible();
  await expect(actionPane.getByRole("row", { name: "菜单 上游卸数 操作" })).toBeVisible();
  const [scrollBounds, actionBounds, shellBounds] = await Promise.all([
    scrollRegion.boundingBox(),
    actionPane.boundingBox(),
    page.locator(".menu-management-table-shell").boundingBox(),
  ]);
  expect(scrollBounds).not.toBeNull();
  expect(actionBounds).not.toBeNull();
  expect(shellBounds).not.toBeNull();
  expect(actionBounds!.x).toBeGreaterThanOrEqual(scrollBounds!.x + scrollBounds!.width - 1);
  expect(actionBounds!.x + actionBounds!.width).toBeLessThanOrEqual(shellBounds!.x + shellBounds!.width + 1);

  await page.screenshot({ path: testInfo.outputPath("menu-wide-table-desktop-after.png") });
  await fixedRail.focus();
  await fixedRail.press("End");
  await expect.poll(async () => scrollRegion.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  const atEnd = Number(await fixedRail.getAttribute("aria-valuenow"));
  const max = Number(await fixedRail.getAttribute("aria-valuemax"));
  expect(atEnd).toBe(max);
  const [navigationBounds, endScrollBounds] = await Promise.all([
    table.locator("thead th").filter({ hasText: "导航位置" }).boundingBox(),
    scrollRegion.boundingBox(),
  ]);
  expect(navigationBounds).not.toBeNull();
  expect(endScrollBounds).not.toBeNull();
  expect(navigationBounds!.x + navigationBounds!.width).toBeLessThanOrEqual(endScrollBounds!.x + endScrollBounds!.width + 1);
  expect(navigationBounds!.x + navigationBounds!.width).toBeGreaterThan(endScrollBounds!.x + endScrollBounds!.width - 160);
  await expect(actionPane).toBeVisible();
  await fixedRail.press("Home");
  await expect.poll(async () => scrollRegion.evaluate((element) => element.scrollLeft)).toBe(0);

  const railBounds = await fixedRail.boundingBox();
  const thumbBounds = await fixedRail.locator(".wide-table-scrollbar-thumb").boundingBox();
  expect(railBounds).not.toBeNull();
  expect(thumbBounds).not.toBeNull();
  const pointerY = railBounds!.y + railBounds!.height / 2;
  await page.mouse.move(thumbBounds!.x + thumbBounds!.width / 2, pointerY);
  await page.mouse.down();
  await page.mouse.move(railBounds!.x + railBounds!.width - 12, pointerY, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => scrollRegion.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  expect(Number(await fixedRail.getAttribute("aria-valuenow"))).toBe(max);
  const endThumbBounds = await fixedRail.locator(".wide-table-scrollbar-thumb").boundingBox();
  expect(endThumbBounds).not.toBeNull();
  await page.mouse.move(endThumbBounds!.x + endThumbBounds!.width / 2, pointerY);
  await page.mouse.down();
  await page.mouse.move(railBounds!.x + 12, pointerY, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => scrollRegion.evaluate((element) => element.scrollLeft)).toBe(0);

  await page.setViewportSize({ width: 1024, height: 760 });
  await expect(fixedRail).toBeVisible();
  const tabletOverflow = await scrollRegion.evaluate((element) => element.scrollWidth > element.clientWidth);
  expect(tabletOverflow).toBe(true);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(rows.first()).toBeVisible();
  await expect(fixedRail).toHaveCount(0);
  const mobileMetrics = await scrollRegion.evaluate((element) => ({
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
    rowDisplay: getComputedStyle(element.querySelector("tbody tr")!).display,
  }));
  expect(mobileMetrics.rowDisplay).toBe("grid");
  expect(mobileMetrics.scrollWidth).toBeLessThanOrEqual(mobileMetrics.clientWidth + 1);
  await expect(rows.first().locator('td[data-label="导航位置"]')).toBeVisible();
  await expect(rows.first().getByRole("button", { name: "下移" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("menu-wide-table-mobile-after.png"), fullPage: true });
});
