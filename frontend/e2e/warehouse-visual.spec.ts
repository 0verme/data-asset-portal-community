import { expect, test, type Page, type TestInfo } from "@playwright/test";
import {
  appearanceKey,
  type AppearancePreferenceV1,
} from "../src/appearance/preferences.ts";

const ASSET_NAME = "dwm_trade_order_item_di";
const ASSET_PATH = "/data-warehouse";
const STORAGE_KEY = appearanceKey("/", process.env["VITE_APPEARANCE_SCOPE"]);
const preference = (
  themeMode: "light" | "dark",
  preset: "green" | "blue" | "purple" | "orange",
  density: "comfortable" | "compact" = "comfortable",
): AppearancePreferenceV1 => ({
  version: 1,
  themeMode,
  accent: { kind: "preset", preset },
  effects: "subtle",
  density,
});

async function initializeWorkspace(page: Page) {
  await page.addInitScript(({ key, saved }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(saved));
    if (!localStorage.getItem("dap-language")) localStorage.setItem("dap-language", "zh-CN");
    localStorage.setItem("dap_auth", JSON.stringify({ role: "admin", user: "admin", name: "管理员" }));
  }, { key: STORAGE_KEY, saved: preference("light", "green") });
}

async function expectNoPageOverflow(page: Page) {
  const width = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    content: document.querySelector(".main-inner")?.getBoundingClientRect().width ?? 0,
  }));
  expect(width.document).toBeLessThanOrEqual(width.viewport + 1);
  if (width.viewport > 1320) expect(width.content).toBeLessThanOrEqual(1321);
}

async function capture(page: Page, info: TestInfo, name: string) {
  await page.locator(".main-inner").evaluate((element) => element.scrollTo(0, 0));
  await page.screenshot({
    path: info.outputPath(`${name}.png`),
    fullPage: true,
    animations: "disabled",
  });
}

test("data warehouse views, detail, DDL, risks, and editors stay consistent at target viewports", async ({ page, browserName }, info) => {
  test.skip(browserName !== "chromium", "Visual evidence is captured once in Chromium.");
  test.setTimeout(180_000);
  await initializeWorkspace(page);

  const sizes = [
    { name: "1920x1080", width: 1920, height: 1080 },
    { name: "2560x1440", width: 2560, height: 1440 },
    { name: "1440x900", width: 1440, height: 900 },
    { name: "768x1024", width: 768, height: 1024 },
    { name: "390x844", width: 390, height: 844 },
  ] as const;

  for (const size of sizes) {
    await page.setViewportSize({ width: size.width, height: size.height });
    for (const layout of ["list", "card", "group"] as const) {
      await page.goto(`${ASSET_PATH}?layout=${layout}`);
      await expect(page.locator(".asset-page .page-title")).toBeVisible({ timeout: 20_000 });
      if (layout === "list") {
        await expect(page.locator(".asset-page table.asset-wide-table")).toBeVisible();
        await expect(page.locator(".asset-page table.asset-wide-table thead th")).toHaveCount(6);
        await expect(page.locator(".asset-page .dap-table-pagination")).toBeVisible();
      }
      if (layout === "card") await expect(page.locator(".asset-page .tcard").first()).toBeVisible();
      if (layout === "group") await expect(page.locator(".asset-page .group-sec").first()).toBeVisible();
      await expectNoPageOverflow(page);
      await capture(page, info, `warehouse-${layout}-${size.name}`);
    }
  }

  for (const size of sizes) {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto(`${ASSET_PATH}/${ASSET_NAME}`);
    await expect(page.locator(".asset-detail-page .dh-en")).toHaveText(ASSET_NAME, { timeout: 20_000 });
    await expect(page.locator(".asset-risks-panel")).toBeVisible();
    await expect(page.locator(".asset-detail-page table.fields tbody tr").first()).toBeVisible();
    await expectNoPageOverflow(page);
    if (size.width === 390) {
      const tableOverflow = await page.locator(".field-table-scroll").evaluate((element) => ({
        client: element.clientWidth,
        scroll: element.scrollWidth,
        overflow: getComputedStyle(element).overflowX,
      }));
      expect(tableOverflow.overflow).toBe("auto");
      expect(tableOverflow.scroll).toBeGreaterThan(tableOverflow.client);
    }
    await capture(page, info, `warehouse-detail-fields-${size.name}`);
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${ASSET_PATH}/${ASSET_NAME}?tab=ddl`);
  await expect(page.locator(".ddl")).toContainText("CREATE TABLE", { timeout: 20_000 });
  await expect(page.getByRole("button", { name: "复制 DDL" })).toBeVisible();
  await capture(page, info, "warehouse-detail-ddl-1440x900");

  await page.goto(`${ASSET_PATH}/new`);
  await expect(page.getByRole("heading", { name: "新增数据表" })).toBeVisible({ timeout: 20_000 });
  await expectNoPageOverflow(page);
  await capture(page, info, "warehouse-new-1440x900");
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoPageOverflow(page);
  await capture(page, info, "warehouse-new-390x844");

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${ASSET_PATH}/${ASSET_NAME}/edit`);
  await expect(page.getByRole("heading", { name: "编辑数据表" })).toBeVisible({ timeout: 20_000 });
  await expectNoPageOverflow(page);
  await capture(page, info, "warehouse-edit-1440x900");
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoPageOverflow(page);
  await capture(page, info, "warehouse-edit-390x844");

  for (const [name, saved] of [
    ["light-green-comfortable", preference("light", "green")],
    ["dark-purple-comfortable", preference("dark", "purple")],
    ["light-orange-compact", preference("light", "orange", "compact")],
    ["dark-blue-compact", preference("dark", "blue", "compact")],
  ] as const) {
    await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
      key: STORAGE_KEY,
      value: saved,
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${ASSET_PATH}?layout=card`);
    await expect(page.locator("html")).toHaveAttribute("data-theme", saved.themeMode);
    await expect(page.locator("html")).toHaveAttribute("data-density", saved.density);
    await expect(page.locator(".asset-page .tcard").first()).toBeVisible({ timeout: 20_000 });
    await expectNoPageOverflow(page);
    await capture(page, info, `warehouse-card-${name}`);
  }

  await page.evaluate(() => localStorage.setItem("dap-language", "en-US"));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${ASSET_PATH}?layout=list`);
  await expect(page.getByRole("group", { name: "View options" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cards" })).toBeVisible();
  await expect(page.getByText("Subject area", { exact: true }).first()).toBeVisible();
  await expectNoPageOverflow(page);
  await capture(page, info, "warehouse-english-list-1440x900");
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoPageOverflow(page);
  await capture(page, info, "warehouse-english-list-390x844");
});
