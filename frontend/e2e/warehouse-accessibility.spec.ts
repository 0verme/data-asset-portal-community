import { expect, test, type Page } from "@playwright/test";
import { appearanceKey } from "../src/appearance/preferences.ts";

const ASSET_NAME = "dwm_trade_order_item_di";
const APPEARANCE_KEY = appearanceKey("/", process.env["VITE_APPEARANCE_SCOPE"]);

async function setLightAppearance(page: Page) {
  await page.addInitScript((key) => {
    localStorage.setItem(key, JSON.stringify({
      version: 1,
      themeMode: "light",
      accent: { kind: "preset", preset: "green" },
      effects: "subtle",
      density: "comfortable",
    }));
  }, APPEARANCE_KEY);
}

async function openFilteredView(page: Page, layout: "list" | "card" | "group") {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/data-warehouse?layout=${layout}&q=${encodeURIComponent("订单商品")}`);
  const entry = layout === "card"
    ? page.locator(".asset-page .tcard[role=button]").first()
    : page.locator(".asset-page .asset-detail-trigger").first();
  await expect(entry).toBeVisible({ timeout: 20_000 });
}

async function focusFirstDetailActionByTab(page: Page) {
  const layout = new URL(page.url()).searchParams.get("layout");
  const trigger = layout === "card"
    ? page.locator(".asset-page .tcard[role=button]").first()
    : page.locator(".asset-page .asset-detail-trigger").first();
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  for (let index = 0; index < 80; index += 1) {
    await page.keyboard.press("Tab");
    if (await trigger.evaluate((element) => element === document.activeElement)) return trigger;
  }
  throw new Error("Tab did not reach the data warehouse detail action");
}

test("list, card, and group detail actions are reachable with Tab and activate once with Enter or Space", async ({ page }) => {
  for (const [layout, key] of [["list", "Enter"], ["card", "Space"], ["group", "Enter"]] as const) {
    await openFilteredView(page, layout);
    const trigger = await focusFirstDetailActionByTab(page);
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveCSS("outline-width", "2px");

    await page.evaluate(() => {
      const target = window as Window & { __warehousePushStateCalls?: number };
      target.__warehousePushStateCalls = 0;
      const pushState = window.history.pushState.bind(window.history);
      window.history.pushState = (...args) => {
        target.__warehousePushStateCalls = (target.__warehousePushStateCalls || 0) + 1;
        return pushState(...args);
      };
    });
    await page.keyboard.press(key);
    await expect(page.locator(".dh-en")).toHaveText(ASSET_NAME);
    await expect(page).toHaveURL(new RegExp(`/data-warehouse/${ASSET_NAME}`));
    expect(await page.evaluate(() => (window as Window & { __warehousePushStateCalls?: number }).__warehousePushStateCalls)).toBe(1);
  }
});

test("warehouse field types meet AA contrast in light mode without changing downstream type styling", async ({ page }) => {
  await setLightAppearance(page);
  await page.goto(`/data-warehouse/${ASSET_NAME}`);
  await expect(page.locator(".asset-detail-page table.fields .c-type").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  const contrast = await page.locator(".asset-detail-page table.fields .c-type").first().evaluate((element) => {
    const color = getComputedStyle(element).color;
    const probe = document.createElement("span");
    probe.style.color = "var(--ink-2)";
    document.body.append(probe);
    const ink = getComputedStyle(probe).color;
    probe.remove();
    const surface = getComputedStyle(document.querySelector(".asset-detail-panel")!).backgroundColor;
    const rgb = (value: string) => {
      const match = value.match(/(?:rgb\()?\s*(\d+)\D+(\d+)\D+(\d+)/i);
      return match ? match.slice(1).map(Number) : null;
    };
    const luminance = (value: number[]) => value
      .map((channel) => {
        const srgb = channel / 255;
        return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
      })
      .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index]!, 0);
    const foreground = rgb(color);
    const background = rgb(surface);
    if (!foreground || !background) throw new Error(`Could not parse computed colors: ${color} on ${surface}`);
    const first = luminance(foreground);
    const second = luminance(background);
    return { color, ink, ratio: (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05) };
  });
  expect(contrast.color).toBe(contrast.ink);
  expect(contrast.ratio).toBeGreaterThanOrEqual(4.5);

  await page.goto("/push/DEMO_BI/JOB_BI_01");
  const downstreamType = page.locator("table.fields .c-type").first();
  await expect(downstreamType).toBeVisible({ timeout: 20_000 });
  await expect(downstreamType).toHaveCSS("color", "rgb(192, 132, 252)");
});
