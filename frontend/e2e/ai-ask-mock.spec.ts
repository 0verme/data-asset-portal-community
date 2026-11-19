import { expect, test } from "@playwright/test";

test("static Mock AI uses catalog assets and never calls remote AI endpoints", async ({ page }) => {
  const remoteAiCalls: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/ai/")) remoteAiCalls.push(request.url());
  });
  await page.goto("/");
  await page.getByRole("textbox", { name: "搜索数据资产" }).fill("订单金额在哪张表？");
  await page.getByRole("button", { name: "问 AI", exact: true }).click();
  await expect(page.getByText("模拟演示 · 非真实 AI 回答")).toBeVisible();
  await expect(page.locator(".sp-ai-candidate").first()).toBeVisible();
  await expect(page.locator(".sp-ai-summary")).toContainText("【模拟演示】");
  expect(remoteAiCalls).toEqual([]);
  await page.locator(".sp-ai-candidate").first().click();
  await expect(page).toHaveURL(/\/data-warehouse\/dwm_trade_order_detail_di\?(?=.*assetId=\d+)/);
  await expect(page.locator(".detail-head .dh-en")).toHaveText("dwm_trade_order_detail_di");
  await expect(page.getByRole("tab", { name: /字段信息/ })).toBeVisible();
});

test("static Mock AI rejects unknown evidence and preserves keyword search", async ({ page }) => {
  const remoteAiCalls: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/ai/")) remoteAiCalls.push(request.url());
  });
  await page.goto("/");
  const input = page.getByRole("textbox", { name: "搜索数据资产" });
  await input.fill("贷款余额在哪张表？");
  await page.getByRole("button", { name: "问 AI", exact: true }).click();
  await expect(page.locator(".sp-ai-state")).toContainText("未在演示目录中找到");
  await expect(page.locator(".sp-ai-candidate")).toHaveCount(0);
  await input.fill("会员");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(page.locator(".sp-hit").first()).toBeVisible();
  expect(remoteAiCalls).toEqual([]);
});

test("portal orb follows Mock progress without inventing a generation phase", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const orb = page.locator(".sp-data-orb");
  await orb.evaluate((element) => {
    const states = new Set<string>();
    new MutationObserver(() => {
      states.add(element.getAttribute("data-status") ?? "");
      element.setAttribute("data-observed-states", [...states].join(" "));
    }).observe(element, { attributes: true, attributeFilter: ["data-status"] });
  });

  await page.getByRole("textbox", { name: "搜索数据资产" }).fill("订单金额在哪张表？");
  await page.getByRole("button", { name: "问 AI", exact: true }).click();
  await expect(orb).toHaveAttribute("data-status", "completed");
  const states = (await orb.getAttribute("data-observed-states"))?.split(" ");
  expect(states).toEqual(expect.arrayContaining(["processing", "retrieving", "completed"]));
  expect(states).not.toContain("generating");
  await page.getByRole("tab", { name: /搜索结果/ }).click();
  await expect(orb).toHaveAttribute("data-status", "idle");
});
