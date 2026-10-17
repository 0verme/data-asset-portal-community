import { expect, test, type Page } from "@playwright/test";

async function setMockAuth(page: Page, mode: "guest" | "admin"): Promise<void> {
  await page.addInitScript((authMode) => {
    localStorage.removeItem("dap_auth");
    if (authMode === "guest") return;
    localStorage.setItem("dap_auth", JSON.stringify({ role: "admin", user: "admin", name: "管理员" }));
  }, mode);
}

async function mockRemoteApiAssetApi(page: Page): Promise<{
  postCount: () => number;
  submittedPayloads: () => Record<string, unknown>[];
}> {
  let posts = 0;
  const submittedPayloads: Record<string, unknown>[] = [];
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname.replace(/^\/api/, "");
    if (pathname === "/auth/me") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { role: "admin", user: "admin", name: "管理员", permissions: ["api_asset:read", "api_asset:write"] } }),
      });
      return;
    }
    if (pathname === "/api-assets/systems") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items: [{ id: 3, code: "ORDER_CENTER", name: "订单中心", short_name: "订单", type: "business", status: "enabled" }] }),
      });
      return;
    }
    if (pathname === "/api-assets" && request.method() === "POST") {
      posts += 1;
      const payload = request.postDataJSON() as Record<string, unknown>;
      submittedPayloads.push(payload);
      if (posts === 1) {
        await route.fulfill({
          status: 422,
          contentType: "application/json",
          body: JSON.stringify({
            error: {
              code: "API_ASSET_VALIDATION_FAILED",
              message: "API asset validation failed",
              details: [
                { field: "params[0]", message: "required fields are invalid" },
                { field: "name", message: "name is required" },
              ],
            },
          }),
        });
        return;
      }
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ message: "API asset created", data: payload }),
      });
      return;
    }
    if (pathname === "/api-assets" && request.method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) });
  });
  return {
    postCount: () => posts,
    submittedPayloads: () => submittedPayloads,
  };
}

test("guest api asset list stays read-only and opens the detail view", async ({ page }) => {
  await setMockAuth(page, "guest");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/api-assets?view=list");

  await expect(page.locator(".page-title")).toContainText("API 资产", { timeout: 20_000 });
  const row = page.locator("table.dt tbody tr").filter({ hasText: "PRODUCT_QUERY" }).first();
  await expect(row).toBeVisible();
  await expect(page.getByRole("button", { name: "新增 API" })).toHaveCount(0);

  await row.getByRole("button").first().click();
  await expect(page).toHaveURL(/\/api-assets\/PRODUCT_QUERY$/);
  await expect(page.getByText("商品详情查询 API").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "编辑" })).toHaveCount(0);
});

test("API asset validation blocks an empty form and focuses the first missing field", async ({ page }) => {
  test.setTimeout(60_000);
  const api = await mockRemoteApiAssetApi(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/api-assets/new");
  await expect(page.getByRole("heading", { name: "新增 API" })).toBeVisible({ timeout: 20_000 });

  const codeInput = page.getByLabel("API 编码");
  await page.getByRole("button", { name: "保存" }).click();

  await expect(codeInput).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("API 名称")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("alert")).toContainText("API 编码");
  await expect(page.getByRole("alert")).toContainText("下游调用系统");
  await expect.poll(() => api.postCount()).toBe(0);
  await expect(codeInput).toBeFocused();
});

test("API asset validation locates overlong text without sending or clearing it", async ({ page }) => {
  const api = await mockRemoteApiAssetApi(page);
  await page.goto("/api-assets/new");
  await page.getByLabel("API 编码").fill("LENGTH_API");
  await page.getByLabel("API 名称").fill("长度测试");
  await page.getByLabel("请求路径").fill("/items");
  await page.getByLabel("归属部门").fill("原部门");
  await page.getByLabel("负责人").fill("原负责人");
  await page.locator(".system-picker select").selectOption("3");
  const description = page.getByLabel("说明", { exact: true });
  const value = "字".repeat(2001);
  await description.fill(value);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(description).toBeFocused();
  await expect(description).toHaveAttribute("aria-invalid", "true");
  await expect(description).toHaveAccessibleDescription("说明不能超过 2000 个字符。");
  await expect(description).toHaveValue(value);
  expect(api.postCount()).toBe(0);
});

test("API asset validation edit saves the selected system and child options on reopening", async ({ page }) => {
  await setMockAuth(page, "admin");
  let item = {
    code: "REBIND_API", name: "关联测试", method: "HEAD", path: "/items", version: "legacy-v",
    systemId: 8, downstreamSystemId: 8, downstreamSystemName: "停用系统", downstreamSystemShortName: "旧",
    type: "legacy-custom", status: "archived", ownerDept: "原部门", ownerName: "原负责人",
    maintainerName: "", description: "", remark: "", relations: [],
    params: [{ name: "id", in: "query", dataType: "custom", required: false, description: "", example: "old" }],
    responseFields: [{ name: "result", dataType: "custom", description: "", example: "old-response" }],
  };
  let saved = false;
  let saveCount = 0;
  let releaseSave!: () => void;
  const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (!path.startsWith("/api/")) return route.continue();
    if (path === "/api/auth/me") return route.fulfill({ json: { data: { role: "admin", user: "tester", permissions: ["api_asset:read", "api_asset:write"] } } });
    if (path === "/api/public-catalog/config") return route.fulfill({ json: { profile: "internal", exportEnabled: false } });
    if (path === "/api/api-assets/systems") return route.fulfill({ json: { items: [
      { id: 8, name: "停用系统", short_name: "旧", status: "disabled" },
      { id: 3, name: "订单中心", short_name: "订单", status: "enabled" },
    ] } });
    if (route.request().method() === "PUT") {
      saveCount += 1;
      item = route.request().postDataJSON();
      saved = true;
      await saveGate;
      return route.fulfill({ json: { data: item } });
    }
    return route.fulfill({ json: { items: path === "/api/api-assets" ? [item] : [] } });
  });
  await page.goto("/api-assets/REBIND_API/edit");
  await expect(page.getByLabel("请求方式")).toHaveText("HEAD");
  await expect(page.getByRole("status").filter({ hasText: "未知历史状态：archived" })).toBeVisible();
  await page.getByRole("combobox", { name: "选择有效的 API 状态" }).click();
  await page.getByRole("option", { name: "启用", exact: true }).click();
  await expect(page.locator(".system-picker select")).toHaveValue("8");
  await page.getByLabel("搜索系统名称或简称").fill("订单");
  await expect(page.locator('.system-picker option[value="8"]')).toHaveCount(1);
  await page.locator(".system-picker select").selectOption("3");
  const params = page.locator("table.mobile-edit-table").first();
  await params.getByRole("checkbox", { name: "第 1 行必填" }).check();
  await params.getByLabel("第 1 行示例").fill("new-param");
  await page.locator("table.mobile-edit-table").nth(1).getByLabel("第 1 行示例").fill("new-response");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => saved).toBe(true);
  await expect(page.getByRole("button", { name: "保存中...", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "取消", exact: true })).toBeDisabled();
  expect(saveCount).toBe(1);
  releaseSave();
  await expect(page.locator(".form-card")).toHaveCount(0);
  expect(item).toMatchObject({ systemId: 3, downstreamSystemId: 3, type: "legacy-custom", method: "HEAD",
    params: [{ required: true, example: "new-param", dataType: "custom" }],
    responseFields: [{ example: "new-response" }],
  });
  await page.goto("/api-assets/REBIND_API/edit");
  await expect(page.locator(".system-picker select")).toHaveValue("3");
  await expect(params.getByRole("checkbox", { name: "第 1 行必填" })).toBeChecked();
  await expect(params.getByLabel("第 1 行示例")).toHaveValue("new-param");
});

test("API asset validation preserves 422 details, row context, and retry values", async ({ page }) => {
  test.setTimeout(60_000);
  const api = await mockRemoteApiAssetApi(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/api-assets/new");
  await expect(page.getByRole("heading", { name: "新增 API" })).toBeVisible({ timeout: 20_000 });

  await page.getByLabel("API 编码").fill("ORDER_QUERY");
  await page.getByLabel("API 名称").fill("订单查询");
  await page.getByLabel("请求路径").fill("/orders");
  await page.getByLabel("归属部门").fill("数据平台");
  await page.getByLabel("负责人").fill("维护人");
  await page.locator(".system-picker select").selectOption("3");

  const paramsTable = page.locator("table.mobile-edit-table").nth(0);
  await page.getByRole("button", { name: "+ 添加" }).nth(0).click();
  await paramsTable.getByRole("textbox", { name: "第 1 行名称" }).fill("orderId");
  const responseTable = page.locator("table.mobile-edit-table").nth(1);
  await page.getByRole("button", { name: "+ 添加" }).nth(1).click();
  await responseTable.getByRole("textbox", { name: "第 1 行名称" }).fill("orderId");

  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.getByLabel("API 名称")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("alert")).toContainText("API 资产校验未通过");
  await expect(page.getByRole("alert")).toContainText("请求参数第 1 行");
  await expect(page.getByText("第 1 行内容未通过服务端校验，请检查名称、位置和类型。")).toBeVisible();
  await expect(page.getByLabel("API 编码")).toHaveValue("ORDER_QUERY");
  await expect(page.getByLabel("API 名称")).toHaveValue("订单查询");
  await expect(page.getByLabel("请求路径")).toHaveValue("/orders");
  await expect(paramsTable.getByRole("textbox", { name: "第 1 行名称" })).toHaveValue("orderId");
  await expect(paramsTable.getByRole("textbox", { name: "第 1 行名称" })).toBeFocused();
  await expect.poll(() => api.postCount()).toBe(1);

  await page.getByLabel("API 名称").fill("订单查询（已修正）");
  await expect(page.getByText("请输入 API 名称。", { exact: true })).toHaveCount(0);
  await expect(page.getByText("第 1 行内容未通过服务端校验，请检查名称、位置和类型。")).toBeVisible();
  await paramsTable.getByRole("textbox", { name: "第 1 行名称" }).fill("order_id");
  await expect(page.getByText("第 1 行内容未通过服务端校验，请检查名称、位置和类型。")).toHaveCount(0);

  await page.getByRole("button", { name: "保存" }).click();
  await expect.poll(() => api.postCount()).toBe(2);
  expect(api.submittedPayloads()).toHaveLength(2);
  expect(api.submittedPayloads()[1]).toMatchObject({
    code: "ORDER_QUERY",
    name: "订单查询（已修正）",
    path: "/orders",
    ownerDept: "数据平台",
    ownerName: "维护人",
    systemId: 3,
    downstreamSystemId: 3,
    params: [{ name: "order_id", in: "query", dataType: "string" }],
    responseFields: [{ name: "orderId", dataType: "string" }],
  });
  await expect(page.locator(".page-title")).toContainText("API 资产");
  await expect(page.locator(".form-card")).toHaveCount(0);
});

test("admin api asset editor uses adapter controls and row editing", async ({ page }) => {
  await setMockAuth(page, "admin");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/api-assets/new");

  await expect(page.getByRole("heading", { name: "新增 API" })).toBeVisible({ timeout: 20_000 });

  const codeInput = page.getByLabel("API 编码");
  await expect(codeInput).toHaveClass(/dap-ui-input/);
  await expect(codeInput).toHaveClass(/inp/);

  await expect(page.getByRole("combobox", { name: "请求方式" })).toHaveText("GET");
  await expect(page.getByLabel("说明")).toHaveClass(/dap-ui-textarea/);
  await expect(page.getByLabel("备注")).toHaveClass(/dap-ui-textarea/);

  await expect(page.getByLabel("搜索系统名称或简称")).toHaveClass(/dap-ui-input/);
  await expect(page.locator(".system-picker select")).toBeVisible();

  const paramsTable = page.locator("table.mobile-edit-table").first();
  const paramRows = paramsTable.locator("tbody tr");
  const initial = await paramRows.count();
  const addButton = page.getByRole("button", { name: "+ 添加" }).first();
  await addButton.click();
  await expect(paramRows).toHaveCount(initial + 1);
  const rowNameInput = paramRows.last().locator("input").first();
  await expect(rowNameInput).toHaveClass(/dap-ui-input/);
  await paramRows.last().getByRole("button", { name: "删除" }).click();
  await expect(paramRows).toHaveCount(initial);

  await codeInput.fill("API_E2E");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.locator(".page-title")).toContainText("API 资产");
});
