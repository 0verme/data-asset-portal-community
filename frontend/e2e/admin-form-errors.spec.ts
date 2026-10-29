import { expect, test, type Locator, type Page } from "@playwright/test";

interface MockFailure {
  status?: number;
  payload?: unknown;
  abort?: boolean;
}

type SaveHandler = (path: string, method: string, payload: unknown, count: number) => Promise<MockFailure | null> | MockFailure | null;

async function mockAdminApi(page: Page, onSave: SaveHandler) {
  const saves: Array<{ path: string; method: string; payload: unknown }> = [];
  await page.route(/^https?:\/\/[^/]+\/api(?:\/|$)/, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, "");
    const method = request.method().toUpperCase();

    if (path === "/auth/me") {
      await route.fulfill({ json: { data: {
        role: "admin",
        user: "admin",
        name: "管理员",
        permissions: ["asset:write", "system:user:read", "system:user:write", "system:menu:read", "system:menu:write", "system:param:read", "system:param:write", "system:role:read", "system:role:write"],
      } } });
      return;
    }
    if (path === "/public-catalog/config") {
      await route.fulfill({ json: { profile: "internal", exportEnabled: false } });
      return;
    }

    if (["POST", "PUT", "PATCH"].includes(method)) {
      const payload = request.postDataJSON();
      saves.push({ path, method, payload });
      const failure = await onSave(path, method, payload, saves.length);
      if (failure?.abort) {
        await route.abort("failed");
        return;
      }
      if (failure) {
        await route.fulfill({
          status: failure.status || 500,
          contentType: "application/json",
          body: JSON.stringify(failure.payload ?? { error: { message: "private server response" } }),
        });
        return;
      }
      await route.fulfill({ status: 201, json: { data: payload } });
      return;
    }

    if (path === "/system/users") {
      await route.fulfill({ json: { items: [] } });
      return;
    }
    if (path === "/system/roles") {
      await route.fulfill({ json: { items: [] } });
      return;
    }
    if (path === "/system/permissions") {
      await route.fulfill({ json: { items: [
        { code: "indicator:read", name: "指标读取" },
        { code: "indicator:write", name: "指标维护" },
      ] } });
      return;
    }
    if (path === "/system/menus") {
      await route.fulfill({ json: { items: [] } });
      return;
    }
    if (path === "/system/param-dicts/categories") {
      await route.fulfill({ json: { categories: [{ code: "SYSTEM_STATUS", name: "系统状态", count: 0 }] } });
      return;
    }
    if (path === "/system/param-dicts") {
      await route.fulfill({ json: { items: [] } });
      return;
    }
    await route.fulfill({ json: { items: [] } });
  });
  return { saves };
}

async function openAdminPage(page: Page, path: string, title: string, viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport);
  await page.goto(path);
  await expect(page.locator(".page-title")).toContainText(title, { timeout: 20_000 });
}

async function expectFieldWithinModalBody(field: Locator, dialog: Locator) {
  const body = dialog.locator(".system-modal-body");
  await expect.poll(async () => field.evaluate((element) => {
    const fieldBounds = element.getBoundingClientRect();
    const bodyBounds = element.closest(".system-modal-body")!.getBoundingClientRect();
    return fieldBounds.top >= bodyBounds.top && fieldBounds.bottom <= bodyBounds.bottom;
  })).toBe(true);
  await expect(body).toBeVisible();
}

for (const viewport of [
  { name: "desktop", width: 1280, height: 800 },
  { name: "390px narrow viewport", width: 390, height: 540 },
]) {
  test(`system form feedback maps local and server errors, focuses fields, and preserves values (${viewport.name})`, async ({ page }) => {
    test.setTimeout(90_000);
    let releaseUserSave!: () => void;
    let paramSaveCount = 0;
    let roleSaveCount = 0;
    const userSaveGate = new Promise<void>((resolve) => { releaseUserSave = resolve; });
    const api = await mockAdminApi(page, async (path, method, _payload, count) => {
      if (path === "/system/users" && method === "POST") {
        if (count === 1) {
          await userSaveGate;
          return {
            status: 422,
            payload: { error: { code: "VALIDATION_ERROR", message: "private validation detail", details: [
              { field: "remark", message: "private field detail" },
              { field: "displayName", message: "another private detail" },
            ] } },
          };
        }
        return { status: 401, payload: { error: { code: "UNAUTHORIZED", message: "private auth detail" } } };
      }
      if (path === "/system/menus" && method === "POST") {
        return { status: 409, payload: { error: { code: "MENU_ALREADY_EXISTS", message: "private conflict detail", details: [{ field: "code", message: "duplicate" }] } } };
      }
      if (path === "/system/param-dicts" && method === "POST") {
        paramSaveCount += 1;
        if (paramSaveCount === 1) {
          return { status: 403, payload: { error: { code: "FORBIDDEN", message: "private permission detail" } } };
        }
        return { status: 422, payload: { error: { code: "VALIDATION_ERROR", message: "private parameter detail", details: [{ field: "value", message: "raw invalid value" }] } } };
      }
      if (path === "/system/roles" && method === "POST") {
        roleSaveCount += 1;
        if (roleSaveCount === 1) {
          return { status: 409, payload: { error: { code: "ROLE_ALREADY_EXISTS", message: "private role conflict", details: [{ field: "roleCode", message: "duplicate" }] } } };
        }
        if (roleSaveCount === 2) {
          return { status: 500, payload: { error: { code: "INTERNAL_ERROR", message: "SQL secret response" } } };
        }
        return { abort: true };
      }
      return null;
    });

    await openAdminPage(page, "/system-management/users", "用户管理", viewport);
    await page.locator(".head-actions").getByRole("button", { name: "新增用户" }).click();
    const userDialog = page.locator(".system-modal-card").filter({ has: page.getByRole("heading", { name: "新增用户" }) });
    const username = userDialog.getByLabel("用户名");
    const displayName = userDialog.getByLabel("显示名");
    const remark = userDialog.getByLabel("备注");
    const userSave = userDialog.getByRole("button", { name: /创建|保存中/ });

    await userSave.click();
    const userSummary = userDialog.locator(".dap-ui-form-error-summary");
    await expect(userSummary).toContainText("用户名不能为空");
    await expect(userSummary).toContainText("显示名不能为空");
    await expect(username).toHaveAttribute("aria-invalid", "true");
    await expect(username).toBeFocused();
    await expect(username).toHaveAccessibleDescription("用户名不能为空");
    await page.keyboard.press("Tab");
    await expect(displayName).toBeFocused();

    await username.fill("field_feedback_user");
    await expect(username).not.toHaveAttribute("aria-invalid", "true");
    await expect(userSummary).toContainText("显示名不能为空");
    await displayName.fill("字段反馈用户");
    await remark.fill("保留的用户备注");
    await expect(userSummary).toHaveCount(0);

    await userSave.click();
    await expect(userSave).toBeDisabled();
    await expect(userSave).toContainText("保存中");
    expect(api.saves.filter((item) => item.path === "/system/users")).toHaveLength(1);
    expect(api.saves[0]?.payload).toMatchObject({
      username: "field_feedback_user",
      displayName: "字段反馈用户",
      role: "admin",
      status: "enabled",
      remark: "保留的用户备注",
    });
    releaseUserSave();
    await expect(userSummary).toContainText("显示名：服务端校验未通过，请检查此字段。");
    await expect(userSummary).toContainText("备注：服务端校验未通过，请检查此字段。");
    await expect(userSummary).not.toContainText("private validation detail");
    await expect(userSummary).not.toContainText("private field detail");
    await expect(displayName).toHaveAttribute("aria-invalid", "true");
    await expect(displayName).toBeFocused();
    await expect(displayName).toHaveAccessibleDescription("服务端校验未通过，请检查此字段。");
    await expect(username).toHaveValue("field_feedback_user");
    await expect(displayName).toHaveValue("字段反馈用户");
    await expect(remark).toHaveValue("保留的用户备注");
    await expectFieldWithinModalBody(displayName, userDialog);

    const remarkSummaryItem = userSummary.getByRole("button").filter({ hasText: "备注" });
    await remarkSummaryItem.focus();
    await expect(remarkSummaryItem).toBeFocused();
    await remarkSummaryItem.press("Enter");
    await expect(remark).toBeFocused();
    await expectFieldWithinModalBody(remark, userDialog);
    await displayName.fill("已修正显示名");
    await expect(userSummary).not.toContainText("显示名：");
    await expect(userSummary).toContainText("备注：");
    await expect(displayName).not.toHaveAttribute("aria-invalid", "true");
    await expect(remark).toHaveAttribute("aria-invalid", "true");
    await remark.fill("已修正备注");
    await expect(userSummary).toHaveCount(0);

    await page.goto("/system-management/menus");
    await expect(page.locator(".page-title")).toContainText("菜单管理", { timeout: 20_000 });
    await page.locator(".head-actions").getByRole("button", { name: "新增菜单" }).click();
    const menuDialog = page.locator(".system-modal-card").filter({ has: page.getByRole("heading", { name: "新增菜单" }) });
    const menuCode = menuDialog.getByLabel("菜单编码");
    const menuName = menuDialog.getByLabel("菜单名称");
    const menuOrder = menuDialog.getByLabel("排序号");
    const menuSave = menuDialog.getByRole("button", { name: "创建", exact: true });
    await menuCode.fill("x");
    await menuOrder.fill("not-a-number");
    await menuSave.click();
    const menuSummary = menuDialog.locator(".dap-ui-form-error-summary");
    await expect(menuSummary).toContainText("菜单编码");
    await expect(menuSummary).toContainText("菜单名称不能为空");
    await expect(menuSummary).toContainText("排序号需为非负整数");
    await expect(menuCode).toBeFocused();
    await menuCode.fill("feedback_menu");
    await expect(menuSummary).not.toContainText("菜单编码");
    await expect(menuSummary).toContainText("菜单名称不能为空");
    await expect(menuOrder).toHaveAttribute("aria-invalid", "true");
    await menuName.fill("字段反馈菜单");
    await menuOrder.fill("10");
    await expect(menuSummary).toHaveCount(0);
    await menuSave.click();
    expect(api.saves.find((item) => item.path === "/system/menus")?.payload).toMatchObject({
      code: "feedback_menu",
      name: "字段反馈菜单",
      order: 10,
    });
    await expect(menuCode).toHaveAttribute("aria-invalid", "true");
    await expect(menuCode).toHaveAccessibleDescription("此字段与现有数据冲突，请修改后重试。");
    await expect(menuSummary).toContainText("菜单编码：此字段与现有数据冲突，请修改后重试。");
    await expect(menuSummary).not.toContainText("private conflict detail");
    await expect(menuCode).toHaveValue("feedback_menu");
    await expect(menuName).toHaveValue("字段反馈菜单");

    await page.goto("/system-management/param-dicts");
    await expect(page.locator(".page-title")).toContainText("参数字典", { timeout: 20_000 });
    await page.locator(".head-actions").getByRole("button", { name: "新增参数" }).click();
    const paramDialog = page.locator(".system-modal-card").filter({ has: page.getByRole("heading", { name: "新增参数" }) });
    const paramCode = paramDialog.getByLabel("参数编码");
    const paramName = paramDialog.getByLabel("参数名称");
    const paramValue = paramDialog.getByLabel("参数值");
    const paramSave = paramDialog.getByRole("button", { name: "创建", exact: true });
    await paramSave.click();
    const paramSummary = paramDialog.locator(".dap-ui-form-error-summary");
    await expect(paramSummary).toContainText("参数编码不能为空");
    await expect(paramSummary).toContainText("参数名称不能为空");
    await expect(paramSummary).toContainText("参数值不能为空");
    await expect(paramCode).toBeFocused();
    await paramCode.fill("VALID_CODE");
    await expect(paramSummary).not.toContainText("参数编码不能为空");
    await expect(paramSummary).toContainText("参数名称不能为空");
    await paramName.fill("有效参数");
    await paramValue.fill("valid_value");
    await expect(paramSummary).toHaveCount(0);
    await paramSave.click();
    expect(api.saves.find((item) => item.path === "/system/param-dicts")?.payload).toMatchObject({
      categoryCode: "SYSTEM_STATUS",
      code: "VALID_CODE",
      name: "有效参数",
      value: "valid_value",
    });
    await expect(paramSummary).toContainText("当前账号没有执行此操作的权限。");
    await expect(paramSummary).not.toContainText("private permission detail");
    await expect(paramCode).toHaveValue("VALID_CODE");
    await expect(paramName).toHaveValue("有效参数");
    await expect(paramValue).toHaveValue("valid_value");
    await paramValue.fill("backend_rejected_value");
    await expect(paramSummary).toContainText("当前账号没有执行此操作的权限。");
    await paramSave.click();
    expect(api.saves.filter((item) => item.path === "/system/param-dicts")[1]?.payload).toMatchObject({
      value: "backend_rejected_value",
    });
    await expect(paramValue).toHaveAttribute("aria-invalid", "true");
    await expect(paramValue).toHaveAccessibleDescription("服务端校验未通过，请检查此字段。");
    await expect(paramSummary).toContainText("参数值：服务端校验未通过，请检查此字段。");
    await expect(paramSummary).not.toContainText("private parameter detail");

    await page.goto("/system-management/roles");
    await expect(page.locator(".page-title")).toContainText("角色管理", { timeout: 20_000 });
    await page.locator(".head-actions").getByRole("button", { name: "新增角色" }).click();
    const roleDialog = page.locator(".system-modal-card").filter({ has: page.getByRole("heading", { name: "新增角色" }) });
    const roleCode = roleDialog.getByLabel("角色编码");
    const roleName = roleDialog.getByLabel("角色名称");
    const roleSave = roleDialog.getByRole("button", { name: "创建", exact: true });
    await roleSave.click();
    const roleSummary = roleDialog.locator(".dap-ui-form-error-summary");
    await expect(roleSummary).toContainText("角色编码不能为空");
    await expect(roleSummary).toContainText("角色名称不能为空");
    await expect(roleCode).toBeFocused();
    await roleCode.fill("network_role");
    await roleName.fill("网络错误角色");
    await roleSave.click();
    expect(api.saves.find((item) => item.path === "/system/roles")?.payload).toMatchObject({
      roleCode: "network_role",
      name: "网络错误角色",
      enabled: "enabled",
      permissionCodes: [],
    });
    await expect(roleCode).toHaveAttribute("aria-invalid", "true");
    await expect(roleCode).toHaveAccessibleDescription("此字段与现有数据冲突，请修改后重试。");
    await expect(roleSummary).toContainText("角色编码：此字段与现有数据冲突，请修改后重试。");
    await expect(roleSummary).not.toContainText("private role conflict");
    await roleCode.fill("network_role_fixed");
    await expect(roleSummary).toHaveCount(0);
    await roleSave.click();
    await expect(roleSummary).toContainText("服务暂时不可用，请稍后重试。");
    await expect(roleSummary).not.toContainText("SQL secret response");
    await expect(roleCode).toHaveValue("network_role_fixed");
    await expect(roleName).toHaveValue("网络错误角色");
    await roleSave.click();
    await expect(roleSummary).toContainText("网络连接失败，请检查网络后重试。");
    await expect(roleCode).toHaveValue("network_role_fixed");
    await expect(roleName).toHaveValue("网络错误角色");

    await page.goto("/system-management/users");
    await expect(page.locator(".page-title")).toContainText("用户管理", { timeout: 20_000 });
    await page.locator(".head-actions").getByRole("button", { name: "新增用户" }).click();
    const retryUserDialog = page.locator(".system-modal-card").filter({ has: page.getByRole("heading", { name: "新增用户" }) });
    const retryUsername = retryUserDialog.getByLabel("用户名");
    const retryDisplayName = retryUserDialog.getByLabel("显示名");
    await retryUsername.fill("unauthorized_user");
    await retryDisplayName.fill("未授权用户");
    await retryUserDialog.getByRole("button", { name: "创建", exact: true }).click();
    await expect(page.getByRole("heading", { name: "登录后访问系统管理" })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("private auth detail");
  });
}
