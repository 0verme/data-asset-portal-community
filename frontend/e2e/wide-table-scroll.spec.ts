import { expect, test, type Page } from "@playwright/test";
import { installMenuFixtures } from "./menu-table-fixtures";

async function setAdminSession(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem("dap_auth", JSON.stringify({ role: "admin", user: "table-admin", name: "表格回归管理员" }));
    localStorage.setItem("dap-theme", "light");
  });
}

test("menu wide table keeps a working sticky scrollbar at desktop and tablet widths", async ({ page }, testInfo) => {
  await installMenuFixtures(page);
  await page.setViewportSize({ width: 1440, height: 650 });
  await page.goto("/system-management/menus");

  const table = page.locator("table.menu-management-table");
  const rows = table.locator("tbody tr");
  await expect(rows.first()).toBeVisible({ timeout: 20_000 });

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

  await page.screenshot({ path: testInfo.outputPath("menu-wide-table-desktop-after.png") });
  await fixedRail.focus();
  await fixedRail.press("End");
  await expect.poll(async () => scrollRegion.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  const atEnd = Number(await fixedRail.getAttribute("aria-valuenow"));
  const max = Number(await fixedRail.getAttribute("aria-valuemax"));
  expect(atEnd).toBe(max);
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
  await page.screenshot({ path: testInfo.outputPath("menu-wide-table-mobile-after.png"), fullPage: true });
});
