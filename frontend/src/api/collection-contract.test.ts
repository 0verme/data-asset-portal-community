import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeCollection as mappings } from './fieldMapping.ts';
import { normalizeCollection as indicators } from './indicator.ts';

for (const normalize of [mappings, indicators]) {
  test(`${normalize === mappings ? 'mapping' : 'indicator'} collections reject unknown envelopes and preserve real empty results`, () => {
    for (const value of [null, undefined, {}, { items: null }, { total: 20 }, 'invalid']) {
      assert.throws(() => normalize(value));
    }
    assert.deepEqual(normalize([]), []);
    assert.deepEqual(normalize({ items: [] }), []);
    assert.deepEqual(normalize({ fields: [1] }, 'fields'), [1]);
  });
}
