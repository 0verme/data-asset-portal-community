import { expect, test, type Page } from "@playwright/test";
import { appearanceKey } from "../src/appearance/preferences.ts";

async function preferences(page: Page, theme: "light" | "dark", accent: "green" | "purple" | "custom", language = "zh-CN") {
  await page.addInitScript(({ key, theme, accent, language }) => {
    localStorage.setItem("dap-language", language);
    localStorage.setItem("dap_auth", JSON.stringify({ role: "admin", user: "admin", name: "管理员" }));
    localStorage.setItem(key, JSON.stringify({ version: 1, themeMode: theme,
      accent: accent === "custom" ? { kind: "custom", hex: "#307b86" } : { kind: "preset", preset: accent },
      effects: "off", density: "comfortable" }));
  }, { key: appearanceKey("/", process.env["VITE_APPEARANCE_SCOPE"]), theme, accent, language });
}

test("legacy user form contains the Select, cycles focus and restores its opener", async ({ page }, info) => {
  await preferences(page, "light", "purple");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/system-management/users");
  const opener = page.locator(".head-actions").getByRole("button", { name: "新增用户" });
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "新增用户" });
  const close = dialog.getByRole("button", { name: "关闭弹窗" });
  await close.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button").last()).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  const role = dialog.getByRole("combobox", { name: "账号角色" });
  await role.click();
  const options = dialog.getByRole("listbox");
  await expect(options).toBeVisible();
  await page.screenshot({ path: info.outputPath("dialog-select.png") });
  await page.keyboard.press("Escape");
  await expect(options).toBeHidden();
  await expect(role).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

for (const [theme, accent, language] of [["light", "green", "zh-CN"], ["dark", "purple", "en-US"], ["light", "custom", "en-US"]] as const) {
  test(`filters, pagination and search contrast in ${theme} / ${accent}`, async ({ page }, info) => {
    await preferences(page, theme, accent, language);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/code-table-maintenance");
    const selected = page.locator(".sidebar-filter-group button[aria-pressed=true]").first();
    await expect(selected).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-accent", accent);
    const colors = await selected.evaluate(el => {
      const probe = document.createElement("span");
      el.append(probe);
      probe.style.color = "var(--accent)";
      const expected = getComputedStyle(probe).color;
      probe.remove();
      return { line: getComputedStyle(el, "::before").backgroundColor, expected };
    });
    expect(colors.line).toBe(colors.expected);
    await expect(page.locator(".code-table-page table tbody tr")).toHaveCount(8);
    if (accent === "purple") await page.screenshot({ path: info.outputPath("shared-filter.png") });
    await page.goto("/data-warehouse?layout=list&q=" + encodeURIComponent("订单"));
    const mark = page.locator("mark.hl").first();
    await expect(mark).toBeVisible();
    const ratio = await mark.evaluate(el => {
      const ctx = document.createElement("canvas").getContext("2d")!;
      function luminance(color: string) {
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, 1, 1);
        const rgb = [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3).map(byte => {
          const c = byte / 255;
          return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        });
        return rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
      }
      const style = getComputedStyle(el);
      const fg = luminance(style.color), bg = luminance(style.backgroundColor);
      return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
    });
    expect(ratio).toBeGreaterThanOrEqual(4.5);
    await expect(page.locator(".dap-table-pagination")).toContainText(language === "en-US" ? /total|rows|items/i : /共/);
    if (accent === "custom") await page.screenshot({ path: info.outputPath("highlight.png") });
  });
}

test("home and peer workspaces retain shell and readiness hierarchy", async ({ page }, info) => {
  await preferences(page, "light", "green");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.locator(".sp-stats .sp-stat-num")).toHaveCount(11);
  await page.screenshot({ path: info.outputPath("home.png") });
  await page.setViewportSize({ width: 1920, height: 1080 });
  for (const route of ["upstream", "data-warehouse"]) {
    await page.goto("/" + route);
    await expect(page.locator("h1.page-title")).toBeVisible();
    const readiness = page.locator(`.module-readiness[data-module="${route}"]`);
    await expect(readiness.getByRole("status")).toContainText("口径待确认");
    await expect(readiness.locator("progress")).toHaveCount(0);
    if (route === "upstream") await expect(page.locator(".upstream-summary-number")).toHaveText("7 / 8");
    await page.screenshot({ path: info.outputPath(route + ".png") });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const hamburger = page.locator(".hamburger");
  await hamburger.click();
  const drawer = page.locator("#mobile-sidebar");
  await expect(drawer).toBeFocused();
  await expect.poll(() => drawer.evaluate(el => Math.round(el.getBoundingClientRect().left))).toBe(0);
  await page.keyboard.press("Shift+Tab");
  const last = await page.evaluateHandle(() => document.activeElement);
  expect(await drawer.evaluate((el, active) => active !== el && el.contains(active), last)).toBe(true);
  await page.keyboard.press("Tab");
  expect(await drawer.evaluate((el, previous) => el.contains(document.activeElement) && previous !== document.activeElement, last)).toBe(true);
  await page.keyboard.press("Shift+Tab");
  expect(await page.evaluate(active => active === document.activeElement, last)).toBe(true);
  await page.keyboard.press("Tab");
  await page.screenshot({ path: info.outputPath("drawer.png") });
  await page.keyboard.press("Escape");
  await expect(hamburger).toBeFocused();
  const brand = page.locator("button.brand");
  await expect(brand).toHaveAccessibleName("数据资产门户");
  await brand.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".sp-stats")).toBeVisible();
});

test("search highlights the matching business text across shared consumers", async ({ page }) => {
  await preferences(page, "light", "custom");
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const [path, field] of [
    ["/indicator-maintenance?view=list", ".indicator-id"],
    ["/report-assets?view=list", ".indicator-id"],
    ["/root-management", ".root-abbr"],
    ["/push?view=list", ".sys-name"],
    ["/code-table-maintenance", 'td[data-label="表编码"]'],
    ["/system-management/users", ".system-user-name"],
  ] as const) {
    await test.step(path, async () => {
      await page.goto(path);
      if (path === "/root-management") {
        expect(process.env["VITE_API_MODE"]).toBe("mock");
        await page.locator(".root-page .page-head").getByRole("button", { name: "新增词根" }).click();
        await page.getByLabel("词根缩写").fill("fixture");
        await page.getByLabel("中文名").fill("测试词根");
        await page.getByRole("button", { name: "保存", exact: true }).click();
      }
      const cell = page.locator(field).first();
      await expect(cell).toBeVisible();
      const text = (await cell.innerText()).trim().slice(0, 3);
      expect(text.length).toBeGreaterThan(0);
      await page.locator("#global-search input").fill(text);
      await expect(page.locator("main mark.hl").first()).toHaveText(new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
    });
  }
});

test("a service confirmation inside an edit form returns focus to the delete action on cancel", async ({ page }) => {
  await preferences(page, "light", "green");
  await page.goto("/system-management/users");
  await page.locator("tbody tr").filter({ hasText: "supply_demo" }).getByRole("button", { name: "编辑" }).click();
  const form = page.getByRole("dialog", { name: "编辑用户" });
  const remove = form.getByRole("button", { name: "删除用户" });
  await remove.click();
  const confirm = page.getByRole("alertdialog");
  const input = confirm.getByRole("textbox");
  await input.focus();
  await expect(input).toBeFocused();
  await page.keyboard.type("supply_demo");
  await expect(confirm.getByRole("button", { name: "确认删除" })).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(confirm).toBeHidden();
  await expect(remove).toBeFocused();
  await expect(form).toBeVisible();
});
