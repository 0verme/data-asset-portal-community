import assert from 'node:assert/strict';
import test from 'node:test';
import { getUpstreamSystemPage, getUpstreamSystems } from './upstream.ts';
import { getPushSystemPage, getPushSystems, getPushSystem } from './push.ts';

test('upstream mock page metadata is global and legacy options remain complete', async () => {
  const all = await getUpstreamSystems();
  const first = await getUpstreamSystemPage({ page: 1, pageSize: 2 });
  assert.ok(all.length > 2);
  assert.equal(first.items.length, 2);
  assert.equal(first.total, all.length);
  assert.equal(first.stats.systemCount, all.length);
  assert.equal(Object.values(first.facets.status).reduce((sum, count) => sum + count, 0), all.length);
  const ids = [];
  for (let page = 1; page <= Math.ceil(all.length / 2); page += 1) {
    const result = await getUpstreamSystemPage({ page, pageSize: 2 });
    ids.push(...result.items.map((item) => item.id));
  }
  assert.equal(ids.length, all.length);
  assert.equal(new Set(ids).size, all.length);
  const filtered = await getUpstreamSystemPage({ status: 'disabled', page: 1, pageSize: 1 });
  assert.equal(filtered.total, all.filter((item) => item.status === 'disabled').length);
  assert.deepEqual(filtered.facets, first.facets);
  assert.deepEqual(filtered.options, first.options);
  const empty = await getUpstreamSystemPage({ keyword: 'not-present-464', page: 1, pageSize: 2 });
  assert.equal(empty.total, 0);
  assert.deepEqual(empty.items, []);
  const outOfRange = await getUpstreamSystemPage({ page: 999, pageSize: 2 });
  assert.equal(outOfRange.total, all.length);
  assert.deepEqual(outOfRange.items, []);
  assert.equal((await getUpstreamSystems()).length, all.length);
});

test('upstream mock sorting and page size are applied before taking a page', async () => {
  const all = await getUpstreamSystems();
  const result = await getUpstreamSystemPage({ page: 2, pageSize: 3, sortKey: 'id', sortDirection: 'desc' });
  const expected = all.map((item) => item.id).sort((a, b) => b.localeCompare(a)).slice(3, 6);
  assert.deepEqual(result.items.map((item) => item.id), expected);
  assert.equal(result.pageSize, 3);
  assert.equal(result.page, 2);
});

test('push mock lightweight pages retain accurate global facets, counts and options', async () => {
  const all = await getPushSystems();
  const result = await getPushSystemPage({ page: 1, pageSize: 2 });
  assert.ok(all.length > 2);
  assert.equal(result.total, all.length);
  assert.equal(result.items.length, 2);
  assert.equal(result.stats.systemCount, all.length);
  assert.equal(result.stats.jobCount, all.reduce((sum, item) => sum + item.jobs.length, 0));
  assert.deepEqual(result.options.systemIds, all.map((item) => item.id).sort());
  assert.equal(Object.values(result.facets.importanceLevel).reduce((sum, count) => sum + count, 0), all.length);
  for (const item of result.items) {
    assert.deepEqual(item.jobs, []);
    assert.equal(item.jobCount, all.find((system) => system.id === item.id)?.jobs.length);
  }
  const filtered = await getPushSystemPage({ importanceLevel: 'important', page: 1, pageSize: 1 });
  assert.equal(filtered.total, all.filter((item) => item.importanceLevel === 'important').length);
  assert.ok(filtered.items.every((item) => item.importanceLevel === 'important'));
  assert.deepEqual(filtered.facets, result.facets);
  assert.deepEqual(filtered.options, result.options);
});

test('push job keyword search works before pagination and details do not depend on the page', async () => {
  const all = await getPushSystems();
  const target = all.find((item) => item.jobs.length > 0);
  assert.ok(target);
  const keyword = target.jobs[0]?.id;
  assert.ok(keyword);
  const result = await getPushSystemPage({ keyword, page: 1, pageSize: 1 });
  assert.ok(result.total > 0);
  assert.ok(result.items.some((item) => item.id === target.id));
  const last = all.at(-1);
  assert.ok(last);
  await getPushSystemPage({ page: 999, pageSize: 1 });
  assert.deepEqual(await getPushSystem(last.id), last);
  assert.equal((await getPushSystems()).length, all.length);
  assert.ok((await getPushSystems()).some((item) => item.jobs.some((job) => job.fields.length > 0)));
});

test('push mock sorting, empty results and out-of-range retain total and complete metadata', async () => {
  const all = await getPushSystems();
  const sorted = await getPushSystemPage({ page: 2, pageSize: 2, sortKey: 'id', sortDirection: 'desc' });
  assert.deepEqual(sorted.items.map((item) => item.id), all.map((item) => item.id).sort((a, b) => b.localeCompare(a)).slice(2, 4));
  const empty = await getPushSystemPage({ keyword: 'not-present-464', page: 1, pageSize: 2 });
  assert.equal(empty.total, 0);
  assert.deepEqual(empty.items, []);
  assert.equal(empty.stats.systemCount, all.length);
  const outOfRange = await getPushSystemPage({ page: 999, pageSize: 2 });
  assert.equal(outOfRange.total, all.length);
  assert.deepEqual(outOfRange.items, []);
});
