import { Page } from "@playwright/test";

export type MenuFixture = Record<string, unknown>;

export function makeMenus(): MenuFixture[] {
  const items: MenuFixture[] = [];
  const longName = "超长菜单名称用于校验行高自适应不会导致操作按钮错位";
  const longPath = "/system-management/very-long-navigation-path/with/multiple/segments/and-another-segment/resource/detail";
  for (let i = 1; i <= 23; i++) {
    items.push({
      id: String(i),
      code: `fixture-menu-${String(i).padStart(2, "0")}`,
      name: i === 5 ? longName : `Fixture Menu ${String(i).padStart(2, "0")}`,
      icon: "grid",
      path: i === 5 ? longPath : `/fixture/${i}`,
      order: i * 10,
      status: "enabled",
      adminOnly: false,
      desc: `Synthetic menu ${i}`,
      navPlacement: "more",
      updatedAt: "",
    });
  }
  return items;
}

export async function installMenuFixtures(page: Page): Promise<{ requests: Array<{ path: string; page: string; pageSize: string; keyword: string }>; menus: MenuFixture[] }> {
  const menus = makeMenus();
  const requests: Array<{ path: string; page: string; pageSize: string; keyword: string }> = [];
  await page.addInitScript(() => {
    localStorage.setItem("dap_auth", JSON.stringify({ role: "admin", user: "menu-table-admin", name: "Menu Table Admin" }));
    localStorage.setItem("dap-theme", "light");
  });
  await page.route(/^https?:\/\/[^/]+\/api(?:\/|$)/, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api/, "");
    if (path === "/auth/me") {
      await route.fulfill({ json: { data: {
        role: "admin", user: "menu-table-admin", name: "Menu Table Admin",
        permissions: ['asset:write', 'system:menu:read', 'system:menu:write'],
      } } });
      return;
    }
    if (path === "/public-catalog/config") {
      await route.fulfill({ json: { profile: "internal", exportEnabled: false } });
      return;
    }
    if (path === "/system/permissions") {
      await route.fulfill({ json: { items: [{ code: "system:menu:read", name: "读取菜单", description: "" }] } });
      return;
    }
    if (path === "/system/menus" && request.method() === "GET") {
      await route.fulfill({ json: { items: menus } });
      return;
    }
    if (path === "/system/menus/page" && request.method() === "GET") {
      const requestedPage = Math.max(1, Number(url.searchParams.get("page") || 1));
      const pageSize = Math.max(1, Number(url.searchParams.get("pageSize") || 20));
      const keyword = (url.searchParams.get("keyword") || "").trim().toLowerCase();
      requests.push({ path, page: String(requestedPage), pageSize: String(pageSize), keyword });
      const matches = menus.filter((item) => {
        const values = [item["code"], item["name"], item["path"], item["desc"]];
        return !keyword || values.some((value) => String(value || "").toLowerCase().includes(keyword));
      });
      await route.fulfill({ json: {
        items: matches.slice((requestedPage - 1) * pageSize, requestedPage * pageSize),
        total: matches.length,
        page: requestedPage,
        pageSize,
      } });
      return;
    }
    if (/^\/system\/menus\/[^/]+\/status$/.test(path) && request.method() === "PATCH") {
      const id = path.split("/")[3];
      const body = request.postDataJSON() as { status?: string };
      const item = menus.find((entry) => String(entry["id"]) === id) || {};
      await route.fulfill({ json: { data: { ...item, status: body?.status ?? item["status"] } } });
      return;
    }
    if (/^\/system\/menus\/[^/]+\/move$/.test(path) && request.method() === "PATCH") {
      const id = path.split("/")[3];
      await route.fulfill({ json: { items: menus } });
      return;
    }
    await route.fulfill({ json: { items: [] } });
  });
  return { requests, menus };
}
