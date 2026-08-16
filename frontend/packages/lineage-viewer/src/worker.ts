interface AssetFetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

interface WorkerEnv {
  ASSETS: AssetFetcher;
}

const longTermCacheControl = "public, max-age=31536000, immutable";
const revalidateCacheControl = "public, max-age=0, must-revalidate";
const edgeCacheControlHeader = "Cloudflare-CDN-Cache-Control";

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);

    if (!isCacheableResponse(request, response)) {
      headers.set("Cache-Control", "no-store");
      headers.delete(edgeCacheControlHeader);
    } else {
      const browserCacheControl = new URL(request.url).pathname.startsWith("/assets/")
        ? longTermCacheControl
        : revalidateCacheControl;

      headers.set("Cache-Control", browserCacheControl);
      headers.set(edgeCacheControlHeader, longTermCacheControl);
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};

function isCacheableResponse(request: Request, response: Response): boolean {
  return (request.method === "GET" || request.method === "HEAD") && response.ok;
}
