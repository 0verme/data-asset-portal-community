import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeSystemManagementPage,
  sliceSystemManagementPage,
  systemManagementPageUrl,
} from './systemManagementPagination.ts';

test('system page URL always sends page metadata and safely encodes list search terms', () => {
  const url = systemManagementPageUrl('/system/param-dicts/page', {
    keyword: '分类 A/值', page: 2, pageSize: 10,
  }, { categoryCode: 'SYS_STATUS' });
  const parsed = new URL(url, 'http://fixture.invalid');
  assert.equal(parsed.pathname, '/system/param-dicts/page');
  assert.equal(parsed.searchParams.get('page'), '2');
  assert.equal(parsed.searchParams.get('pageSize'), '10');
  assert.equal(parsed.searchParams.get('keyword'), '分类 A/值');
  assert.equal(parsed.searchParams.get('categoryCode'), 'SYS_STATUS');
  assert.equal(systemManagementPageUrl('/system/users/page', { page: 1, pageSize: 20 }), '/system/users/page?page=1&pageSize=20');
});

test('system page normalizer requires an explicit, internally typed envelope', () => {
  assert.deepEqual(normalizeSystemManagementPage<number>(
    { items: [1, 2], total: 23, page: 2, pageSize: 10 }, '用户列表',
  ), { items: [1, 2], total: 23, page: 2, pageSize: 10 });
  assert.throws(
    () => normalizeSystemManagementPage({ items: [], total: 0 }, '用户列表'),
    /用户列表接口返回格式无效/,
  );
  assert.throws(
    () => normalizeSystemManagementPage({ items: null, total: 0, page: 1, pageSize: 20 }, '菜单列表'),
    /菜单列表接口返回格式无效/,
  );
  assert.throws(
    () => normalizeSystemManagementPage({ items: [], total: -1, page: 0, pageSize: 0 }, '参数字典列表'),
    /参数字典列表接口返回格式无效/,
  );
});

test('mock system pages are slices but keep complete collection totals and stable out-of-range metadata', () => {
  const records = Array.from({ length: 23 }, (_, index) => index + 1);
  assert.deepEqual(sliceSystemManagementPage(records, 2, 10), {
    items: records.slice(10, 20), total: 23, page: 2, pageSize: 10,
  });
  assert.deepEqual(sliceSystemManagementPage(records, 99, 10), {
    items: [], total: 23, page: 99, pageSize: 10,
  });
});
