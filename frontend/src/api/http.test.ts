import assert from "node:assert/strict";
import test from "node:test";

import { requestRemote, requestRemoteEventStream } from "./http.ts";

test("SSE request parses fragmented progress and final result frames without token streaming", async () => {
  const originalFetch = globalThis.fetch;
  const encoder = new TextEncoder();
  globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(init?.method, "POST");
    assert.equal(init?.credentials, "include");
    assert.equal(new Headers(init?.headers).get("accept"), "text/event-stream");
    const progressFrame = `event: progress\r\ndata: ${JSON.stringify({ id: "generating", status: "running", elapsedMs: 42 })}\r\n\r\n`;
    const chunks = [
      progressFrame.slice(0, 24),
      progressFrame.slice(24),
      `event: result\ndata: ${JSON.stringify({ answer: "完整答案" })}\n\n`,
    ];
    return Promise.resolve(new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }), { headers: { "Content-Type": "text/event-stream; charset=utf-8" } }));
  }) as typeof fetch;
  const events: Array<{ event: string; data: string }> = [];

  try {
    await requestRemoteEventStream("/ai/ask/progress", {
      method: "POST", body: { query: "synthetic" },
    }, (event) => events.push(event));
    assert.deepEqual(events.map((event) => event.event), ["progress", "result"]);
    assert.match(events[0]?.data || "", /generating/);
    assert.match(events[1]?.data || "", /完整答案/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("SSE caller abort is propagated rather than reported as a timeout", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
  })) as typeof fetch;
  const controller = new AbortController();
  try {
    const request = requestRemoteEventStream("/ai/ask/progress", { signal: controller.signal }, () => {});
    controller.abort();
    await assert.rejects(request, (error: unknown) => error instanceof DOMException && error.name === "AbortError");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("request timeout redacts AI question payloads from timeout diagnostics", async () => {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const warnings: unknown[][] = [];
  globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    if (!signal) {
      reject(new Error("expected an abort signal"));
      return;
    }
    signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
  })) as typeof fetch;
  console.warn = (...args: unknown[]) => warnings.push(args);

  try {
    await assert.rejects(
      requestRemote("/ai/ask", {
        method: "POST",
        body: { query: "synthetic-private-question-do-not-log" },
        timeout: 5,
        suppressTimeoutPayloadLogging: true,
      }),
      /超时/,
    );
    assert.equal(warnings.length, 1);
    assert.equal(JSON.stringify(warnings).includes("synthetic-private-question-do-not-log"), false);
    assert.equal(JSON.stringify(warnings).includes("[redacted]"), true);
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
  }
});
