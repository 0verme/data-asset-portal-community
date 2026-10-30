import { expect, test, type Page } from "@playwright/test";

interface RootRecord {
  abbr: string;
  en: string;
  cn: string;
  cat: string;
  desc: string;
}

async function installRootApiFixtures(page: Page): Promise<RootRecord[][]> {
  const imports: RootRecord[][] = [];
  let roots: RootRecord[] = [
    { abbr: "base", en: "base", cn: "基础词根", cat: "公共词根", desc: "fixture" },
  ];

  await page.addInitScript(() => {
    localStorage.setItem("dap_auth", JSON.stringify({ role: "admin", user: "issue-475-e2e", name: "测试管理员" }));
  });

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (!pathname.startsWith("/api/")) {
      await route.continue();
      return;
    }

    if (pathname === "/api/auth/me") {
      await route.fulfill({
        json: {
          role: "admin",
          user: "issue-475-e2e",
          name: "测试管理员",
          permissions: ["root:read", "root:write", "system:menu:read"],
        },
      });
      return;
    }
    if (pathname === "/api/public-catalog/config") {
      await route.fulfill({ json: { profile: "internal", exportEnabled: false } });
      return;
    }
    if (pathname === "/api/system/menus") {
      await route.fulfill({ json: { items: [] } });
      return;
    }
    if (pathname === "/api/roots/categories") {
      await route.fulfill({ json: { items: [{ name: "公共词根", count: roots.length }] } });
      return;
    }
    if (pathname === "/api/roots" && request.method() === "GET") {
      await route.fulfill({ json: { items: roots } });
      return;
    }
    if (pathname === "/api/roots/import" && request.method() === "POST") {
      const payload = request.postDataJSON() as { items?: RootRecord[] };
      const items = payload.items ?? [];
      imports.push(items);
      roots = [
        ...roots.filter((root) => !items.some((item) => item.abbr === root.abbr)),
        ...items,
      ];
      await route.fulfill({
        json: { inserted: items.length, updated: 0, items: roots },
      });
      return;
    }

    await route.fulfill({ status: 404, json: { error: { message: `Unexpected API request: ${pathname}` } } });
  });

  return imports;
}

async function openRootImport(page: Page): Promise<void> {
  await page.goto("/root-management");
  await expect(page.locator(".root-page .page-title")).toContainText("词根库", { timeout: 20_000 });
  await page.getByRole("main").getByRole("button", { name: "批量导入" }).click();
  await expect(page.getByLabel("批量导入内容")).toBeVisible();
}

test("root CSV/TSV import previews and submits the same parsed records, excluding invalid rows", async ({ page }) => {
  const imports = await installRootApiFixtures(page);
  await openRootImport(page);

  const csv = '\uFEFFabbr,en,cn,cat,desc\r\nsku,"English, complete","中文\r\n名称","公共词根","Line one\r\nLine two with ""quoted"" text"\r\ninvalid,invalid,,公共词根,should not be submitted\r\n';
  await page.getByLabel("批量导入内容").fill(csv);

  const rows = page.locator(".fields tbody tr");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("sku");
  await expect(rows.nth(0)).toContainText("名称");
  await expect(rows.nth(0)).toContainText('Line two with "quoted" text');
  await expect(rows.nth(0).locator("td").first()).toHaveText("2");
  await expect(rows.nth(1)).toContainText("invalid");
  await expect(rows.nth(1)).toContainText("缺少中文名");
  await expect(rows.nth(1).locator("td").first()).toHaveText("5");
  await expect(page.getByText("错误 1", { exact: true })).toBeVisible();

  const textareaValue = await page.getByLabel("批量导入内容").inputValue();
  const newline = textareaValue.includes("\r\n") ? "\r\n" : "\n";
  const submittedItem = {
    abbr: "sku",
    en: "English, complete",
    cn: `中文${newline}名称`,
    cat: "公共词根",
    desc: `Line one${newline}Line two with "quoted" text`,
  };
  const requestPromise = page.waitForRequest((request) =>
    request.method() === "POST" && new URL(request.url()).pathname === "/api/roots/import",
  );
  await page.getByRole("button", { name: "确认导入" }).click();
  const request = await requestPromise;
  expect(request.postDataJSON()).toEqual({ items: [submittedItem] });
  expect(imports).toEqual([[submittedItem]]);
  await expect(page.locator(".root-page .page-title")).toContainText("词根库");
});

test("malformed root CSV quotes show the source row and cannot be submitted", async ({ page }) => {
  const imports = await installRootApiFixtures(page);
  await openRootImport(page);

  await page.getByLabel("批量导入内容").fill('abbr,en,cn\r\nGOOD,valid,有效\r\nBROKEN,"unterminated,未完成\r\n');

  await expect(page.getByText("第 3 行格式错误：引号未闭合", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "确认导入" })).toHaveCount(0);
  expect(imports).toEqual([]);
});
