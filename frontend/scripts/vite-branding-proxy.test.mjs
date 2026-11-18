import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer as createHttpServer } from "node:http";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createServer as createViteServer } from "vite";

const frontendRoot = fileURLToPath(new URL("../", import.meta.url));
const viteConfig = fileURLToPath(new URL("../vite.config.js", import.meta.url));
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#123456"/></svg>';
const logoPath = `/static/branding/${"a".repeat(64)}.svg`;

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}

async function closeHttpServer(server) {
  if (!server?.listening) return;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function withServers(apiMode, run) {
  const requests = [];
  const backend = createHttpServer((request, response) => {
    requests.push({ method: request.method, url: request.url });
    if (request.url === logoPath) {
      response.writeHead(200, { "content-type": "image/svg+xml" });
      response.end(svg);
      return;
    }
    if (request.url === "/api/proxy-check") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ proxied: true }));
      return;
    }
    response.writeHead(404, { "content-type": "text/plain" });
    response.end("not found");
  });

  const originalMode = process.env.VITE_API_MODE;
  const originalBackend = process.env.VITE_BACKEND_URL;
  const backendUrl = await listen(backend);
  let vite;
  try {
    process.env.VITE_API_MODE = apiMode;
    process.env.VITE_BACKEND_URL = backendUrl;
    vite = await createViteServer({
      configFile: viteConfig,
      root: frontendRoot,
      mode: "test",
      logLevel: "silent",
      server: { host: "127.0.0.1", port: 0, strictPort: true },
    });
    await vite.listen();
    const address = vite.httpServer.address();
    assert.ok(address && typeof address !== "string");
    await run({ baseUrl: `http://127.0.0.1:${address.port}`, requests });
  } finally {
    if (vite) await vite.close();
    await closeHttpServer(backend);
    if (originalMode === undefined) delete process.env.VITE_API_MODE;
    else process.env.VITE_API_MODE = originalMode;
    if (originalBackend === undefined) delete process.env.VITE_BACKEND_URL;
    else process.env.VITE_BACKEND_URL = originalBackend;
  }
}

test("Remote Vite proxies branding assets and API to the same backend only", async () => {
  await withServers("remote", async ({ baseUrl, requests }) => {
    const assetResponse = await fetch(`${baseUrl}${logoPath}`);
    assert.equal(assetResponse.status, 200);
    assert.equal(assetResponse.headers.get("content-type"), "image/svg+xml");
    assert.equal(await assetResponse.text(), svg);

    const apiResponse = await fetch(`${baseUrl}/api/proxy-check`);
    assert.equal(apiResponse.status, 200);
    assert.deepEqual(await apiResponse.json(), { proxied: true });

    await fetch(`${baseUrl}/static/private/${"c".repeat(64)}.svg`);
    await fetch(`${baseUrl}/static/branding/${"d".repeat(64)}.ico`);
    assert.deepEqual(requests, [
      { method: "GET", url: logoPath },
      { method: "GET", url: "/api/proxy-check" },
    ]);
  });
});

test("Mock Vite does not forward branding assets or API requests to a backend", async () => {
  await withServers("mock", async ({ baseUrl, requests }) => {
    await fetch(`${baseUrl}${logoPath}`);
    await fetch(`${baseUrl}/api/proxy-check`);
    assert.deepEqual(requests, []);
  });
});
