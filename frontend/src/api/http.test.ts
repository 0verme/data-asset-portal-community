import assert from "node:assert/strict";
import test from "node:test";

import { requestRemote } from "./http.ts";

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
