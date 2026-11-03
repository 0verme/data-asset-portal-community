import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getIndicatorList,
  getIndicatorPage,
  normalizeIndicatorPage,
} from './indicator.ts';
import {
  getReportList,
  getReportPage,
  normalizeReportPage,
} from './report.ts';

test('indicator mock page slices after filters/sort and preserves global dimensions and legacy list', async () => {
  const all = await getIndicatorList();
  assert.ok(all.length > 2);

  const first = await getIndicatorPage({ page: 1, pageSize: 2 });
  assert.equal(first.total, all.length);
  assert.equal(first.items.length, 2);
  assert.equal(first.stats.indicatorCount, all.length);
  assert.equal(Object.values(first.facets.dimension).reduce((sum, count) => sum + count, 0), all.length);

  const allPages = [];
  for (let page = 1; page <= Math.ceil(all.length / 2); page += 1) {
    allPages.push(...(await getIndicatorPage({ page, pageSize: 2 })).items);
  }
  assert.deepEqual(allPages.map((item) => item.id), [...all].sort((a, b) => a.id.localeCompare(b.id)).map((item) => item.id));
  assert.equal(new Set(allPages.map((item) => item.id)).size, all.length);

  const dimension = all[0]?.dimension;
  assert.ok(dimension);
  const filtered = await getIndicatorPage({ dimension, status: all[0]?.status, keyword: all[0]?.id, page: 1, pageSize: 1 });
  assert.equal(filtered.total, all.filter((item) => item.dimension === dimension && item.status === all[0]?.status && item.id.includes(all[0]?.id || '')).length);
  const outOfRange = await getIndicatorPage({ page: 999, pageSize: 2 });
  assert.equal(outOfRange.total, all.length);
  assert.deepEqual(outOfRange.items, []);
  assert.equal((await getIndicatorList()).length, all.length);
});

test('report mock page applies filters and stable sorting while retaining global facets and legacy list', async () => {
  const all = await getReportList();
  assert.ok(all.length > 2);

  const first = await getReportPage({ page: 1, pageSize: 2 });
  assert.equal(first.total, all.length);
  assert.equal(first.items.length, 2);
  assert.equal(first.stats.reportCount, all.length);
  assert.equal(Object.values(first.facets.type).reduce((sum, count) => sum + count, 0), all.length);

  const pages = [];
  for (let page = 1; page <= Math.ceil(all.length / 2); page += 1) {
    pages.push(...(await getReportPage({ page, pageSize: 2 })).items);
  }
  assert.deepEqual(pages.map((item) => item.code), [...all].sort((a, b) => a.code.localeCompare(b.code)).map((item) => item.code));
  assert.equal(new Set(pages.map((item) => item.code)).size, all.length);

  const target = all[0];
  assert.ok(target);
  const filtered = await getReportPage({ type: target.type, status: target.status, ownerDept: target.ownerDept, keyword: target.code, page: 1, pageSize: 1 });
  assert.equal(filtered.total, all.filter((item) => item.type === target.type && item.status === target.status && item.ownerDept === target.ownerDept && item.code.includes(target.code)).length);
  const empty = await getReportPage({ keyword: 'catalog-pagination-no-match', page: 1, pageSize: 2 });
  assert.equal(empty.total, 0);
  assert.deepEqual(empty.items, []);
  assert.equal(empty.stats.reportCount, all.length);
  assert.equal((await getReportList()).length, all.length);
});

test('remote page contract parsers reject malformed collection metadata instead of accepting partial data', () => {
  const validIndicator = {
    items: [], total: 0, page: 1, pageSize: 20,
    facets: { dimension: {}, status: {} }, stats: { indicatorCount: 0 },
  };
  const validReport = {
    items: [], total: 0, page: 1, pageSize: 20,
    facets: { type: {}, status: {}, ownerDept: {} }, stats: { reportCount: 0 },
  };
  assert.deepEqual(normalizeIndicatorPage(validIndicator), validIndicator);
  assert.deepEqual(normalizeReportPage(validReport), validReport);
  assert.throws(() => normalizeIndicatorPage({ items: [], total: 0, page: 1, pageSize: 20 }), /格式无效/);
  assert.throws(() => normalizeIndicatorPage({ ...validIndicator, pageSize: 0 }), /格式无效/);
  assert.throws(() => normalizeReportPage({ ...validReport, facets: { ...validReport.facets, type: { bad: -1 } } }), /格式无效/);
  assert.throws(() => normalizeReportPage({ ...validReport, items: null }), /格式无效/);
});
