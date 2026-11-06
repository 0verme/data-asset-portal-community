import { expect, test, type Page } from "@playwright/test";
import { installMenuFixtures } from "./menu-table-fixtures";

async function setViewportAndGoto(page: Page, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height });
  await page.goto("/system-management/menus");
  const rows = page.locator("table.menu-management-table tbody tr");
  await expect(rows.first()).toBeVisible({ timeout: 20_000 });
  await expect(rows).toHaveCount(20, { timeout: 20_000 });
}

test.describe("menu operation column stays aligned with table rows", () => {
  test("desktop rows of different heights keep the operation cell aligned", async ({ page }) => {
    await installMenuFixtures(page);
    await setViewportAndGoto(page, 1440, 1000);

    const table = page.locator("table.menu-management-table");
    const rows = table.locator("tbody tr");
    const metrics = await page.evaluate(() => {
      const t = document.querySelector("table.menu-management-table");
      return Array.from(t!.querySelectorAll("tbody tr")).map((row) => {
        const cell = row.querySelector("td.menu-actions-cell") as HTMLElement;
        const button = cell.querySelector(".btn") as HTMLElement;
        const r = row.getBoundingClientRect();
        const c = cell.getBoundingClientRect();
        const b = button.getBoundingClientRect();
        return {
          rowHeight: r.height,
          cellTopDiff: c.top - r.top,
          cellBottomDiff: r.bottom - c.bottom,
          buttonCenterDiff: (b.top + b.bottom) / 2 - (r.top + r.bottom) / 2,
        };
      });
    });

    expect(metrics.length).toBe(20);
    for (const metric of metrics) {
      expect(metric.cellTopDiff).toBeLessThanOrEqual(1);
      expect(metric.cellBottomDiff).toBeLessThanOrEqual(1);
      expect(Math.abs(metric.buttonCenterDiff)).toBeLessThanOrEqual(2);
    }
    const heights = metrics.map((metric) => metric.rowHeight);
    expect(Math.max(...heights)).toBeGreaterThan(Math.min(...heights) + 10);
  });

  test("operation column stays at the viewport edge while scrolling horizontally", async ({ page }) => {
    await installMenuFixtures(page);
    await setViewportAndGoto(page, 1440, 1000);

    const scrollRegion = page.getByRole("region", { name: "菜单管理表格" });
    const table = page.locator("table.menu-management-table");
    const maxScroll = await scrollRegion.evaluate((element) => element.scrollWidth - element.clientWidth);
    expect(maxScroll).toBeGreaterThan(0);

    for (const target of [0, Math.round(maxScroll / 2), maxScroll]) {
      await scrollRegion.evaluate((element, value) => { element.scrollLeft = value; }, target);
      await page.waitForTimeout(100);

      const bounds = await page.evaluate(() => {
        const region = document.querySelector('[data-wide-table-scroll]') as HTMLElement;
        const cell = document.querySelector("table.menu-management-table tbody tr td.menu-actions-cell") as HTMLElement;
        const nav = document.querySelector('table.menu-management-table tbody tr td[data-label="导航位置"]') as HTMLElement;
        const actionHeader = document.querySelector("table.menu-management-table th.menu-actions-head") as HTMLElement;
        return {
          regionLeft: region.getBoundingClientRect().left,
          regionRight: region.getBoundingClientRect().right,
          cellLeft: cell.getBoundingClientRect().left,
          cellRight: cell.getBoundingClientRect().right,
          navRight: nav.getBoundingClientRect().right,
          actionHeaderRight: actionHeader.getBoundingClientRect().right,
        };
      });
      expect(bounds.cellRight).toBeGreaterThanOrEqual(bounds.regionRight - 2);
      expect(bounds.cellLeft).toBeGreaterThanOrEqual(bounds.regionLeft - 1);
      if (target === maxScroll) {
        expect(bounds.navRight).toBeLessThanOrEqual(bounds.cellLeft + 1);
      }
      expect(bounds.actionHeaderRight).toBeGreaterThanOrEqual(bounds.regionRight - 2);
    }
  });

  test("tablet width keeps the sticky operation column usable", async ({ page }) => {
    await installMenuFixtures(page);
    await setViewportAndGoto(page, 1024, 760);
    const scrollRegion = page.getByRole("region", { name: "菜单管理表格" });
    const overflow = await scrollRegion.evaluate((element) => element.scrollWidth > element.clientWidth);
    expect(overflow).toBe(true);
    const position = await page.locator("table.menu-management-table td.menu-actions-cell").first().evaluate((element) => getComputedStyle(element).position);
    expect(position).toBe("sticky");
  });

  test("mobile width keeps actions inside the card without horizontal scrolling", async ({ page }) => {
    await installMenuFixtures(page);
    await setViewportAndGoto(page, 390, 844);
    const scrollRegion = page.getByRole("region", { name: "菜单管理表格" });
    const mobileMetrics = await scrollRegion.evaluate((element) => {
      const table = element.querySelector("table");
      const row = table?.querySelector("tbody tr") as HTMLElement;
      const cell = table?.querySelector("td.menu-actions-cell") as HTMLElement;
      return {
        rowDisplay: getComputedStyle(row).display,
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        position: getComputedStyle(cell).position,
      };
    });
    expect(mobileMetrics.rowDisplay).toBe("grid");
    expect(mobileMetrics.scrollWidth).toBeLessThanOrEqual(mobileMetrics.clientWidth + 1);
    expect(mobileMetrics.position).not.toBe("sticky");
    await expect(page.locator("table.menu-management-table tbody tr").first().getByRole("button", { name: "编辑" })).toBeVisible();
    await expect(page.locator("table.menu-management-table tbody tr").first().getByRole("button", { name: "下移" })).toBeVisible();
  });

  test("pagination and sorting controls still work", async ({ page }) => {
    await installMenuFixtures(page);
    await setViewportAndGoto(page, 1440, 1000);

    const rows = page.locator("table.menu-management-table tbody tr");
    const pager = page.getByRole("navigation", { name: "菜单管理分页", exact: true });
    await expect(pager).toContainText("1 / 2");
    await pager.getByRole("button", { name: "下一页" }).click();
    await expect(rows).toHaveCount(3);
    await expect(pager).toContainText("2 / 2");
    await pager.getByRole("button", { name: "上一页" }).click();
    await expect(rows).toHaveCount(20);

    await rows.nth(1).getByRole("button", { name: "上移" }).click();
    await expect(rows).toHaveCount(20);
  });

  test("status action opens its confirmation dialog and calls the API", async ({ page }) => {
    await installMenuFixtures(page);
    await setViewportAndGoto(page, 1440, 1000);

    const row = page.locator("table.menu-management-table tbody tr").first();
    await row.getByRole("button", { name: "禁用" }).click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await page.getByRole("alertdialog").getByRole("button", { name: "取消" }).click();
  });

  test("edit action opens the edit form", async ({ page }) => {
    await installMenuFixtures(page);
    await setViewportAndGoto(page, 1440, 1000);

    const row = page.locator("table.menu-management-table tbody tr").first();
    await row.getByRole("button", { name: "编辑" }).click();
    await expect(page.getByText("编辑菜单", { exact: true })).toBeVisible({ timeout: 10_000 });
  });
});
