import assert from 'node:assert/strict';
import test from 'node:test';

import { getHotKeywords } from './hotKeywords.ts';

const originalFetch = globalThis.fetch;

test('hot keywords are read from the API wire envelope without extra fields', async () => {
  let requestUrl = '';
  let requestInit: RequestInit | undefined;
  globalThis.fetch = (async (input, init) => {
    requestUrl = String(input);
    requestInit = init;
    return new Response(JSON.stringify({
      items: [{ id: 7, keyword: 'RISK_BLACKLIST_${yyyyMMdd}.txt', category: 'asset', sortOrder: 10, enabled: 'Y' }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  try {
    assert.deepEqual(await getHotKeywords(), [{
      id: 7,
      keyword: 'RISK_BLACKLIST_${yyyyMMdd}.txt',
      category: 'asset',
      sortOrder: 10,
    }]);
    assert.equal(new URL(requestUrl, 'http://localhost').pathname, '/api/search/hot-keywords');
    assert.equal(requestInit?.credentials, 'include');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('an empty API result remains empty and request errors are surfaced to the caller', async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ items: [] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })) as typeof fetch;
  try {
    assert.deepEqual(await getHotKeywords(), []);
  } finally {
    globalThis.fetch = originalFetch;
  }

  globalThis.fetch = (async () => new Response(JSON.stringify({ error: { message: 'unavailable' } }), {
    status: 503,
    headers: { 'content-type': 'application/json' },
  })) as typeof fetch;
  try {
    await assert.rejects(getHotKeywords(), /unavailable/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
