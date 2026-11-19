import { expect, test, type Page } from "@playwright/test";
import { appearanceKey, defaults, makeAccentPalette } from "../src/appearance/preferences.ts";

const key = appearanceKey("/", process.env["VITE_APPEARANCE_SCOPE"]);
const deploymentDefaults = defaults(process.env["VITE_DEFAULT_ACCENT"]);
const labels = { green: "翠绿", blue: "深海蓝", purple: "暮光紫", orange: "暖橙" } as const;
const trigger = (page: Page) => page.getByRole("button", { name: "风格设置", exact: true });
const settings = (page: Page) => page.getByRole("dialog", { name: "风格设置" });
const saved = (page: Page) => page.evaluate((name) => JSON.parse(localStorage.getItem(name) ?? "null"), key);

async function openSettings(page: Page) {
  await trigger(page).click();
  await expect(settings(page)).toBeVisible();
  return settings(page);
}

test("header tooltip, first focus, keyboard boundaries, Escape and pointer dismissal", async ({ page, browserName }) => {
  await page.goto("/");
  const button = trigger(page);
  await expect(button).toHaveCount(1);
  await button.hover();
  await expect(page.getByRole("tooltip")).toHaveText("风格设置");
  await button.press("Enter");
  const drawer = settings(page);
  const close = drawer.getByRole("button", { name: "关闭风格设置" });
  await expect(close).toBeFocused();
  // WebKit's macOS tab convention uses Option+Tab to visit every control.
  const tab = browserName === "webkit" && process.platform === "darwin" ? "Alt+Tab" : "Tab";
  await page.keyboard.press(tab);
  await expect(drawer.getByRole("radio", { name: "跟随系统" })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(drawer.getByRole("radio", { name: "浅色" })).toBeChecked();
  await page.keyboard.press(`Shift+${tab}`);
  await expect(close).toBeFocused();
  await page.keyboard.press(`Shift+${tab}`);
  await expect(drawer.getByRole("button", { name: "切换到英文" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(button).toBeFocused();
  await expect(button).toHaveAttribute("aria-expanded", "false");

  await openSettings(page);
  await page.mouse.click(25, 200);
  await expect(drawer).toBeHidden();
  await expect(button).toBeFocused();
});

test("all presets and custom HEX update immediately, persist, and restore the deployment defaults", async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
  await page.goto("/");
  const drawer = await openSettings(page);
  const html = page.locator("html");
  const hex = drawer.getByRole("textbox", { name: "自定义颜色" });
  const screenshot = (name: string) => page.screenshot({ path: info.outputPath(`appearance-drawer-${name}-1440.png`), animations: "disabled" });

  await expect(drawer.getByRole("radio", { name: labels[deploymentDefaults.accent.preset] })).toBeChecked();
  for (const [preset, label] of Object.entries(labels)) {
    const theme = preset === "purple" || preset === "orange" ? "dark" : "light";
    await drawer.getByRole("radio", { name: theme === "light" ? "浅色" : "深色" }).check();
    const radio = drawer.getByRole("radio", { name: label });
    await radio.check();
    await expect(radio).toBeChecked();
    await expect(html).toHaveAttribute("data-theme", theme);
    await expect(html).toHaveAttribute("data-accent", preset);
    await screenshot(`${theme}-${preset}`);
  }

  await hex.fill("#FFF");
  await expect(hex).toHaveAttribute("aria-invalid", "true");
  await expect(hex).toHaveAccessibleDescription(/请输入有效的 HEX 颜色/);
  await expect(html).toHaveAttribute("data-accent", "orange");
  expect((await saved(page)).accent).toEqual({ kind: "preset", preset: "orange" });
  for (const name of ["浅色", "完整", "紧凑", "深色"]) {
    await drawer.getByRole("radio", { name, exact: true }).check();
    await expect(hex).toHaveValue("#FFF");
    await expect(hex).toHaveAttribute("aria-invalid", "true");
  }
  await drawer.getByRole("radio", { name: "翠绿" }).check();
  await expect(hex).toHaveValue("");
  await expect(hex).toHaveAttribute("aria-invalid", "false");
  await hex.fill("#000000");
  await expect(hex).toHaveAttribute("aria-invalid", "false");
  await expect(html).toHaveAttribute("data-accent", "custom");
  await expect(drawer.getByRole("img", { name: "当前生效的主题色" }))
    .toHaveCSS("background-color", makeAccentPalette("#000000", "dark")!["--accent"].replaceAll(",", ", "));
  await screenshot("dark-custom-compact");

  await hex.fill("#0000x");
  await expect(hex).toHaveAttribute("aria-invalid", "true");
  expect((await saved(page)).accent).toEqual({ kind: "custom", hex: "#000000" });
  await drawer.getByRole("button", { name: "关闭风格设置" }).click();
  await expect(trigger(page)).toBeFocused();
  await expect(page.getByRole("button", { name: "切换到浅色主题" })).toBeVisible();
  await openSettings(page);
  await expect(hex).toHaveValue("#000000");
  await page.reload();
  await openSettings(page);
  await expect(hex).toHaveValue("#000000");
  for (const name of ["深色", "完整", "紧凑"]) await expect(drawer.getByRole("radio", { name })).toBeChecked();
  await drawer.getByRole("button", { name: "恢复默认" }).click();
  expect(await saved(page)).toEqual(deploymentDefaults);
  await expect(hex).toHaveValue("");
  await expect(drawer.getByRole("radio", { name: labels[deploymentDefaults.accent.preset] })).toBeChecked();
  await expect(html).toHaveAttribute("data-theme", "light");
});

test("system appearance, effects and language update while the drawer stays open", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "no-preference" });
  await page.goto("/");
  const drawer = await openSettings(page);
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-theme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(html).toHaveAttribute("data-theme", "light");
  await drawer.getByRole("radio", { name: "完整" }).check();
  await expect(html).toHaveAttribute("data-effects", "full");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(html).toHaveAttribute("data-effects", "off");
  await expect(drawer.getByRole("radio", { name: "完整" })).toBeChecked();
  await expect(drawer.getByRole("status")).toContainText("系统已启用减少动态效果");
  expect((await saved(page)).effects).toBe("full");

  await drawer.getByRole("button", { name: "切换到英文" }).click();
  const english = page.getByRole("dialog", { name: "Appearance settings" });
  await expect(english).toBeVisible();
  await expect(html).toHaveAttribute("lang", "en-US");
  await expect(english.getByRole("group", { name: "Display density" })).toBeVisible();
  await expect(english.getByRole("status")).toContainText("prefers reduced motion");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(html).toHaveAttribute("data-effects", "full");
  await expect(english.getByRole("status")).toHaveCount(0);
  for (const [name, level] of [["Subtle", "subtle"], ["Off", "off"]]) {
    await english.getByRole("radio", { name, exact: true }).check();
    await expect(html).toHaveAttribute("data-effects", level);
  }

  await english.getByRole("button", { name: "Switch language to Chinese" }).click();
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("radio", { name: "关闭", exact: true })).toBeChecked();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await page.getByRole("button", { name: "切换到深色主题" }).click();
  await openSettings(page);
  await expect(drawer.getByRole("radio", { name: "深色" })).toBeChecked();
});

test("compact density reduces catalog row padding without changing horizontal scrolling", async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/data-warehouse?layout=list");
  const table = page.locator(".asset-wide-table");
  const cell = table.locator("tbody td").first();
  const scrollWidth = await table.evaluate((element) => element.closest(".wide-table-scroll")!.scrollWidth);
  await expect(cell).toHaveCSS("padding-top", "13px");
  const drawer = await openSettings(page);
  await drawer.getByRole("radio", { name: "紧凑" }).check();
  await expect(cell).toHaveCSS("padding-top", "8px");
  const main = page.locator(".main");
  expect(await main.evaluate((element) => element.scrollHeight)).toBeGreaterThan(await main.evaluate((element) => element.clientHeight));
  await page.mouse.move(300, 500);
  await page.mouse.wheel(0, 400);
  await expect(page.getByRole("textbox", { name: "全局搜索" })).toHaveCount(0);
  expect(await main.evaluate((element) => element.scrollTop)).toBe(0);
  await drawer.getByRole("button", { name: "关闭风格设置" }).click();
  await expect(drawer).toBeHidden();
  expect(await table.evaluate((element) => element.closest(".wide-table-scroll")!.scrollWidth)).toBe(scrollWidth);
  await page.screenshot({ path: info.outputPath("appearance-compact-catalog-1440.png"), animations: "disabled" });
});

test.describe("touch layouts", () => {
  test.use({ hasTouch: true, isMobile: true });

  for (const width of [320, 390, 768]) {
    test(`drawer fits, scrolls and keeps actions available at ${width}px`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 640 });
      await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
      await page.goto("/data-warehouse?layout=list");
      for (const selector of [".appearance-trigger", ".theme-toggle", ".mobile-search-toggle", ".topbar .login-cta"]) {
        const box = await page.locator(selector).boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
      }
      const drawer = await openSettings(page);
      const close = drawer.getByRole("button", { name: "关闭风格设置" });
      const restore = drawer.getByRole("button", { name: "恢复默认" });
      const region = drawer.locator(".appearance-scroll");
      const hex = drawer.getByRole("textbox", { name: "自定义颜色" });
      const screenshot = (name: string) => page.screenshot({ path: info.outputPath(`appearance-drawer-${name}-${width}.png`), animations: "disabled" });

      await expect.poll(async () => (await drawer.boundingBox())!.x).toBe(width - Math.min(420, width));
      await expect(close).toBeInViewport({ ratio: 1 });
      await expect(restore).toBeInViewport({ ratio: 1 });
      expect(await region.evaluate((element) => element.scrollHeight)).toBeGreaterThan(await region.evaluate((element) => element.clientHeight));
      await screenshot("mobile-light");
      await drawer.getByRole("radio", { name: "深色" }).check();
      await screenshot("mobile-dark");
      const cards = page.locator(".asset-wide-table tbody");
      await expect(cards).toHaveCSS("row-gap", "12px");
      await drawer.getByRole("radio", { name: "紧凑" }).check();
      await expect(cards).toHaveCSS("row-gap", "8px");

      await hex.fill("#25");
      await hex.focus();
      // Headless browsers do not show the system keyboard. Drive the visual
      // viewport resize/pan events it emits while keeping the layout viewport fixed.
      await page.evaluate(() => {
        const viewport = window.visualViewport!;
        Object.defineProperties(viewport, { height: { value: 340 }, offsetTop: { value: 32 } });
        viewport.dispatchEvent(new Event("resize"));
        viewport.dispatchEvent(new Event("scroll"));
      });
      await expect.poll(async () => (await drawer.boundingBox())!.height).toBe(340);
      expect((await drawer.boundingBox())!.y).toBe(32);
      await region.evaluate((element) => element.querySelector("input[type=text]")!.scrollIntoView({ block: "center" }));
      await expect(hex).toBeInViewport({ ratio: 1 });
      await expect(hex).toBeFocused();
      await expect(hex).toHaveAttribute("aria-invalid", "true");
      await expect(close).toBeInViewport({ ratio: 1 });
      await expect(restore).toBeInViewport({ ratio: 1 });
      await screenshot("mobile-hex-edit");
      await restore.tap();
      await expect(hex).toHaveValue("");
      await close.tap();
      await expect(drawer).toBeHidden();
      await expect(trigger(page)).toBeFocused();
    });
  }
});
