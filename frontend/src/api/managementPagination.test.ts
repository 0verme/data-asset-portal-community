import assert from 'node:assert/strict';
import test from 'node:test';

import { getApiAssetPage, getApiAssets, getApiAsset } from './apiAssets.ts';
import {
  createManualCodeValue,
  deleteManualCodeValue,
  getManualCodeTablePage,
  getManualCodeTables,
  getManualCodeValue,
  getManualCodeValuePage,
  updateManualCodeValue,
  updateManualCodeValueStatus,
} from './manualCodeTables.ts';
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

test('root mock mode stays empty until confirmed database content is available', async () => {
  const all = await getRoots();
  assert.deepEqual(all, []);
  const first = await getRootPage({ page: 1, pageSize: 2, cat: '业务对象' });
  assert.deepEqual(first.items, []);
  assert.equal(first.total, 0);
  assert.equal(first.stats.total, 0);
  const categories = await getRootCategories();
  assert.ok(categories.length > 0);
  assert.ok(categories.every((category) => category.count === 0));
  const abbreviations = await getRootAbbreviations();
  assert.deepEqual(abbreviations, []);
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

test('manual code values page filters, paginates, opens details, and manages only stored values', async () => {
  const tables = await getManualCodeTablePage({}, 1, 1);
  assert.ok(tables.items[0]);
  const tableId = tables.items[0].id;
  const empty = await getManualCodeValuePage(tableId, {}, 1, 5);
  assert.equal(empty.total, 0);
  assert.equal(empty.stats.total, 0);
  assert.deepEqual(empty.items, []);

  const created = await createManualCodeValue(tableId, {
    code: 'PENDING', label: '待处理', description: '等待业务处理', status: 'enabled',
  });
  assert.equal(created.code, 'PENDING');
  assert.equal((await getManualCodeValue(tableId, created.id)).label, '待处理');

  const firstPage = await getManualCodeValuePage(tableId, {}, 1, 1);
  assert.equal(firstPage.total, 1);
  assert.equal(firstPage.stats.total, 1);
  assert.equal(firstPage.items[0]?.id, created.id);
  const filtered = await getManualCodeValuePage(tableId, { keyword: '业务', status: 'enabled' }, 1, 5);
  assert.equal(filtered.total, 1);
  assert.equal(filtered.items[0]?.code, 'PENDING');

  await updateManualCodeValue(tableId, created.id, {
    code: 'PENDING', label: '等待中', description: '等待业务处理', status: 'enabled',
  });
  await updateManualCodeValueStatus(tableId, created.id, 'disabled');
  const disabled = await getManualCodeValuePage(tableId, { status: 'disabled' }, 1, 5);
  assert.equal(disabled.total, 1);
  assert.equal(disabled.items[0]?.label, '等待中');
  await deleteManualCodeValue(tableId, created.id);
  assert.equal((await getManualCodeValuePage(tableId)).stats.total, 0);
});
