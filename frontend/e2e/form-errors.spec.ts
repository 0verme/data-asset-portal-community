import { expect, test } from "@playwright/test";

async function openFixture(page: import("@playwright/test").Page) {
  await page.goto("/__form-errors");
  await expect(page.getByRole("heading", { name: "Form Error Presenter Fixture" })).toBeVisible({ timeout: 15_000 });
}

for (const viewport of [
  { name: "desktop", width: 1280, height: 800 },
  { name: "390px mobile", width: 390, height: 844 },
]) {
  test(`form error presenter keeps context, focuses the first error, and scrolls its container (${viewport.name})`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await openFixture(page);

    const scrollContainer = page.getByTestId("form-scroll-container");
    const owner = page.getByRole("textbox", { name: "负责人" });
    const email = page.getByRole("textbox", { name: "邮箱" });
    const parameterName = page.getByRole("textbox", { name: "第 13 行参数名称" });
    await expect(owner).toHaveValue("初始负责人");
    await expect(email).toHaveValue("invalid-address");
    await expect(parameterName).toHaveValue("已输入的第 13 行参数名");
    await scrollContainer.evaluate((element) => { element.scrollTop = 0; });
    const pageScrollBefore = await page.evaluate(() => window.scrollY);

    await page.getByRole("button", { name: "提交表单" }).click();

    const summary = page.getByRole("alert");
    await expect(summary).toContainText("服务器校验要求确认负责人。");
    await expect(summary).toContainText("请输入有效的邮箱地址。");
    await expect(summary).toContainText("第 13 行参数名称需要调整。");
    await expect(owner).toHaveAttribute("aria-invalid", "true");
    await expect(owner).toHaveAccessibleDescription("服务器校验要求确认负责人。");
    await expect(email).toHaveAttribute("aria-invalid", "true");
    await expect(email).toHaveAccessibleDescription("请输入有效的邮箱地址。");
    await expect(owner).toBeFocused();
    await expect(owner).toHaveValue("初始负责人");
    await expect(email).toHaveValue("invalid-address");
    await expect(parameterName).toHaveValue("已输入的第 13 行参数名");

    const scrollTopAfterSubmit = await scrollContainer.evaluate((element) => element.scrollTop);
    expect(scrollTopAfterSubmit).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.scrollY)).toBe(pageScrollBefore);
    const ownerBounds = await owner.evaluate((element) => {
      const fieldRect = element.getBoundingClientRect();
      const containerRect = element.closest("[data-testid='form-scroll-container']")!.getBoundingClientRect();
      return { fieldTop: fieldRect.top, fieldBottom: fieldRect.bottom, containerTop: containerRect.top, containerBottom: containerRect.bottom };
    });
    expect(ownerBounds.fieldTop).toBeGreaterThanOrEqual(ownerBounds.containerTop);
    expect(ownerBounds.fieldBottom).toBeLessThanOrEqual(ownerBounds.containerBottom);

    await page.keyboard.press("Tab");
    await expect(email).toBeFocused();
    await summary.getByRole("button", { name: /负责人：服务器校验要求确认负责人/ }).click();
    await expect(owner).toBeFocused();

    await owner.fill("已修正负责人");
    await expect(owner).not.toHaveAttribute("aria-invalid", "true");
    await expect(summary).not.toContainText("服务器校验要求确认负责人。");
    await expect(email).toHaveAttribute("aria-invalid", "true");
    await expect(parameterName).toHaveAttribute("aria-invalid", "true");

    await email.fill("owner@example.test");
    await expect(email).not.toHaveAttribute("aria-invalid", "true");
    await expect(summary).not.toContainText("请输入有效的邮箱地址。");
    await expect(owner).toHaveValue("已修正负责人");
    expect(pageErrors).toEqual([]);
  });
}
