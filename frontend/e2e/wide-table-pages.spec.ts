import { expect, test, type Page } from "@playwright/test";

async function setAdminSession(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem("dap_auth", JSON.stringify({ role: "admin", user: "table-admin", name: "表格回归管理员" }));
    localStorage.setItem("dap-theme", "light");
  });
}

const listRoutes = [
  ["数据仓库", "/data-warehouse?layout=list"],
  ["指标维护", "/indicator-maintenance?view=list"],
  ["报表资产", "/report-assets?view=list"],
  ["API 资产", "/api-assets?view=list"],
  ["手工码值表", "/code-table-maintenance"],
  ["数据词根", "/root-management"],
  ["上游卸数", "/upstream?view=list"],
  ["下游推送系统", "/push?view=list"],
  ["用户管理", "/system-management/users"],
  ["角色管理", "/system-management/roles"],
  ["菜单管理", "/system-management/menus"],
  ["参数字典", "/system-management/param-dicts"],
  ["操作日志", "/system-management/operation-logs"],
] as const;

async function verifyWideTable(page: Page, label: string): Promise<void> {
  const region = page.locator(".wide-table-scroll").first();
  await expect(region, `${label} should render its list table`).toBeVisible({ timeout: 20_000 });

  const before = await region.evaluate((element) => {
    const table = element.querySelector("table");
    return {
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      tableWidth: table?.getBoundingClientRect().width ?? 0,
    };
  });
  expect(before.tableWidth, `${label} table should have a measurable width`).toBeGreaterThan(0);
  expect(before.scrollWidth, `${label} table content must remain inside its scroll viewport`).toBeGreaterThanOrEqual(before.tableWidth - 1);

  if (before.scrollWidth > before.clientWidth + 1) {
    await region.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
    const rightEdge = await region.evaluate((element) => {
      const headers = Array.from(element.querySelectorAll("thead th"))
        .filter((header) => getComputedStyle(header).display !== "none");
      const lastHeader = headers.at(-1);
      return {
        headerRight: lastHeader?.getBoundingClientRect().right ?? 0,
        viewportRight: element.getBoundingClientRect().right,
      };
    });
    expect(rightEdge.headerRight, `${label} final column should be reachable at the scroll end`)
      .toBeLessThanOrEqual(rightEdge.viewportRight + 2);
    expect(rightEdge.headerRight, `${label} final column should be visible at the scroll end`)
      .toBeGreaterThan(rightEdge.viewportRight - 240);
  }
}

async function verifyMobileCard(page: Page, label: string): Promise<void> {
  const region = page.locator(".wide-table-scroll").first();
  await expect(region, `${label} mobile table viewport should remain visible`).toBeVisible();
  const mobileLayout = await region.evaluate((element) => {
    const table = element.querySelector("table");
    const row = table?.querySelector("tbody tr");
    return {
      isCard: table?.classList.contains("mobile-card-table") ?? false,
      rowDisplay: row ? getComputedStyle(row).display : null,
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    };
  });
  if (mobileLayout.isCard && mobileLayout.rowDisplay) {
    expect(mobileLayout.rowDisplay, `${label} should keep its mobile card rows`).toBe("grid");
    expect(mobileLayout.scrollWidth, `${label} mobile cards should not require wide-table scrolling`)
      .toBeLessThanOrEqual(mobileLayout.clientWidth + 1);
  }
  await expect(page.locator(".wide-table-sticky-scrollbar")).toHaveCount(0);
}

test("audited wide-table pages keep every column reachable without clipping outside the viewport", async ({ page }) => {
  test.setTimeout(180_000);
  await setAdminSession(page);

  for (const [label, route] of listRoutes) {
    await test.step(label, async () => {
      await page.setViewportSize({ width: 1440, height: 850 });
      await page.goto(route);
      await verifyWideTable(page, label);
      await page.setViewportSize({ width: 390, height: 844 });
      await verifyMobileCard(page, label);
    });
  }

  await test.step("下游推送作业", async () => {
    await page.setViewportSize({ width: 1440, height: 850 });
    await page.goto("/push?view=list");
    const systemRow = page.locator(".push-systems-wide-table tbody tr").first();
    await expect(systemRow).toBeVisible({ timeout: 20_000 });
    await systemRow.click();
    await verifyWideTable(page, "下游推送作业");
    await page.setViewportSize({ width: 390, height: 844 });
    await verifyMobileCard(page, "下游推送作业");
  });
});
