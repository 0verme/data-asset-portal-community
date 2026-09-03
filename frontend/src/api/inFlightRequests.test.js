import assert from "node:assert/strict";
import test from "node:test";

import {
  createInFlightGetRequestGroup,
  createInFlightRequestGroup,
} from "./inFlightRequests.ts";

test("coalesces matching in-flight requests and clears after completion", async () => {
  const runOnce = createInFlightRequestGroup();
  let calls = 0;
  let release;
  const request = () => {
    calls += 1;
    return new Promise((resolve) => {
      release = resolve;
    });
  };

  const first = runOnce("same-route", request);
  const second = runOnce("same-route", request);
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.strictEqual(first, second);

  release({ ok: true });
  assert.deepEqual(await first, { ok: true });
  assert.deepEqual(await runOnce("same-route", async () => ({ ok: "fresh" })), { ok: "fresh" });
  assert.equal(calls, 1);
});

test("keeps different request keys independent", async () => {
  const runOnce = createInFlightRequestGroup();
  const [left, right] = await Promise.all([
    runOnce("left", async () => "left-result"),
    runOnce("right", async () => "right-result"),
  ]);

  assert.equal(left, "left-result");
  assert.equal(right, "right-result");
});

test("clears rejected requests so retries can run", async () => {
  const runOnce = createInFlightRequestGroup();
  await assert.rejects(runOnce("retryable", async () => {
    throw new Error("temporary");
  }), /temporary/);

  assert.equal(await runOnce("retryable", async () => "recovered"), "recovered");
});

test("coalesces equivalent GET URLs with a stable request policy key", async () => {
  const run = createInFlightGetRequestGroup();
  let calls = 0;
  let release;
  const request = () => {
    calls += 1;
    return new Promise((resolve) => {
      release = resolve;
    });
  };
  const policy = {
    method: "GET",
    credentials: "include",
    timeoutMs: 30_000,
    suppressUnauthorizedEvent: false,
  };

  const first = run({ ...policy, requestUrl: "/api/items?type=A&page=1" }, request);
  const second = run({ ...policy, requestUrl: "/api/items?page=1&type=A" }, request);
  await Promise.resolve();

  assert.equal(calls, 1);
  assert.strictEqual(first, second);
  release("done");
  assert.equal(await first, "done");
});

test("keeps different GET request policies independent", async () => {
  const run = createInFlightGetRequestGroup();
  let calls = 0;
  const request = async () => {
    calls += 1;
    return calls;
  };
  const base = {
    method: "GET",
    requestUrl: "/api/items",
    credentials: "include",
    timeoutMs: 30_000,
    suppressUnauthorizedEvent: false,
  };

  await Promise.all([
    run(base, request),
    run({ ...base, timeoutMs: 60_000 }, request),
    run({ ...base, credentials: "omit" }, request),
    run({ ...base, suppressUnauthorizedEvent: true }, request),
  ]);

  assert.equal(calls, 4);
});

test("preserves caller cancellation ownership by bypassing GET coalescing", async () => {
  const run = createInFlightGetRequestGroup();
  let calls = 0;
  const options = {
    method: "GET",
    requestUrl: "/api/items",
    credentials: "include",
    timeoutMs: 30_000,
    signal: new AbortController().signal,
  };

  await Promise.all([
    run(options, async () => { calls += 1; }),
    run(options, async () => { calls += 1; }),
  ]);

  assert.equal(calls, 2);
});

test("invalidates pending GET entries before a mutation", async () => {
  const run = createInFlightGetRequestGroup();
  let calls = 0;
  const releases = [];
  const getOptions = {
    method: "GET",
    requestUrl: "/api/items",
    credentials: "include",
    timeoutMs: 30_000,
  };
  const request = () => {
    calls += 1;
    return new Promise((resolve) => {
      releases.push(resolve);
    });
  };

  const stale = run(getOptions, request);
  await Promise.resolve();
  await run({ ...getOptions, method: "POST" }, async () => "saved");
  const fresh = run(getOptions, request);
  await Promise.resolve();

  assert.equal(calls, 2);
  assert.notStrictEqual(stale, fresh);
  releases[0]("stale");
  releases[1]("fresh");
  assert.equal(await stale, "stale");
  assert.equal(await fresh, "fresh");
});
