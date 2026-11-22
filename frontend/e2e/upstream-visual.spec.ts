import { expect, test } from "@playwright/test";
import {
  appearanceKey,
  type AppearancePreferenceV1,
} from "../src/appearance/preferences.ts";

const storageKey = appearanceKey("/", process.env["VITE_APPEARANCE_SCOPE"]);

const preference = (
  themeMode: "light" | "dark",
  preset: "green" | "blue" | "purple" | "orange",
  density: "comfortable" | "compact" = "comfortable",
): AppearancePreferenceV1 => ({
  version: 1,
  themeMode,
  accent: { kind: "preset", preset },
  effects: "off",
  density,
});

test("upstream workspace responsive and theme evidence", async ({ page, browserName }, info) => {
  test.skip(browserName !== "chromium", "Visual evidence is captured once in Chromium; functional coverage also runs in WebKit.");
  test.setTimeout(120_000);

  const initialPreference = preference("light", "green");
  await page.addInitScript(({ key, saved }) => {
    if (!localStorage.getItem(key)) {
      localStorage.setItem(key, JSON.stringify(saved));
      localStorage.setItem(`${key}:initialized`, "1");
    }
    localStorage.setItem("dap_auth", JSON.stringify({ role: "admin", user: "admin", name: "管理员" }));
  }, { key: storageKey, saved: initialPreference });

  const screenshot = async (name: string): Promise<void> => {
    await page.screenshot({
      path: info.outputPath(`${name}.png`),
      fullPage: true,
      animations: "disabled",
    });
  };

  const expectNoPageOverflow = async (): Promise<void> => {
    const dimensions = await page.evaluate(() => ({
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
    }));
    expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 1);
  };

  const expectSharedNavigationShape = async (): Promise<void> => {
    const shape = await page.locator("nav.mainnav").first().evaluate((nav) => ({
      containerRadius: getComputedStyle(nav).borderRadius,
      itemRadius: getComputedStyle(nav.querySelector("button")!).borderRadius,
      gap: getComputedStyle(nav).gap,
    }));
    expect(shape).toEqual({ containerRadius: "999px", itemRadius: "999px", gap: "0px" });
  };

  for (const size of [
    { name: "1920x1080", width: 1920, height: 1080 },
    { name: "2560x1440", width: 2560, height: 1440 },
    { name: "1440x900", width: 1440, height: 900 },
    { name: "768x1024", width: 768, height: 1024 },
    { name: "390x844", width: 390, height: 844 },
  ]) {
    await page.setViewportSize({ width: size.width, height: size.height });

    await page.goto("/upstream?view=list");
    await expect(page.locator(".upstream-list-page .page-title")).toBeVisible({ timeout: 20_000 });
    await expectSharedNavigationShape();
    const listMode = page.locator(".upstream-list-page .seg").getByRole("button", { name: "列表", exact: true });
    await listMode.click();
    await expect(listMode).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".upstream-wide-table")).toBeVisible();
    await expectNoPageOverflow();
    await screenshot(`upstream-list-${size.name}`);

    const cardMode = page.locator(".upstream-list-page .seg").getByRole("button", { name: "卡片", exact: true });
    await cardMode.click();
    await expect(cardMode).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".upstream-list-page .tcard").first()).toBeVisible();
    await expectNoPageOverflow();
    await screenshot(`upstream-cards-${size.name}`);

    await page.goto("/upstream/up_member");
    await expect(page.locator(".upstream-detail-title")).toBeVisible();
    await expect(page.getByRole("heading", { name: "卸数计划" })).toBeVisible();
    await expectNoPageOverflow();
    await screenshot(`upstream-detail-${size.name}`);
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/upstream?view=list");
  const filterOption = page.getByRole("button", { name: /PostgreSQL/ }).first();
  await expect(filterOption).toBeVisible();
  const summary = page.getByRole("region", { name: "系统覆盖摘要" });
  await expect(summary).toContainText("已启用 7 个上游系统");
  await filterOption.click();
  await page.locator(".upstream-sidebar .side-item").filter({ hasText: /^禁用/ }).click();
  await expect(summary.locator("progress")).toHaveAttribute("max", "8");
  await expect(summary.locator("progress")).toHaveAttribute("value", "7");
  await expect(summary).toContainText("7 类");
  await expect(page.getByRole("button", { name: "清空筛选" })).toBeEnabled();
  await page.getByRole("button", { name: "清空筛选" }).click();
  await expect(page.getByRole("button", { name: "清空筛选" })).toBeDisabled();

  const row = page.locator(".upstream-wide-table tbody tr").filter({ hasText: "会员中心" }).first();
  await row.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/upstream\/up_member$/);

  await page.goto("/upstream?view=list");
  await page.locator(".upstream-list-page .seg").getByRole("button", { name: "列表", exact: true }).click();
  const card = page.locator(".upstream-list-page .tcard").filter({ hasText: "会员中心" }).first();
  await page.locator(".upstream-list-page .seg").getByRole("button", { name: "卡片", exact: true }).click();
  await expect(card).toBeVisible();
  await card.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/upstream\/up_member$/);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/upstream/up_member/edit");
  await expect(page.getByRole("heading", { name: "编辑上游卸数系统" })).toBeVisible();
  await screenshot("upstream-edit-1440x900");
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoPageOverflow();
  await screenshot("upstream-edit-390x844");

  await page.goto("/upstream/new");
  await expect(page.getByRole("heading", { name: "新增上游卸数系统" })).toBeVisible();
  await screenshot("upstream-new-390x844");

  await page.goto("/upstream?view=list");
  await page.locator(".upstream-list-page .seg").getByRole("button", { name: "列表", exact: true }).click();
  await page.locator(".upstream-list-page .seg").getByRole("button", { name: "卡片", exact: true }).click();
  await expect(page.locator(".upstream-list-page .tcard").first()).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("button.hamburger").click();
  await expect(page.locator("#mobile-sidebar")).toHaveClass(/open/);
  await expect(page.locator(".upstream-sidebar")).toBeVisible();
  await expect(summary).toBeInViewport();
  const menu = page.locator(".sidebar-content");
  await expect.poll(() => page.locator("#mobile-sidebar").evaluate((el) => Math.round(el.getBoundingClientRect().left))).toBe(0);
  const before = await summary.boundingBox();
  await menu.getByRole("button", { name: "新增系统" }).scrollIntoViewIfNeeded();
  expect(await menu.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  expect(await summary.boundingBox()).toEqual(before);
  await menu.evaluate((el) => { el.scrollTop = 0; });
  await screenshot("upstream-sidebar-open-390x844");

  for (const [name, saved] of [
    ["light-green-comfortable", preference("light", "green")],
    ["dark-purple-comfortable", preference("dark", "purple")],
    ["light-orange-compact", preference("light", "orange", "compact")],
    ["dark-blue-compact", preference("dark", "blue", "compact")],
  ] as const) {
    await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
      key: storageKey,
      value: saved,
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/upstream?view=list");
    await page.locator(".upstream-list-page .seg").getByRole("button", { name: "列表", exact: true }).click();
    await page.locator(".upstream-list-page .seg").getByRole("button", { name: "卡片", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", saved.themeMode);
    await expect(page.locator("html")).toHaveAttribute("data-density", saved.density);
    await expect(page.locator(".upstream-list-page .tcard").first()).toBeVisible();
    const themeColors = await page.evaluate(() => {
      const probe = document.createElement("span");
      probe.style.color = "var(--accent)";
      document.body.append(probe);
      const accent = getComputedStyle(probe).color;
      probe.style.color = "var(--accent-soft-color)";
      const selected = getComputedStyle(probe).color;
      probe.remove();
      return { accent, selected };
    });
    const activeFilter = page.locator(".upstream-sidebar .side-item.active").first();
    await expect(activeFilter).toHaveCSS("color", themeColors.selected);
    expect(await activeFilter.evaluate((el) => getComputedStyle(el, "::before").backgroundColor)).toBe(themeColors.accent);
    await expect(summary.locator(".upstream-summary-types strong")).toHaveCSS("color", themeColors.accent);
    await screenshot(`upstream-cards-${name}`);
  }

  await page.evaluate(({ key }) => localStorage.removeItem(key), { key: storageKey });
});

test("guest sees coverage without maintenance actions", async ({ page }) => {
  await page.goto("/upstream");
  const rail = page.locator(".sidebar-panel");
  await expect(rail.locator("progress")).toHaveAttribute("value", "7");
  await expect(rail.getByRole("button", { name: "新增系统" })).toHaveCount(0);
});
