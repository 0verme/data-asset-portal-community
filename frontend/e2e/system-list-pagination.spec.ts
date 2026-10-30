import { expect, test, type Page, type Route } from '@playwright/test';
import type { MockUpstreamSystem } from '../src/data/upstreamSystems.ts';
import type { PushSystemItem } from '../src/data/pushSystems.ts';

type Kind = 'upstream' | 'push';
type CatalogItem = MockUpstreamSystem | PushSystemItem;
const remote = process.env['VITE_API_MODE'] === 'remote';

function upstream(index: number): MockUpstreamSystem {
  return {
    id: `up_${String(index).padStart(2, '0')}`, abbr: `SYS${String(index).padStart(2, '0')}`,
    name: `Remote upstream ${index}`, dbType: index === 21 ? 'TAIL_DB' : 'PostgreSQL',
    host: 'fixture.demo.invalid', db: 'fixture', schema: 'fixture', unloadTimes: ['02:00'],
    status: index % 2 ? 'enabled' : 'disabled', owner: 'Fixture owner',
    dept: index === 21 ? 'Tail department' : 'Fixture department', desc: 'Synthetic pagination fixture',
  };
}

function push(index: number): PushSystemItem {
  return {
    id: `PUSH_${String(index).padStart(2, '0')}`, abbr: `SYS${String(index).padStart(2, '0')}`,
    name: `Remote push ${index}`, protocol: index === 21 ? 'TAIL_PROTOCOL' : 'SFTP',
    host: 'fixture.demo.invalid', port: 22, account: 'fixture', auth: 'password',
    downstreamContact: 'Fixture contact', dataDeveloperContact: 'Fixture developer',
    dept: index === 21 ? 'Tail department' : 'Fixture department', desc: 'Synthetic pagination fixture',
    status: index % 2 ? 'enabled' : 'disabled', importanceLevel: index === 1 ? 'important' : 'normal', latestOutputTime: '',
    jobs: [{
      id: `JOB_${index}`, cn: `Remote job ${index}`, sourcePath: '/fixture', sourceFileName: `source_${index}.csv`,
      targetPath: '/fixture', targetFileName: `target_${index}.csv`, freqType: index === 21 ? 'only-last' : 'T+1', freq: '',
      delimiter: '|', encoding: 'UTF-8', rowCnt: '', enabled: true, desc: 'Synthetic job',
      fields: [{ name: 'fixture_id', cn: 'Fixture ID', src: 'DWM', type: 'string', meaning: 'Synthetic field' }],
    }],
  };
}

function text(item: CatalogItem, key: string): string {
  return String((item as unknown as Record<string, unknown>)[key] || '');
}

interface FixtureOptions {
  failLists?: boolean;
  maxPageSize?: number;
  onList?: (route: Route, url: URL, payload: unknown) => Promise<void>;
}

async function fixture(page: Page, kind: Kind, options: FixtureOptions = {}) {
  let items: CatalogItem[] = Array.from({ length: 21 }, (_, offset) => kind === 'upstream' ? upstream(offset + 1) : push(offset + 1));
  const lists: URL[] = [];
  const details: string[] = [];
  const writes: string[] = [];
  const endpoint = kind === 'upstream' ? '/api/upstreams/systems' : '/api/push/systems';
  await page.addInitScript(() => {
    localStorage.setItem('dap_auth', JSON.stringify({ role: 'admin', user: 'pagination-fixture', name: 'Pagination fixture' }));
    localStorage.setItem('dap-theme', 'light');
  });
  await page.route(/^https?:\/\/[^/]+\/api(?:\/|$)/, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === '/api/auth/me') {
      await route.fulfill({ json: { data: { role: 'admin', user: 'pagination-fixture', name: 'Pagination fixture',
        permissions: ['upstream:read', 'upstream:write', 'push:read', 'push:write', 'system:menu:read'] } } });
      return;
    }
    if (path === '/api/public-catalog/config') {
      await route.fulfill({ json: { profile: 'internal', exportEnabled: false } });
      return;
    }
    if (path === endpoint && request.method() === 'GET') {
      lists.push(url);
      if (options.failLists) {
        await route.fulfill({ status: 500, json: { error: { message: 'Synthetic list unavailable' } } });
        return;
      }
      const query = url.searchParams;
      const facets: Record<string, Record<string, number>> = {};
      const keys = kind === 'upstream' ? ['status', 'dbType', 'dept'] : ['status', 'protocol', 'dept', 'importanceLevel'];
      for (const key of keys) {
        facets[key] = {};
        for (const item of items) {
          const value = text(item, key);
          if (value) facets[key]![value] = (facets[key]![value] || 0) + 1;
        }
      }
      let matches = items.filter((item) => {
        if (keys.some((key) => query.get(key) && text(item, key) !== query.get(key))) return false;
        const keyword = (query.get('keyword') || '').toLowerCase();
        return !keyword || [item.id, item.name, item.abbr, item.dept, item.desc,
          ...('jobs' in item ? item.jobs.flatMap((job) => [job.id, job.cn, job.sourceFileName, job.targetFileName]) : []),
        ].some((value) => String(value || '').toLowerCase().includes(keyword));
      });
      const key = query.get('sortKey') || (kind === 'upstream' ? 'abbr' : 'importanceLevel');
      const direction = query.get('sortDirection') === 'desc' ? -1 : 1;
      matches = matches.sort((left, right) => {
        const primary = key === 'importanceLevel'
          ? Number(text(left, key) !== 'important') - Number(text(right, key) !== 'important')
          : text(left, key).localeCompare(text(right, key));
        return primary * direction || left.id.localeCompare(right.id);
      });
      if (!query.has('page') && !query.has('pageSize')) {
        await route.fulfill({ json: { items: matches } });
        return;
      }
      const requestedPage = Number(query.get('page') || 1);
      const pageSize = Math.min(options.maxPageSize ?? 100, Number(query.get('pageSize') || 20));
      const payload = {
        items: matches.slice((requestedPage - 1) * pageSize, requestedPage * pageSize).map((item) =>
          'jobs' in item ? { ...item, jobs: [], jobCount: item.jobs.length } : item),
        total: matches.length, page: requestedPage, pageSize, facets,
        options: kind === 'upstream'
          ? { dbTypes: Object.keys(facets['dbType']!), depts: Object.keys(facets['dept']!) }
          : { systemIds: items.map((item) => item.id), protocols: Object.keys(facets['protocol']!), depts: Object.keys(facets['dept']!),
            freqTypes: ['T+1', 'only-last'] },
        stats: { systemCount: items.length, jobCount: kind === 'push' ? items.length : 0 },
      };
      if (options.onList) await options.onList(route, url, payload);
      else await route.fulfill({ json: payload });
      return;
    }
    if (path === endpoint && request.method() === 'POST') {
      writes.push('POST');
      await route.fulfill({ status: 201, json: { data: request.postDataJSON() } });
      return;
    }
    if (path.startsWith(`${endpoint}/`)) {
      const id = decodeURIComponent(path.slice(endpoint.length + 1).split('/')[0]!);
      if (request.method() === 'DELETE') {
        writes.push(`DELETE ${id}`);
        items = items.filter((item) => item.id !== id);
        await route.fulfill({ json: { message: 'Deleted synthetic item' } });
        return;
      }
      if (request.method() === 'PUT') {
        writes.push(`PUT ${id}`);
        const payload = request.postDataJSON() as CatalogItem;
        items = items.map((item) => item.id === id ? { ...item, ...payload } : item);
        await route.fulfill({ json: { data: items.find((item) => item.id === id) } });
        return;
      }
      details.push(path);
      const item = items.find((item) => item.id === id);
      await route.fulfill({ status: item ? 200 : 404, json: item ? { data: item } : { error: { message: 'Fixture not found' } } });
      return;
    }
    await route.fulfill({ json: { items: [] } });
  });
  return { lists, details, writes };
}

async function choose(page: Page, label: string, option: string) {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

async function openList(page: Page, kind: Kind) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/${kind}?view=list`);
  await expect(page.locator('table.dt tbody tr')).toHaveCount(20, { timeout: 20_000 });
}

for (const kind of ['upstream', 'push'] as const) {
  const title = kind === 'upstream' ? '上游系统分页' : '下游系统分页';
  const sortLabel = kind === 'upstream' ? '上游系统排序' : '下游系统排序';
  const lastId = kind === 'upstream' ? 'up_21' : 'PUSH_21';
  const lastName = `Remote ${kind} 21`;
  const tail = kind === 'upstream' ? 'TAIL_DB' : 'TAIL_PROTOCOL';

  test(`system list pagination ${kind}: first, last, pageSize, sort/filter reset, empty and global facets`, async ({ page }) => {
    test.skip(!remote, 'Explicit remote HTTP fixture contract');
    const api = await fixture(page, kind);
    await openList(page, kind);
    const pager = page.getByLabel(title, { exact: true });
    await expect(pager).toContainText('1 / 2');
    await expect(page.locator('.side-item').filter({ hasText: tail }).locator('.count')).toHaveText('1');
    if (kind === 'push') await expect(page.locator('td[data-label="作业数"] .t-num').first()).toHaveText('1');
    await pager.getByRole('button', { name: '下一页' }).click();
    await expect(page.locator('table.dt tbody tr')).toHaveCount(1);
    await expect(page.locator('table.dt tbody')).toContainText(lastName);
    await expect(pager.getByRole('button', { name: '下一页' })).toBeDisabled();
    await choose(page, '每页条数', '10');
    await expect(page.locator('table.dt tbody tr')).toHaveCount(10);
    await expect(pager).toContainText('1 / 3');
    await pager.getByRole('button', { name: '下一页' }).click();
    await expect(pager).toContainText('2 / 3');
    await choose(page, sortLabel, '标识降序');
    await expect(pager).toContainText('1 / 3');
    await expect(page.locator('table.dt tbody tr').first()).toContainText(lastName);
    await page.locator('.side-item').filter({ hasText: tail }).click();
    await expect(page.locator('table.dt tbody tr')).toHaveCount(1);
    await expect(pager).toContainText('1 / 1');
    await expect(page.locator('.side-item').filter({ hasText: kind === 'upstream' ? '全部类型' : '全部协议' }).locator('.count')).toHaveText('21');
    await page.locator('.search-input').fill('missing-pagination-fixture');
    await expect(page.locator('table.dt tbody tr')).toHaveCount(0);
    await expect(pager).toContainText('共 0 条');
    await expect(page.locator('.side-item').filter({ hasText: tail }).locator('.count')).toHaveText('1');
    expect(api.lists.length).toBeGreaterThan(3);
    expect(api.lists.every((url) => url.searchParams.has('page') && url.searchParams.has('pageSize'))).toBe(true);
    expect(api.lists.at(-1)?.searchParams.get('page')).toBe('1');
  });

  test(`system list pagination ${kind}: server pageSize normalization keeps every page reachable`, async ({ page }) => {
    test.skip(!remote, 'Explicit remote HTTP fixture contract');
    for (const size of [10, 7]) {
      await fixture(page, kind, { maxPageSize: size });
      await page.goto(`/${kind}?view=list`);
      await expect(page.locator('table.dt tbody tr')).toHaveCount(size, { timeout: 20_000 });
      const pager = page.getByLabel(title, { exact: true });
      await expect(page.getByRole('combobox', { name: '每页条数', exact: true })).toContainText(String(size));
      await expect(pager).toContainText('1 / 3');
      await pager.getByRole('button', { name: '下一页' }).click();
      await expect(pager).toContainText('2 / 3');
      await pager.getByRole('button', { name: '下一页' }).click();
      await expect(page.locator('table.dt tbody tr')).toHaveCount(21 - 2 * size);
      await expect(page.locator('table.dt tbody')).toContainText(lastName);
    }
  });

  test(`system list pagination ${kind}: late page response cannot overwrite a newer page`, async ({ page }) => {
    test.skip(!remote, 'Explicit remote HTTP fixture contract');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let held = false;
    await fixture(page, kind, { onList: async (route, url, payload) => {
      if (url.searchParams.get('page') === '2' && url.searchParams.get('pageSize') === '10') {
        held = true;
        await gate;
      }
      if (!page.isClosed()) await route.fulfill({ json: payload });
    } });
    try {
      await openList(page, kind);
      await choose(page, '每页条数', '10');
      await expect(page.locator('table.dt tbody tr')).toHaveCount(10);
      const pager = page.getByLabel(title, { exact: true });
      await pager.getByRole('button', { name: '下一页' }).click();
      await expect.poll(() => held).toBe(true);
      await pager.getByRole('button', { name: '下一页' }).click();
      await expect(page.locator('table.dt tbody tr')).toHaveCount(1);
      await expect(page.locator('table.dt tbody')).toContainText(lastName);
      const lateResponse = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return url.pathname.endsWith('/systems') && url.searchParams.get('page') === '2' && url.searchParams.get('pageSize') === '10';
      });
      release();
      await lateResponse;
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await expect(pager).toContainText('3 / 3');
      await expect(page.locator('table.dt tbody tr')).toHaveCount(1);
      await expect(page.locator('table.dt tbody')).toContainText(lastName);
    } finally {
      release();
    }
  });

  test(`system list pagination ${kind}: cross-page detail/edit/save/reload is independent of list membership`, async ({ page }) => {
    test.skip(!remote, 'Explicit remote HTTP fixture contract');
    const api = await fixture(page, kind);
    await page.goto(`/${kind}/${lastId}/edit`);
    const name = page.getByLabel('系统名称', { exact: true });
    await expect(name).toHaveValue(lastName, { timeout: 20_000 });
    await name.fill(`Edited ${lastName}`);
    await page.getByRole('button', { name: '保存', exact: true }).click();
    const detailTitle = page.locator(kind === 'upstream' ? '.upstream-detail-title' : '.push-title');
    await expect(detailTitle).toHaveText(`Edited ${lastName}`);
    await page.reload();
    await expect(detailTitle).toHaveText(`Edited ${lastName}`);
    expect(api.writes).toContain(`PUT ${lastId}`);
    expect(api.details.some((path) => path.includes(lastId))).toBe(true);
    expect(api.lists.every((url) => url.searchParams.has('page'))).toBe(true);
  });

  test(`system list pagination ${kind}: direct detail remains accessible when the unrelated list fails`, async ({ page }) => {
    test.skip(!remote, 'Explicit remote HTTP fixture contract');
    await fixture(page, kind, { failLists: true });
    await page.goto(`/${kind}/${lastId}`);
    await expect(page.locator(kind === 'upstream' ? '.upstream-detail-title' : '.push-title')).toHaveText(lastName, { timeout: 20_000 });
    await expect(page.getByText('Synthetic list unavailable', { exact: true })).toHaveCount(0);
  });

  test(`system list pagination ${kind}: deleting the last item on a page falls back without resetting filters`, async ({ page }) => {
    test.skip(!remote, 'Explicit remote HTTP fixture contract');
    const api = await fixture(page, kind);
    await openList(page, kind);
    await page.locator('.search-input').fill('Remote');
    await expect.poll(() => api.lists.at(-1)?.searchParams.get('keyword')).toBe('Remote');
    await choose(page, '每页条数', '10');
    const pager = page.getByLabel(title, { exact: true });
    await pager.getByRole('button', { name: '下一页' }).click();
    await expect(pager).toContainText('2 / 3');
    await pager.getByRole('button', { name: '下一页' }).click();
    await expect(page.locator('table.dt tbody tr')).toHaveCount(1);
    await page.locator('table.dt tbody tr').click();
    await page.getByRole('button', { name: kind === 'upstream' ? '编辑' : '编辑系统', exact: true }).click();
    await page.getByRole('button', { name: kind === 'upstream' ? '删除上游系统' : '删除下游系统', exact: true }).click();
    const confirmation = page.getByRole('alertdialog');
    await confirmation.getByRole('textbox').fill(lastId);
    await confirmation.getByRole('button', { name: '确认删除', exact: true }).click();
    await expect(page.getByLabel(title, { exact: true })).toContainText('2 / 2');
    await expect(page.locator('table.dt tbody tr')).toHaveCount(10);
    await expect(page.locator('table.dt tbody')).not.toContainText(lastName);
    expect(api.writes).toContain(`DELETE ${lastId}`);
    expect(api.lists.at(-1)?.searchParams.get('page')).toBe('2');
    expect(api.lists.at(-1)?.searchParams.get('pageSize')).toBe('10');
    expect(api.lists.at(-1)?.searchParams.get('keyword')).toBe('Remote');
    await expect(page.locator('.search-input')).toHaveValue('Remote');
  });
}

test('system list pagination upstream: refreshing global options must not discard unsaved edits', async ({ page }) => {
  test.skip(!remote, 'Explicit remote HTTP fixture contract');
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const api = await fixture(page, 'upstream', { onList: async (route, _url, payload) => {
    await gate;
    if (!page.isClosed()) await route.fulfill({ json: payload });
  } });
  try {
    const refreshed = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/upstreams/systems');
    await page.goto('/upstream/up_21/edit');
    const name = page.getByLabel('系统名称', { exact: true });
    await expect(name).toHaveValue('Remote upstream 21', { timeout: 20_000 });
    await name.fill('Unsaved upstream name');
    release();
    await refreshed;
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(name).toHaveValue('Unsaved upstream name');
    expect(api.writes).toEqual([]);
  } finally {
    release();
  }
});

test('system list pagination upstream: restoring pristine inputs retains validation', async ({ page }) => {
  test.skip(!remote, 'Explicit remote HTTP fixture contract');
  const api = await fixture(page, 'upstream');
  await page.goto('/upstream/new');
  const name = page.getByLabel('系统名称', { exact: true });
  await expect(name).toHaveValue('', { timeout: 20_000 });
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(name).toHaveAttribute('aria-invalid', 'true');
  await name.fill('Temporary name');
  await expect(name).not.toHaveAttribute('aria-invalid', 'true');
  await name.fill('');
  await expect(name).toHaveAttribute('aria-invalid', 'true');
  expect(api.writes).toEqual([]);
});

test('system list pagination push: cross-page job fields and editing keep complete detail', async ({ page }) => {
  test.skip(!remote, 'Explicit remote HTTP fixture contract');
  await fixture(page, 'push');
  await page.goto('/push/PUSH_21/JOB_21');
  await expect(page.locator('.push-title')).toHaveText('Remote job 21', { timeout: 20_000 });
  await expect(page.locator('table.fields')).toContainText('fixture_id');
  await page.getByRole('button', { name: '编辑接口', exact: true }).click();
  await expect(page.getByRole('heading', { name: '编辑推送接口' })).toBeVisible();
  await expect(page.getByLabel('作业名称', { exact: true })).toHaveValue('Remote job 21');
  await expect(page.getByLabel('字段1字段名', { exact: true })).toHaveValue('fixture_id');
  await expect(page.getByRole('combobox', { name: '推送频率', exact: true })).toContainText('only-last');
});
