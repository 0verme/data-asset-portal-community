import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeCollection as assets, normalizeAssetTablePage } from './assets.ts';
import { normalizeCollection as indicators } from './indicator.ts';
import { normalizeCollection as manualCodeTables } from './manualCodeTables.ts';
import { normalizeCollection as paramDicts } from './paramDicts.ts';
import { normalizeCollection as pushes } from './push.ts';
import { normalizeCollection as reports } from './report.ts';
import { normalizeCollection as roots } from './root.ts';
import { normalizeCollection as roles } from './systemRoles.ts';
import { normalizeCollection as upstreams } from './upstream.ts';
import { normalizeCollection as users } from './systemUsers.ts';
import { requestRemote } from './http.ts';
import { normalizeCollection as fieldMappings } from './fieldMapping.ts';

const normalizers: Array<[string, (payload: unknown) => unknown[]]> = [
  ['assets', assets],
  ['field mappings', fieldMappings],
  ['indicators', indicators],
  ['manual code tables', manualCodeTables],
  ['parameter dictionaries', paramDicts],
  ['push systems', pushes],
  ['reports', reports],
  ['roots and categories', roots],
  ['roles and permissions', roles],
  ['upstream systems', upstreams],
  ['users', users],
];

for (const [name, normalize] of normalizers) {
  test(`${name} collection parser accepts documented arrays and items envelopes, including empty results`, () => {
    const item = { id: `${name}-item` };
    assert.deepEqual(normalize([item]), [item]);
    assert.deepEqual(normalize({ items: [item] }), [item]);
    assert.deepEqual(normalize([]), []);
    assert.deepEqual(normalize({ items: [] }), []);
  });

  test(`${name} collection parser rejects malformed and undocumented envelopes`, () => {
    for (const payload of [
      null,
      undefined,
      {},
      { items: null },
      { items: {} },
      { data: [] },
      { systems: [] },
      { categories: [] },
      'invalid',
    ]) {
      assert.throws(() => normalize(payload));
    }
  });
}

test('asset pagination preserves a real zero total and rejects missing or malformed metadata', () => {
  assert.deepEqual(
    normalizeAssetTablePage({ items: [], total: 0, page: 1, pageSize: 20 }, 1, 20),
    { items: [], total: 0, page: 1, pageSize: 20 },
  );
  assert.deepEqual(
    normalizeAssetTablePage({ items: [], total: 0 }, 2, 10),
    { items: [], total: 0, page: 2, pageSize: 10 },
  );

  for (const payload of [
    { items: [] },
    { items: [], total: '0' },
    { items: null, total: 0 },
    { items: [], total: -1 },
    { items: [], total: 0, page: 0 },
    { items: [], total: 0, pageSize: '20' },
    [],
  ]) {
    assert.throws(() => normalizeAssetTablePage(payload, 1, 20));
  }
});

test('HTTP permission and network failures remain errors before collection parsing', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(
      JSON.stringify({ error: { code: 'FORBIDDEN', message: 'permission denied' } }),
      { status: 403, headers: { 'content-type': 'application/json' } },
    );
    await assert.rejects(requestRemote('/reports'), (error: unknown) => {
      const apiError = error as Error & { status?: number; payload?: unknown };
      return apiError.status === 403 && apiError.message === 'permission denied'
        && (apiError.payload as { error?: { code?: string } })?.error?.code === 'FORBIDDEN';
    });

    globalThis.fetch = async () => {
      throw new TypeError('network unavailable');
    };
    await assert.rejects(requestRemote('/reports'), /network unavailable/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
