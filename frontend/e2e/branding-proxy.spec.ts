import { once } from "node:events";
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";

import { expect, test } from "@playwright/test";

const frontendRoot = fileURLToPath(new URL("../", import.meta.url));
const viteConfig = fileURLToPath(new URL("../vite.config.js", import.meta.url));
const logoHash = "a".repeat(64);
const faviconHash = "b".repeat(64);
const logoUrl = `/static/branding/${logoHash}.svg`;
const faviconUrl = `/static/branding/${faviconHash}.svg`;
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#123456"/></svg>';

const brandingConfig = {
  site: {
    title: { "zh-CN": "代理测试站点", "en-US": "Proxy test site" },
    display_name: { "zh-CN": "代理测试门户", "en-US": "Proxy test portal" },
    announcement: { "zh-CN": "", "en-US": "" },
    logo_url: "/brand-icon.svg",
    favicon_url: "/favicon.ico",
  },
  hero: {
    title: { "zh-CN": "代理测试首页", "en-US": "Proxy test home" },
    subtitle: { "zh-CN": "", "en-US": "" },
    search_placeholder: { "zh-CN": "搜索", "en-US": "Search" },
  },
  login: {
    hint: { "zh-CN": "请联系管理员。", "en-US": "Contact an administrator." },
    quick_demo_login_enabled: false,
  },
};

const backendRequests: Array<{ method: string; url: string; contentType?: string }> = [];
let backendConfig = structuredClone(brandingConfig);
let backendVersion = 1;
let backendServer: ReturnType<typeof createHttpServer> | undefined;
let viteServer: Awaited<ReturnType<typeof createViteServer>> | undefined;
let viteBaseUrl = "";
let oldApiMode: string | undefined;
let oldBackendUrl: string | undefined;

function sendJson(response: ServerResponse, data: unknown, status = 200): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(data));
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function publicBranding(language: string) {
  const locale = language === "en-US" ? "en-US" : "zh-CN";
  return {
    data: {
      site: {
        title: backendConfig.site.title[locale],
        display_name: backendConfig.site.display_name[locale],
        announcement: backendConfig.site.announcement[locale],
        logo_url: backendConfig.site.logo_url,
        favicon_url: backendConfig.site.favicon_url,
      },
      hero: {
        title: backendConfig.hero.title[locale],
        subtitle: backendConfig.hero.subtitle[locale],
        search_placeholder: backendConfig.hero.search_placeholder[locale],
      },
      login: {
        hint: backendConfig.login.hint[locale],
        quick_demo_login_enabled: false,
      },
      version: `proxy-v${backendVersion}`,
    },
  };
}

async function handleBackendRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const requestUrl = new URL(request.url || "/", "http://backend.test");
  const method = request.method || "GET";
  backendRequests.push({ method, url: `${requestUrl.pathname}${requestUrl.search}`, contentType: request.headers["content-type"] });

  if (requestUrl.pathname.startsWith("/static/branding/")) {
    if (requestUrl.pathname !== logoUrl && requestUrl.pathname !== faviconUrl) {
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("unknown branding asset");
      return;
    }
    response.writeHead(200, { "content-type": "image/svg+xml", "cache-control": "no-store" });
    response.end(svg);
    return;
  }
  if (requestUrl.pathname === "/api/auth/me") {
    sendJson(response, { data: { user: "proxy-admin", role: "admin", permissions: ["system:param:read", "system:param:write"] } });
    return;
  }
  if (requestUrl.pathname === "/api/public-catalog/config") {
    sendJson(response, { profile: "internal", exportEnabled: false });
    return;
  }
  if (requestUrl.pathname === "/api/system/public-config") {
    sendJson(response, publicBranding(requestUrl.searchParams.get("lang") || "zh-CN"));
    return;
  }
  if (requestUrl.pathname === "/api/system/branding-config" && method === "GET") {
    sendJson(response, { data: { config: backendConfig, version: `proxy-v${backendVersion}` } });
    return;
  }
  if (requestUrl.pathname === "/api/system/branding-config" && method === "PUT") {
    const body = await readRequestBody(request);
    backendConfig = JSON.parse(body) as typeof brandingConfig;
    backendVersion += 1;
    sendJson(response, { data: { config: backendConfig, version: `proxy-v${backendVersion}` } });
    return;
  }
  if (requestUrl.pathname === "/api/system/branding-config/assets/logo" && method === "POST") {
    const body = await readRequestBody(request);
    if (!request.headers["content-type"]?.includes("multipart/form-data") || !body.includes("logo.svg")) {
      sendJson(response, { message: "Expected logo multipart upload" }, 400);
      return;
    }
    sendJson(response, { data: { url: logoUrl } });
    return;
  }
  if (requestUrl.pathname === "/api/system/branding-config/assets/favicon" && method === "POST") {
    const body = await readRequestBody(request);
    if (!request.headers["content-type"]?.includes("multipart/form-data") || !body.includes("favicon.svg")) {
      sendJson(response, { message: "Expected favicon multipart upload" }, 400);
      return;
    }
    sendJson(response, { data: { url: faviconUrl } });
    return;
  }

  if (requestUrl.pathname.startsWith("/api/")) {
    sendJson(response, { items: [] });
    return;
  }
  response.writeHead(404, { "content-type": "text/plain" });
  response.end("not found");
}

test.beforeAll(async () => {
  oldApiMode = process.env["VITE_API_MODE"];
  oldBackendUrl = process.env["VITE_BACKEND_URL"];
  backendConfig = structuredClone(brandingConfig);
  backendVersion = 1;
  backendRequests.length = 0;

  backendServer = createHttpServer((request, response) => {
    void handleBackendRequest(request, response).catch((error: unknown) => {
      if (!response.headersSent) response.writeHead(500, { "content-type": "text/plain" });
      response.end(error instanceof Error ? error.message : "backend test failure");
    });
  });
  backendServer.listen(0, "127.0.0.1");
  await once(backendServer, "listening");
  const backendAddress = backendServer.address();
  if (!backendAddress || typeof backendAddress === "string") throw new Error("Backend test server did not bind a TCP port.");

  process.env["VITE_API_MODE"] = "remote";
  process.env["VITE_BACKEND_URL"] = `http://127.0.0.1:${backendAddress.port}`;
  viteServer = await createViteServer({
    configFile: viteConfig,
    root: frontendRoot,
    mode: "test",
    server: { host: "127.0.0.1", port: 0, strictPort: true },
  });
  await viteServer.listen();
  const viteAddress = viteServer.httpServer.address();
  if (!viteAddress || typeof viteAddress === "string") throw new Error("Vite test server did not bind a TCP port.");
  viteBaseUrl = `http://127.0.0.1:${viteAddress.port}`;
});

test.afterAll(async () => {
  if (viteServer) await viteServer.close();
  if (backendServer?.listening) {
    await new Promise<void>((resolve, reject) => backendServer?.close((error) => error ? reject(error) : resolve()));
  }
  if (oldApiMode === undefined) delete process.env["VITE_API_MODE"];
  else process.env["VITE_API_MODE"] = oldApiMode;
  if (oldBackendUrl === undefined) delete process.env["VITE_BACKEND_URL"];
  else process.env["VITE_BACKEND_URL"] = oldBackendUrl;
});

test("Remote Vite proxies uploaded branding assets and displays the returned Logo and Favicon", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.removeItem("dap_auth");
    localStorage.setItem("dap-language", "en-US");
  });
  await page.goto(`${viteBaseUrl}/system-management/branding`);
  await expect(page.locator(".page-title")).toHaveText("Site branding settings");
  await expect(page.locator("input[type=file]")).toHaveCount(2);

  const inputs = page.locator(".branding-file-input input[type=file]");
  await inputs.nth(0).setInputFiles({ name: "logo.svg", mimeType: "image/svg+xml", buffer: Buffer.from(svg) });
  const logoPreview = page.locator(".branding-asset-preview").nth(0).locator("img");
  await expect(logoPreview).toHaveAttribute("src", logoUrl);
  await expect.poll(() => logoPreview.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);

  await inputs.nth(1).setInputFiles({ name: "favicon.svg", mimeType: "image/svg+xml", buffer: Buffer.from(svg) });
  const faviconPreview = page.locator(".branding-favicon-preview img");
  await expect(faviconPreview).toHaveAttribute("src", faviconUrl);
  await expect.poll(() => faviconPreview.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);

  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Site branding settings were saved" })).toBeVisible();
  await expect(page.locator('link[rel~="icon"]').first()).toHaveAttribute("href", `${faviconUrl}?v=proxy-v2`);

  expect(backendRequests.some(({ method, url }) => method === "POST" && url === "/api/system/branding-config/assets/logo")).toBe(true);
  expect(backendRequests.some(({ method, url }) => method === "POST" && url === "/api/system/branding-config/assets/favicon")).toBe(true);
  expect(backendRequests.some(({ method, url }) => method === "GET" && url === logoUrl)).toBe(true);
  expect(backendRequests.some(({ method, url }) => method === "GET" && url === faviconUrl)).toBe(true);
  expect(backendRequests.some(({ method, url }) => method === "PUT" && url === "/api/system/branding-config")).toBe(true);
});
