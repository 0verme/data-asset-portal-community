import { expect, test, type Locator, type Page } from "@playwright/test";

interface MockFailure {
  status?: number;
  payload?: unknown;
  abort?: boolean;
}

type SaveHandler = (
  path: string,
  method: string,
  payload: unknown,
  count: number,
) => Promise<MockFailure | null> | MockFailure | null;

interface SavedRequest {
  path: string;
  method: string;
  payload: unknown;
}

async function mockManualCodeTableApi(
  page: Page,
  onSave: SaveHandler,
  items: Array<Record<string, unknown>> = [],
) {
  const saves: SavedRequest[] = [];
  await page.route(/^https?:\/\/[^/]+\/api(?:\/|$)/, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, "");
    const method = request.method().toUpperCase();

    if (path === "/auth/me") {
      await route.fulfill({
        json: {
          data: {
            role: "admin",
            user: "admin",
            name: "管理员",
            permissions: ["code_table:read", "code_table:write"],
          },
        },
      });
      return;
    }
    if (path === "/public-catalog/config") {
      await route.fulfill({ json: { profile: "internal", exportEnabled: false } });
      return;
    }

    if (["POST", "PUT", "PATCH"].includes(method) && path.startsWith("/manual-code-tables")) {
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
      await route.fulfill({ status: method === "POST" ? 201 : 200, json: { data: payload } });
      return;
    }

    if (path === "/manual-code-tables" && method === "GET") {
      await route.fulfill({ json: { items } });
      return;
    }
    await route.fulfill({ json: { items: [] } });
  });
  return { saves };
}

async function openCodeTablePage(
  page: Page,
  viewport: { width: number; height: number },
): Promise<void> {
  await page.setViewportSize(viewport);
  await page.addInitScript(() => {
    localStorage.setItem("dap_auth", JSON.stringify({ role: "admin", user: "admin", name: "管理员" }));
  });
  await page.goto("/code-table-maintenance");
  await expect(page.locator(".code-table-page .page-title")).toContainText("码值表维护", {
    timeout: 20_000,
  });
}

async function expectFieldWithinModalBody(field: Locator, dialog: Locator): Promise<void> {
  const body = dialog.locator(".system-modal-body");
  await expect.poll(async () => field.evaluate((element) => {
    const fieldBounds = element.getBoundingClientRect();
    const bodyBounds = element.closest(".system-modal-body")!.getBoundingClientRect();
    return fieldBounds.top >= bodyBounds.top && fieldBounds.bottom <= bodyBounds.bottom;
  })).toBe(true);
  await expect(body).toBeVisible();
}

async function chooseDefaultStyle(page: Page, dialog: Locator): Promise<void> {
  const style = dialog.getByRole("combobox", { name: "表样式" });
  const standardOption = page.getByRole("option", { name: "标准枚举" });
  await style.focus();
  await page.keyboard.press("ArrowDown");
  for (let index = 0; index < 7 && await standardOption.getAttribute("data-highlighted") === null; index += 1) {
    await page.keyboard.press("ArrowDown");
  }
  await expect(standardOption).toHaveAttribute("data-highlighted", "");
  await page.keyboard.press("Enter");
  await expect(style).toContainText("标准枚举");
}

for (const viewport of [
  { name: "desktop", width: 1280, height: 800 },
  { name: "390px narrow viewport", width: 390, height: 540 },
]) {
  test(`manual code table form feedback maps local and server errors and preserves values (${viewport.name})`, async ({ page }) => {
    test.setTimeout(90_000);
    let releaseFirstSave!: () => void;
    const firstSaveGate = new Promise<void>((resolve) => { releaseFirstSave = resolve; });
    let createCount = 0;
    const api = await mockManualCodeTableApi(page, async (path, method) => {
      if (path === "/manual-code-tables" && method === "POST") {
        createCount += 1;
        if (createCount === 1) {
          await firstSaveGate;
          return {
            status: 422,
            payload: {
              error: {
                code: "MANUAL_CODE_TABLE_VALIDATION_FAILED",
                message: "private validation response",
                details: [
                  { field: "tableName", message: "private table name detail" },
                  { field: "remark", message: "private remark detail" },
                ],
              },
            },
          };
        }
      }
      return null;
    });

    await openCodeTablePage(page, viewport);
    await page.locator(".head-actions").getByRole("button", { name: "新增码值表" }).click();
    const dialog = page.locator(".system-modal-card").filter({
      has: page.getByRole("heading", { name: "新增码值表" }),
    });
    const tableCode = dialog.getByLabel("表编码");
    const tableName = dialog.getByLabel("表名称");
    const style = dialog.getByRole("combobox", { name: "表样式" });
    const owner = dialog.getByLabel("负责人");
    const remark = dialog.getByLabel("说明");
    const save = dialog.getByRole("button", { name: /创建|保存中/ });
    const summary = dialog.locator(".dap-ui-form-error-summary");

    await save.click();
    await expect(summary).toContainText("表编码");
    await expect(summary).toContainText("表名称不能为空");
    await expect(summary).toContainText("请选择表样式");
    await expect(tableCode).toHaveAttribute("aria-invalid", "true");
    await expect(tableCode).toBeFocused();
    await expect(tableCode).toHaveAccessibleDescription(/表编码须以大写字母开头/);
    expect(api.saves).toHaveLength(0);

    const styleSummaryItem = summary.getByRole("button").filter({ hasText: "表样式" });
    await styleSummaryItem.focus();
    await styleSummaryItem.press("Enter");
    await expect(style).toBeFocused();
    await expectFieldWithinModalBody(style, dialog);

    await tableCode.fill("DIM_STATUS");
    await tableName.fill("运行状态码表");
    await chooseDefaultStyle(page, dialog);
    await owner.fill("数据治理组");
    await remark.fill("保留的码表说明");
    await expect(summary).toHaveCount(0);

    await save.click();
    await expect(save).toBeDisabled();
    await expect(save).toContainText("保存中");
    await expect.poll(() => api.saves.length).toBe(1);
    expect(api.saves[0]).toMatchObject({
      path: "/manual-code-tables",
      method: "POST",
      payload: {
        tableCode: "DIM_STATUS",
        tableName: "运行状态码表",
        style: "enum",
        owner: "数据治理组",
        status: "enabled",
        remark: "保留的码表说明",
      },
    });
    releaseFirstSave();

    await expect(summary).toContainText("表名称：服务端校验未通过，请检查此字段。");
    await expect(summary).toContainText("说明：服务端校验未通过，请检查此字段。");
    await expect(summary).not.toContainText("private validation response");
    await expect(summary).not.toContainText("private table name detail");
    await expect(summary).not.toContainText("private remark detail");
    await expect(tableName).toHaveAttribute("aria-invalid", "true");
    await expect(tableName).toBeFocused();
    await expect(tableName).toHaveAccessibleDescription("服务端校验未通过，请检查此字段。");
    await expect(tableCode).toHaveValue("DIM_STATUS");
    await expect(tableName).toHaveValue("运行状态码表");
    await expect(owner).toHaveValue("数据治理组");
    await expect(remark).toHaveValue("保留的码表说明");
    await expectFieldWithinModalBody(tableName, dialog);

    const remarkSummaryItem = summary.getByRole("button").filter({ hasText: "说明" });
    await remarkSummaryItem.focus();
    await remarkSummaryItem.press("Enter");
    await expect(remark).toBeFocused();
    await expectFieldWithinModalBody(remark, dialog);
    await tableName.fill("已修正码表名称");
    await expect(summary).not.toContainText("表名称：");
    await expect(summary).toContainText("说明：");
    await expect(tableName).not.toHaveAttribute("aria-invalid", "true");
    await remark.fill("已修正说明");
    await expect(summary).toHaveCount(0);

    await save.click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => api.saves.length).toBe(2);
    expect(api.saves[1]).toMatchObject({
      path: "/manual-code-tables",
      method: "POST",
      payload: {
        tableCode: "DIM_STATUS",
        tableName: "已修正码表名称",
        style: "enum",
        owner: "数据治理组",
        status: "enabled",
        remark: "已修正说明",
      },
    });
  });
}

test("manual code table edit keeps the PUT contract and presents safe form-level failures", async ({ page }) => {
  const existing = {
    id: "42",
    tableCode: "DIM_EXISTING",
    tableName: "已有码表",
    style: "enum",
    owner: "维护组",
    status: "enabled",
    remark: "已有说明",
    updatedAt: "2026-10-29 08:00:00",
  };
  const api = await mockManualCodeTableApi(page, (_path, method, _payload, count) => {
    if (method !== "PUT") return null;
    if (count === 1) {
      return {
        status: 409,
        payload: { error: { code: "MANUAL_CODE_TABLE_ALREADY_EXISTS", message: "private duplicate code" } },
      };
    }
    if (count === 2) {
      return { status: 403, payload: { error: { code: "FORBIDDEN", message: "private permission detail" } } };
    }
    if (count === 3) {
      return { status: 500, payload: { error: { code: "INTERNAL_ERROR", message: "database credential detail" } } };
    }
    if (count === 4) return { abort: true };
    return null;
  }, [existing]);

  await openCodeTablePage(page, { width: 1280, height: 800 });
  const row = page.locator(".code-table-page table.dt tbody tr").filter({ hasText: "DIM_EXISTING" });
  await row.getByRole("button", { name: "编辑" }).click();
  const dialog = page.locator(".system-modal-card").filter({
    has: page.getByRole("heading", { name: "编辑码值表" }),
  });
  const tableCode = dialog.getByLabel("表编码");
  const tableName = dialog.getByLabel("表名称");
  const save = dialog.getByRole("button", { name: /保存修改|保存中/ });
  const summary = dialog.locator(".dap-ui-form-error-summary");

  await expect(tableCode).toHaveValue("DIM_EXISTING");
  await expect(tableName).toHaveValue("已有码表");
  await tableName.fill("修改后的码表");
  await save.click();
  await expect(summary).toContainText("当前数据存在冲突，请检查后重试。");
  await expect(summary).not.toContainText("private duplicate code");
  await expect(tableCode).not.toHaveAttribute("aria-invalid", "true");
  await expect(tableName).toHaveValue("修改后的码表");
  expect(api.saves[0]).toMatchObject({
    path: "/manual-code-tables/42",
    method: "PUT",
    payload: { tableCode: "DIM_EXISTING", tableName: "修改后的码表", style: "enum" },
  });

  await tableName.fill("继续保留的名称");
  await expect(summary).toContainText("当前数据存在冲突，请检查后重试。");
  await save.click();
  await expect(summary).toContainText("当前账号没有执行此操作的权限。");
  await expect(summary).not.toContainText("private permission detail");
  await expect(tableName).toHaveValue("继续保留的名称");

  await save.click();
  await expect(summary).toContainText("服务暂时不可用，请稍后重试。");
  await expect(summary).not.toContainText("database credential detail");
  await expect(tableName).toHaveValue("继续保留的名称");

  await save.click();
  await expect(summary).toContainText("网络连接失败，请检查网络后重试。");
  await expect(tableName).toHaveValue("继续保留的名称");
  expect(api.saves).toHaveLength(4);
  expect(api.saves.every((request) => request.method === "PUT" && request.path === "/manual-code-tables/42")).toBe(true);

  await save.click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => api.saves.length).toBe(5);
  expect(api.saves[4]).toMatchObject({
    path: "/manual-code-tables/42",
    method: "PUT",
    payload: {
      tableCode: "DIM_EXISTING",
      tableName: "继续保留的名称",
      style: "enum",
      owner: "维护组",
      status: "enabled",
      remark: "已有说明",
    },
  });
});
