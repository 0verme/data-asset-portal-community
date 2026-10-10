import { expect, test, type Page, type TestInfo } from "@playwright/test";

const remoteFixturesEnabled = String(process.env["VITE_API_MODE"] || "")
  .trim()
  .toLowerCase() === "remote";
const longSystemId = "27";
const longSystemName = "跨区域客户关系与会员交易数据交换平台（中文显示名称较长）".repeat(2);
const longSystemCode = "CRM-MEMBER-REGIONAL-OPERATIONS-2026";
const longSystemLabel = `${longSystemName} · ${longSystemCode}`;
const remoteSourceSystems = Array.from({ length: 36 }, (_, index) => {
  const sourceSystemId = String(index + 1);
  const isLongLabel = sourceSystemId === longSystemId;
  return {
    id: sourceSystemId,
    sourceSystemId,
    upstreamSystemId: sourceSystemId,
    name: isLongLabel ? longSystemName : `源系统 ${sourceSystemId.padStart(2, "0")}`,
    systemName: isLongLabel ? longSystemName : `源系统 ${sourceSystemId.padStart(2, "0")}`,
    systemCode: isLongLabel ? longSystemCode : `SYS-${sourceSystemId.padStart(2, "0")}`,
    systemAbbr: isLongLabel ? longSystemCode : `SYS-${sourceSystemId.padStart(2, "0")}`,
    count: 1,
  };
});

async function setMockAuth(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem("dap_auth", JSON.stringify({ role: "admin", user: "admin", name: "管理员" }));
    localStorage.setItem("dap-theme", "light");
  });
}

async function setRemoteFixtures(page: Page, tableRequests: URL[], statsRequests: URL[]): Promise<() => void> {
  let sourceSystems: typeof remoteSourceSystems = remoteSourceSystems;
  await page.route("**/api/**", async (requestRoute) => {
    const requestUrl = new URL(requestRoute.request().url());
    const path = requestUrl.pathname;
    if (!path.startsWith("/api/")) {
      await requestRoute.continue();
      return;
    }

    if (path === "/api/auth/me") {
      await requestRoute.fulfill({
        json: {
          role: "admin",
          user: "issue-391-e2e",
          name: "Issue 391 E2E",
          permissions: ["field_mapping:read", "system:menu:read"],
        },
      });
      return;
    }
    if (path === "/api/public-catalog/config") {
      await requestRoute.fulfill({ json: { profile: "internal", exportEnabled: false } });
      return;
    }
    if (path === "/api/system/menus") {
      await requestRoute.fulfill({ json: { items: [] } });
      return;
    }
    if (path === "/api/field-mappings/source-systems") {
      await requestRoute.fulfill({ json: sourceSystems });
      return;
    }
    if (path === "/api/field-mappings/stats") {
      statsRequests.push(requestUrl);
      await requestRoute.fulfill({
        json: {
          sourceSystemCount: sourceSystems.length,
          sourceTableCount: 0,
          fieldCount: 0,
          mappedFieldCount: 0,
          unmappedFieldCount: 0,
          emptyCommentCount: 0,
          coverage: 0,
        },
      });
      return;
    }
    if (path === "/api/field-mappings/tables") {
      tableRequests.push(requestUrl);
      await requestRoute.fulfill({
        json: {
          items: [],
          total: 0,
          page: Number(requestUrl.searchParams.get("page") || 1),
          pageSize: Number(requestUrl.searchParams.get("pageSize") || 50),
        },
      });
      return;
    }
    if (path === "/api/field-mappings/fields") {
      await requestRoute.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 50 } });
      return;
    }

    await requestRoute.fulfill({ json: [] });
  });

  await page.addInitScript(() => localStorage.setItem("dap-theme", "light"));
  return () => {
    sourceSystems = [];
  };
}

async function assertRequestHasSourceSystem(requests: readonly URL[], sourceSystemId: string): Promise<void> {
  await expect.poll(() => requests.some((requestUrl) => (
    requestUrl.searchParams.get("sourceSystemId") === sourceSystemId
  ))).toBe(true);
}

test("field-mapping source-system Select preserves ids and long labels across themes and routes", async ({ page }, testInfo: TestInfo) => {
  const tableRequests: URL[] = [];
  const statsRequests: URL[] = [];
  let clearRemoteSystems: (() => void) | undefined;

  if (remoteFixturesEnabled) {
    clearRemoteSystems = await setRemoteFixtures(page, tableRequests, statsRequests);
  } else {
    await setMockAuth(page);
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/field-mapping");

  const sourceSystemSelect = page.getByRole("combobox", { name: "源系统" });
  await expect(sourceSystemSelect).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(sourceSystemSelect).toHaveClass(/dap-ui-select/);
  await expect(sourceSystemSelect).not.toHaveClass(/\bsel\b/);
  await expect(sourceSystemSelect).toContainText("全部");

  const expectedOptionCount = remoteFixturesEnabled ? remoteSourceSystems.length + 1 : 9;
  const selectedSystemId = remoteFixturesEnabled ? longSystemId : "2";
  const selectedSystemLabel = remoteFixturesEnabled ? longSystemLabel : "商品中心 · PIM";

  await sourceSystemSelect.click();
  await expect(page.getByRole("listbox").getByRole("option")).toHaveCount(expectedOptionCount);
  const selectedOption = page.getByRole("option", { name: selectedSystemLabel, exact: true });
  await selectedOption.scrollIntoViewIfNeeded();
  await expect(selectedOption).toBeVisible();
  expect(await selectedOption.innerText()).toBe(selectedSystemLabel);
  await page.screenshot({
    path: testInfo.outputPath("field-mapping-source-system-menu-light.png"),
    fullPage: true,
  });
  await selectedOption.click();
  await expect(sourceSystemSelect).toContainText(selectedSystemLabel);
  await expect(sourceSystemSelect).toBeFocused();
  if (remoteFixturesEnabled) {
    await sourceSystemSelect.hover();
    await expect(page.getByRole("tooltip")).toHaveText(selectedSystemLabel);
    await page.screenshot({
      path: testInfo.outputPath("field-mapping-source-system-selected-tooltip-light.png"),
      fullPage: true,
    });
    await page.mouse.move(0, 0);
    await page.screenshot({
      path: testInfo.outputPath("field-mapping-source-system-selected-long-light.png"),
      fullPage: true,
    });
  }

  await page.getByRole("button", { name: "查询" }).click();
  if (remoteFixturesEnabled) {
    await assertRequestHasSourceSystem(tableRequests, selectedSystemId);
    await assertRequestHasSourceSystem(statsRequests, selectedSystemId);
  } else {
    await expect(page.locator(".fm-system")).toHaveCount(2);
    await expect(page.locator(".fm-system").first()).toContainText(selectedSystemLabel);
  }

  const resetRequestStart = tableRequests.length;
  await page.getByRole("button", { name: "重置" }).click();
  await expect(sourceSystemSelect).toContainText("全部");
  if (remoteFixturesEnabled) {
    await expect.poll(() => tableRequests.slice(resetRequestStart).some((requestUrl) => (
      !requestUrl.searchParams.has("sourceSystemId")
    ))).toBe(true);
  } else {
    await expect(page.locator(".fm-system")).toHaveCount(12);
  }

  await page.getByRole("button", { name: "切换到深色主题" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await sourceSystemSelect.click();
  await expect(page.getByRole("listbox").getByRole("option")).toHaveCount(expectedOptionCount);
  const darkLongOption = page.getByRole("option", { name: selectedSystemLabel, exact: true });
  await darkLongOption.scrollIntoViewIfNeeded();
  await expect(darkLongOption).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("field-mapping-source-system-menu-dark.png"),
    fullPage: true,
  });
  await page.keyboard.press("Escape");

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileBounds = await sourceSystemSelect.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, width: rect.width, viewportWidth: window.innerWidth };
  });
  expect(mobileBounds.width).toBeGreaterThan(0);
  expect(mobileBounds.left).toBeGreaterThanOrEqual(0);
  expect(mobileBounds.right).toBeLessThanOrEqual(mobileBounds.viewportWidth + 1);

  if (remoteFixturesEnabled) {
    await sourceSystemSelect.click();
    const mobileLongOption = page.getByRole("option", { name: selectedSystemLabel, exact: true });
    await mobileLongOption.scrollIntoViewIfNeeded();
    await expect(mobileLongOption).toBeVisible();
    const mobileMenuBounds = await page.getByRole("listbox").evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, viewportWidth: window.innerWidth };
    });
    expect(mobileMenuBounds.left).toBeGreaterThanOrEqual(0);
    expect(mobileMenuBounds.right).toBeLessThanOrEqual(mobileMenuBounds.viewportWidth + 1);
    await page.screenshot({
      path: testInfo.outputPath("field-mapping-source-system-menu-dark-mobile.png"),
      fullPage: true,
    });
    await mobileLongOption.click();
    await expect(sourceSystemSelect).toContainText(selectedSystemLabel);
    await page.screenshot({
      path: testInfo.outputPath("field-mapping-source-system-selected-long-dark-mobile.png"),
      fullPage: true,
    });

    const linkedTableRequestStart = tableRequests.length;
    const linkedStatsRequestStart = statsRequests.length;
    await page.goto(`/field-mapping?sourceSystemId=${selectedSystemId}`);
    const linkedSelect = page.getByRole("combobox", { name: "源系统" });
    await expect(linkedSelect).toContainText(selectedSystemLabel);
    await expect(page).toHaveURL(new RegExp(`sourceSystemId=${selectedSystemId}`));
    await expect.poll(() => tableRequests.slice(linkedTableRequestStart).some((requestUrl) => (
      requestUrl.searchParams.get("sourceSystemId") === selectedSystemId
    ))).toBe(true);
    await expect.poll(() => statsRequests.slice(linkedStatsRequestStart).some((requestUrl) => (
      requestUrl.searchParams.get("sourceSystemId") === selectedSystemId
    ))).toBe(true);
    clearRemoteSystems?.();
    await page.goto("/field-mapping");
    const emptyDataSelect = page.getByRole("combobox", { name: "源系统" });
    await expect(emptyDataSelect).toBeVisible();
    await emptyDataSelect.click();
    const options = page.getByRole("listbox").getByRole("option");
    await expect(options).toHaveCount(1);
    await expect(options.getByText("全部", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
  }
});
