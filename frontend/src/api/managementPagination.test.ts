import assert from 'node:assert/strict';
import test from 'node:test';

import { getApiAssetPage, getApiAssets, getApiAsset } from './apiAssets.ts';
import { getManualCodeTablePage, getManualCodeTables } from './manualCodeTables.ts';
import { getRootAbbreviations, getRootCategories, getRootPage, getRoots } from './root.ts';

test('API asset page is ordered, filtered before mock slicing, and retains complete legacy list/detail', async () => {
  const all = await getApiAssets();
  assert.ok(all.length > 1);
  const pageSize = 2;
  const first = await getApiAssetPage({ page: 1, pageSize });
  assert.equal(first.total, all.length);
  assert.equal(first.items.length, Math.min(pageSize, all.length));
  const collected = [];
  for (let page = 1; page <= Math.ceil(first.total / pageSize); page += 1) {
    collected.push(...(await getApiAssetPage({ page, pageSize })).items);
  }
  assert.deepEqual(
    collected.map((item) => item.code),
    [...all].sort((left, right) => left.code.localeCompare(right.code)).map((item) => item.code),
  );
  assert.equal(new Set(collected.map((item) => item.code)).size, all.length);
  const target = all[0];
  assert.ok(target);
  const filtered = await getApiAssetPage({ status: target.status, method: target.method, keyword: target.code, page: 1, pageSize: 1 });
  assert.equal(filtered.total, 1);
  assert.equal(filtered.items[0]?.code, target.code);
  assert.equal(filtered.stats.total, all.length);
  assert.equal((await getApiAssets()).length, all.length);
  assert.equal((await getApiAsset(target.code)).code, target.code);
});

test('root management page keeps category counts, all abbreviation candidates and full import candidates independent', async () => {
  const all = await getRoots();
  assert.ok(all.length > 1);
  const first = await getRootPage({ page: 1, pageSize: 2, cat: '业务对象' });
  const expected = all.filter((item) => item.cat === '业务对象').sort((left, right) => left.abbr.localeCompare(right.abbr));
  assert.equal(first.total, expected.length);
  assert.deepEqual(first.items.map((item) => item.abbr), expected.slice(0, 2).map((item) => item.abbr));
  assert.equal(first.stats.total, all.length);
  const categories = await getRootCategories();
  assert.ok(categories.some((category) => category.count > 0));
  const abbreviations = await getRootAbbreviations();
  assert.deepEqual(abbreviations, all.map((item) => item.abbr).sort((left, right) => left.localeCompare(right)));
  const second = await getRootPage({ page: 2, pageSize: 2, cat: '业务对象' });
  assert.deepEqual(second.items.map((item) => item.abbr), expected.slice(2, 4).map((item) => item.abbr));
});

test('manual code-table management page keeps global status/style stats and legacy list complete', async () => {
  const all = await getManualCodeTables();
  assert.ok(all.length > 1);
  const pageSize = 1;
  const first = await getManualCodeTablePage({}, 1, pageSize);
  assert.equal(first.total, all.length);
  assert.equal(first.items.length, 1);
  assert.equal(first.stats.total, all.length);
  assert.equal(first.stats.enabled, all.filter((item) => item.status === 'enabled').length);
  assert.equal(first.stats.disabled, all.filter((item) => item.status === 'disabled').length);
  assert.equal(first.stats.styleCount, new Set(all.map((item) => item.style)).size);
  assert.equal(first.facets.styleTotal, all.length);
  assert.equal(first.facets.statusTotal, all.length);
  assert.equal(first.facets.statuses.enabled, all.filter((item) => item.status === 'enabled').length);
  const target = all[0];
  assert.ok(target);
  const filtered = await getManualCodeTablePage({ style: target.style, status: target.status, keyword: target.tableCode }, 1, 20);
  assert.equal(filtered.total, 1);
  assert.equal(filtered.items[0]?.tableCode, target.tableCode);
  assert.equal(filtered.facets.styleTotal, 1);
  assert.equal(filtered.facets.statusTotal, 1);
  assert.equal(filtered.facets.statuses.enabled, target.status === 'enabled' ? 1 : 0);
  assert.equal(filtered.facets.statuses.disabled, target.status === 'disabled' ? 1 : 0);
  assert.equal((await getManualCodeTables()).length, all.length);
});
