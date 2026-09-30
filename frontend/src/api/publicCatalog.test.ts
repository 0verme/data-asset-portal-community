import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_PUBLIC_CATALOG_CONFIG,
  FAIL_CLOSED_PUBLIC_CATALOG_CONFIG,
  parsePublicCatalogConfig,
} from './publicCatalog.ts';

test('public catalog configuration validates profiles and explicit export state', () => {
  assert.deepEqual(DEFAULT_PUBLIC_CATALOG_CONFIG, {
    profile: 'internal',
    exportEnabled: false,
  });
  assert.deepEqual(parsePublicCatalogConfig({ profile: 'strict', exportEnabled: true }), {
    profile: 'strict',
    exportEnabled: true,
  });
  assert.deepEqual(FAIL_CLOSED_PUBLIC_CATALOG_CONFIG, {
    profile: 'disabled',
    exportEnabled: false,
  });
  assert.throws(() => parsePublicCatalogConfig({ profile: 'unknown', exportEnabled: true }));
  assert.throws(() => parsePublicCatalogConfig({ profile: 'internal', exportEnabled: 'true' }));
});
