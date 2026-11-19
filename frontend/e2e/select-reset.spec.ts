import { expect, test, type Page } from "@playwright/test";
import { appearanceKey, defaults } from "../src/appearance/preferences.ts";

const appearance = appearanceKey("/", process.env["VITE_APPEARANCE_SCOPE"]);

async function expectSelectSpacing(page: Page) {
  const listbox = page.getByRole("listbox");
  const popup = listbox.locator("..");
  const option = listbox.getByRole("option").first();

  await expect(popup).toBeVisible();
  await expect(option).toHaveAttribute("data-kumo-part", "option");

  // Kumo's Popup uses py-1.5. Option uses mx-1.5, px-2 and py-1.5.
  // These are computed values at DAP's default root size, including the rendered row height.
  await expect(popup).toHaveCSS("padding-block", "6px");
  await expect(option).toHaveCSS("padding-block", "6px");
  await expect(option).toHaveCSS("padding-inline", "8px");
  await expect(option).toHaveCSS("margin-inline", "6px");
  await expect(option).toHaveCSS("box-sizing", "border-box");
  const row = await option.evaluate((element) => ({
    height: element.getBoundingClientRect().height,
    lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight),
  }));
  expect(row.height).toBeGreaterThanOrEqual(row.lineHeight + 12);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("dap_auth", JSON.stringify({ role: "admin", user: "admin", name: "管理员" }));
  });
});

for (const { themeMode, colorScheme, width } of [
  { themeMode: "light", colorScheme: "dark", width: 1440 },
  { themeMode: "dark", colorScheme: "light", width: 390 },
  { themeMode: "system", colorScheme: "dark", width: 390 },
] as const) {
  test(`TableEditor Select retains Kumo spacing in ${themeMode} mode at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await page.addInitScript(({ key, preference }) => {
      localStorage.setItem(key, JSON.stringify(preference));
    }, { key: appearance, preference: { ...defaults(), themeMode } });

    await page.goto("/data-warehouse/dwm_trade_order_item_di");
    await page.getByRole("button", { name: "编辑表", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-mode", themeMode);
    await expect(page.locator("html")).toHaveAttribute("data-theme", themeMode === "system" ? colorScheme : themeMode);

    const form = page.locator("#table-editor-form");
    for (const label of ["主题域", "数据层级"]) {
      const trigger = form.getByRole("combobox", { name: label, exact: true });
      await expect(trigger).toHaveAttribute("data-kumo-part", "trigger");
      await trigger.press("Enter");
      await expectSelectSpacing(page);
      // The listbox belongs to the Kumo portal, outside the editor's scroll container.
      await expect(form.getByRole("listbox")).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("listbox")).toBeHidden();
      await expect(trigger).toBeFocused();

      if (width === 390) {
        await trigger.click();
        const lastOption = page.getByRole("listbox").getByRole("option").last();
        const optionLabel = await lastOption.innerText();
        // Longer menus overlap the sticky action bar at this height.
        await lastOption.click();
        await expect(trigger).toContainText(optionLabel.split(" · ")[0]);
      }
    }
  });
}

test("page-size and business filter Select retain Kumo spacing and accept pointer input", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/data-warehouse?layout=list");
  const pager = page.getByRole("navigation", { name: "数据仓库资产表分页" });
  const pageSize = pager.getByRole("combobox", { name: "每页条数" });
  await pageSize.click();
  await expectSelectSpacing(page);
  await page.getByRole("option", { name: "50", exact: true }).click();
  await expect(pageSize).toHaveText("50");

  await page.goto("/system-management/operation-logs");
  const filter = page.getByRole("combobox", { name: "操作结果" });
  await filter.click();
  await expectSelectSpacing(page);
  await page.getByRole("option", { name: "成功", exact: true }).click();
  await expect(filter).toHaveText("成功");
});
