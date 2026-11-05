import { expect, test, type Page, type Route } from '@playwright/test';

const remote = process.env['VITE_API_MODE'] === 'remote';

type ApiAsset = {
  code: string;
  name: string;
  method: string;
  path: string;
  version: string;
  systemId: number;
  downstreamSystemId: number;
  downstreamSystemName: string;
  downstreamSystemShortName: string;
  type: string;
  status: string;
  ownerDept: string;
  ownerName: string;
  maintainerName: string;
  description: string;
  remark: string;
  params: { name: string; in: string; dataType: string; required: boolean; description: string; example: string }[];
  responseFields: { name: string; dataType: string; description: string; example: string }[];
  relations: { type: string; targetCode: string; targetName: string }[];
  updatedBy: string;
  updatedAt: string;
};

type Root = { abbr: string; en: string; cn: string; cat: string; desc: string; status: string };
type ManualCodeTable = {
  id: string;
  tableCode: string;
  tableName: string;
  style: string;
  owner: string;
  status: string;
  remark: string;
  updatedAt: string;
};

function apiAsset(index: number): ApiAsset {
  const systemId = index % 2 ? 1 : 2;
  return {
    code: `PAGE_API_${String(index).padStart(3, '0')}`,
    name: `Pagination API ${index}`,
    method: index % 2 ? 'GET' : 'POST',
    path: `/fixture/${index}`,
    version: 'v1',
    systemId,
    downstreamSystemId: systemId,
    downstreamSystemName: systemId === 1 ? 'Fixture system A' : 'Fixture system B',
    downstreamSystemShortName: systemId === 1 ? 'A' : 'B',
    type: 'query',
    status: index % 2 ? 'enabled' : 'disabled',
    ownerDept: 'Synthetic fixtures',
    ownerName: 'Pagination test',
    maintainerName: 'Pagination test',
    description: 'Synthetic API pagination acceptance fixture',
    remark: '',
    params: [],
    responseFields: [],
    relations: [],
    updatedBy: 'Pagination test',
    updatedAt: '2026-11-04 00:00:00',
  };
}

function root(index: number): Root {
  return {
    abbr: `root${String(index).padStart(3, '0')}`,
    en: `Fixture root ${index}`,
    cn: `分页词根 ${index}`,
    cat: '业务对象',
    desc: 'Synthetic root pagination fixture',
    status: 'enabled',
  };
}

function codeTable(index: number): ManualCodeTable {
  const styles = ['enum', 'dim', 'status', 'map', 'custom'];
  return {
    id: String(index),
    tableCode: `PAGE_CODE_${String(index).padStart(3, '0')}`,
    tableName: `Pagination code table ${index}`,
    style: styles[(index - 1) % styles.length]!,
    owner: 'Pagination test',
    status: index % 2 ? 'enabled' : 'disabled',
    remark: 'Synthetic code-table pagination fixture',
    updatedAt: `2026-11-${String((index % 27) + 1).padStart(2, '0')} 00:00:00`,
  };
}

function pagePayload<T>(items: readonly T[], url: URL, pageItems: (item: T) => boolean, sortKey: (item: T) => string, direction: 'asc' | 'desc' = 'asc', maxPageSize = Number.MAX_SAFE_INTEGER) {
  const matches = items.filter(pageItems).slice().sort((left, right) =>
    sortKey(left).localeCompare(sortKey(right)) * (direction === 'desc' ? -1 : 1),
  );
  const pageSize = Math.min(Number(url.searchParams.get('pageSize') || 20), maxPageSize);
  const pageCount = Math.max(1, Math.ceil(matches.length / pageSize));
  const page = Math.min(Math.max(1, Number(url.searchParams.get('page') || 1)), pageCount);
  return { items: matches.slice((page - 1) * pageSize, page * pageSize), total: matches.length, page, pageSize };
}

async function installRemoteApiFixtures(page: Page, options: { apiAssetPageSizeLimit?: number; apiAssetTotal?: number } = {}) {
  const apis = Array.from({ length: options.apiAssetTotal ?? 23 }, (_, index) => apiAsset(index + 1));
  const roots = Array.from({ length: 23 }, (_, index) => root(index + 1));
  const codeTables = Array.from({ length: 23 }, (_, index) => codeTable(index + 1));
  const requests: URL[] = [];
  const details: string[] = [];
  const fullRootListCalls: number[] = [];
  const exports: URL[] = [];

  await page.addInitScript(() => {
    localStorage.setItem('dap_auth', JSON.stringify({ role: 'admin', user: 'pagination-test', name: '分页测试管理员' }));
    localStorage.setItem('dap-theme', 'light');
  });
  await page.route(/^https?:\/\/[^/]+\/api(?:\/|$)/, async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === '/api/auth/me') {
      await route.fulfill({ json: { data: {
        role: 'admin', user: 'pagination-test', name: '分页测试管理员',
        permissions: ['api_asset:read', 'api_asset:write', 'root:read', 'root:write', 'code_table:read', 'code_table:write', 'code_table:export', 'system:menu:read'],
      } } });
      return;
    }
    if (path === '/api/public-catalog/config') {
      await route.fulfill({ json: { profile: 'internal', exportEnabled: true } });
      return;
    }
    if (path === '/api/system/menus') {
      await route.fulfill({ json: { items: [] } });
      return;
    }
    if (path === '/api/api-assets/page' && request.method() === 'GET') {
      requests.push(url);
      const result = pagePayload(apis, url, (item) => {
        const status = url.searchParams.get('status');
        const method = url.searchParams.get('method');
        const systemId = url.searchParams.get('downstreamSystemId');
        const keyword = (url.searchParams.get('keyword') || '').trim().toLowerCase();
        return (!status || item.status === status) && (!method || item.method === method) &&
          (!systemId || String(item.downstreamSystemId) === systemId) &&
          (!keyword || `${item.code} ${item.name} ${item.path}`.toLowerCase().includes(keyword));
      }, (item) => item.code, 'asc', options.apiAssetPageSizeLimit);
      const count = (select: (item: ApiAsset) => string) => Object.fromEntries(
        [...new Set(apis.map(select))].map((key) => [key, apis.filter((item) => select(item) === key).length]),
      );
      await route.fulfill({ json: {
        ...result,
        facets: { status: count((item) => item.status), method: count((item) => item.method), downstreamSystemId: count((item) => String(item.downstreamSystemId)) },
        stats: { total: apis.length },
      } });
      return;
    }
    if (path === '/api/api-assets/systems' || path === '/api/api-assets/downstream-systems') {
      await route.fulfill({ json: { items: [
        { id: 1, code: 'FIXTURE_A', name: 'Fixture system A', short_name: 'A', type: 'business', status: 'enabled' },
        { id: 2, code: 'FIXTURE_B', name: 'Fixture system B', short_name: 'B', type: 'business', status: 'enabled' },
      ] } });
      return;
    }
    if (path.startsWith('/api/api-assets/')) {
      const code = decodeURIComponent(path.slice('/api/api-assets/'.length));
      details.push(code);
      const item = apis.find((candidate) => candidate.code === code);
      await route.fulfill({ status: item ? 200 : 404, json: item ? { data: item } : { error: { message: 'Fixture API asset not found' } } });
      return;
    }
    if (path === '/api/roots/_page' && request.method() === 'GET') {
      requests.push(url);
      const category = url.searchParams.get('cat');
      const keyword = (url.searchParams.get('keyword') || '').trim().toLowerCase();
      const result = pagePayload(roots, url, (item) =>
        (!category || item.cat === category) && (!keyword || `${item.abbr} ${item.en} ${item.cn} ${item.desc}`.toLowerCase().includes(keyword)),
      (item) => item.abbr);
      await route.fulfill({ json: { ...result, stats: { total: roots.length } } });
      return;
    }
    if (path === '/api/roots/categories') {
      await route.fulfill({ json: { items: [{ name: '业务对象', count: roots.length }] } });
      return;
    }
    if (path === '/api/roots/_abbreviations') {
      await route.fulfill({ json: { items: roots.map((item) => item.abbr) } });
      return;
    }
    if (path === '/api/roots' && request.method() === 'GET') {
      fullRootListCalls.push(roots.length);
      await route.fulfill({ json: { items: roots } });
      return;
    }
    if (path.startsWith('/api/roots/')) {
      const abbr = decodeURIComponent(path.slice('/api/roots/'.length));
      details.push(abbr);
      const item = roots.find((candidate) => candidate.abbr === abbr);
      await route.fulfill({ status: item ? 200 : 404, json: item ? { data: item } : { error: { message: 'Fixture root not found' } } });
      return;
    }
    if (path === '/api/manual-code-tables/page' && request.method() === 'GET') {
      requests.push(url);
      const style = url.searchParams.get('style');
      const status = url.searchParams.get('status');
      const keyword = (url.searchParams.get('keyword') || '').trim().toLowerCase();
      const result = pagePayload(codeTables, url, (item) =>
        (!style || item.style === style) && (!status || item.status === status) &&
        (!keyword || `${item.tableCode} ${item.tableName} ${item.owner} ${item.remark}`.toLowerCase().includes(keyword)),
      (item) => item.updatedAt, 'desc');
      const queryItems = codeTables.filter((item) => !keyword ||
        `${item.tableCode} ${item.tableName} ${item.owner} ${item.remark}`.toLowerCase().includes(keyword));
      const styleFacetItems = queryItems.filter((item) => !status || item.status === status);
      const statusFacetItems = queryItems.filter((item) => !style || item.style === style);
      const styleValues = [...new Set(codeTables.map((item) => item.style))];
      await route.fulfill({ json: {
        ...result,
        stats: {
          total: codeTables.length,
          enabled: codeTables.filter((item) => item.status === 'enabled').length,
          disabled: codeTables.filter((item) => item.status === 'disabled').length,
          styleCount: new Set(codeTables.map((item) => item.style)).size,
        },
        facets: {
          styleTotal: styleFacetItems.length,
          styles: Object.fromEntries(styleValues.map((key) => [key, styleFacetItems.filter((item) => item.style === key).length])),
          statusTotal: statusFacetItems.length,
          statuses: {
            enabled: statusFacetItems.filter((item) => item.status === 'enabled').length,
            disabled: statusFacetItems.filter((item) => item.status === 'disabled').length,
          },
        },
      } });
      return;
    }
    if (path === '/api/manual-code-tables/export' && request.method() === 'GET') {
      exports.push(url);
      await route.fulfill({ headers: { 'content-type': 'text/csv; charset=utf-8' }, body: 'table_code,table_name\nPAGE_CODE_001,fixture\n' });
      return;
    }
    if (path === '/api/manual-code-tables' && request.method() === 'GET') {
      await route.fulfill({ json: { items: codeTables } });
      return;
    }
    await route.fulfill({ status: 404, json: { error: { message: `Unexpected pagination fixture request: ${path}` } } });
  });
  return { apis, roots, codeTables, requests, details, fullRootListCalls, exports };
}

test.skip(!remote, 'requires VITE_API_MODE=remote and synthetic intercepted API responses');

test('API assets request server pages and load a cross-page detail by code', async ({ page }) => {
  const fixture = await installRemoteApiFixtures(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/api-assets?view=list');
  await expect(page.locator('.page-title')).toContainText('API 资产', { timeout: 20_000 });
  const pager = page.locator('.dap-table-pagination[aria-label="API 资产分页"]');
  await expect(pager.locator('.dap-table-pagination__page-index')).toHaveText('1 / 2');
  await expect(page.locator('table.dt tbody tr')).toHaveCount(20);
  await page.getByRole('button', { name: '下一页' }).click();
  await expect(pager.locator('.dap-table-pagination__page-index')).toHaveText('2 / 2');
  const lastRow = page.locator('table.dt tbody tr').filter({ hasText: 'PAGE_API_023' });
  await expect(lastRow).toBeVisible();
  expect(fixture.requests.some((url) => url.pathname === '/api/api-assets/page' && url.searchParams.get('page') === '2' && url.searchParams.get('pageSize') === '20')).toBe(true);
  await page.goto('/api-assets/PAGE_API_001');
  await expect(page.getByText('Pagination API 1').first()).toBeVisible();
  await expect.poll(() => fixture.details.includes('PAGE_API_001')).toBe(true);
});

test('API asset pagination synchronizes a server-clamped page size and keeps all 100 rows reachable', async ({ page }) => {
  const fixture = await installRemoteApiFixtures(page, { apiAssetPageSizeLimit: 10, apiAssetTotal: 100 });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/api-assets?view=list');
  await expect(page.locator('.page-title')).toContainText('API 资产', { timeout: 20_000 });
  const pager = page.locator('.dap-table-pagination[aria-label="API 资产分页"]');
  const rows = page.locator('table.dt tbody tr');
  const visitedCodes = new Set<string>();
  const apiPageRequests = (): URL[] => fixture.requests.filter((url) => url.pathname === '/api/api-assets/page');

  await expect(pager.locator('.dap-table-pagination__page-index')).toHaveText('1 / 10');
  await expect(pager.locator('.dap-table-pagination__range')).toContainText('第 1–10 条 / 共 100 条');
  expect(apiPageRequests().some((url) => url.searchParams.get('page') === '1' && url.searchParams.get('pageSize') === '20')).toBe(true);
  for (let pageNumber = 1; pageNumber <= 10; pageNumber += 1) {
    await expect(pager.locator('.dap-table-pagination__page-index')).toHaveText(`${pageNumber} / 10`);
    const pageRows = await rows.allTextContents();
    expect(pageRows).toHaveLength(10);
    for (const row of pageRows) {
      const code = row.match(/PAGE_API_\d{3}/)?.[0];
      if (!code) throw new Error(`API asset row has no fixture code: ${row}`);
      visitedCodes.add(code);
    }
    if (pageNumber < 10) await page.getByRole('button', { name: '下一页' }).click();
  }

  expect([...visitedCodes].sort()).toEqual(Array.from({ length: 100 }, (_, index) => `PAGE_API_${String(index + 1).padStart(3, '0')}`));
  expect(apiPageRequests().some((url) => url.searchParams.get('page') === '10' && url.searchParams.get('pageSize') === '10')).toBe(true);
  expect(apiPageRequests().filter((url) => Number(url.searchParams.get('pageSize')) === 10).length).toBeGreaterThanOrEqual(10);
});

test('root library pages table rows while keeping complete abbreviations and import candidates', async ({ page }) => {
  const fixture = await installRemoteApiFixtures(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/root-management');
  await expect(page.locator('.root-page .page-title')).toContainText('词根库', { timeout: 20_000 });
  const pager = page.locator('.dap-table-pagination[aria-label="词根列表分页"]');
  await expect(pager.locator('.dap-table-pagination__page-index')).toHaveText('1 / 2');
  await expect(page.locator('.root-page table.dt tbody tr')).toHaveCount(20);
  const rootSidebar = page.locator('.side-group').filter({ has: page.locator('.side-title', { hasText: '词根分类' }) });
  await expect(rootSidebar.locator('.side-item').first().locator('.count')).toHaveText('23');
  await page.getByRole('button', { name: '下一页' }).click();
  await expect(pager.locator('.dap-table-pagination__page-index')).toHaveText('2 / 2');
  const lastRow = page.locator('.root-page table.dt tbody tr').filter({ hasText: 'root023' });
  await expect(lastRow).toBeVisible();
  await expect.poll(() => fixture.requests.some((url) => url.pathname === '/api/roots/_page' && url.searchParams.get('page') === '2')).toBe(true);
  await lastRow.click();
  await expect(page.getByRole('heading', { name: '编辑词根' })).toBeVisible();
  await expect.poll(() => fixture.details.includes('root023')).toBe(true);
  await page.goto('/root-management');
  await page.getByRole('main').getByRole('button', { name: '批量导入' }).click();
  await expect(page.getByLabel('批量导入内容')).toBeVisible();
  await expect.poll(() => fixture.fullRootListCalls.length).toBeGreaterThan(0);
  expect(fixture.fullRootListCalls.at(-1)).toBe(fixture.roots.length);
  expect(fixture.roots).toHaveLength(23);
});

test('root editor retains unsaved drafts during category-triggered list refreshes', async ({ page }) => {
  await installRemoteApiFixtures(page);
  let delayNextRootPage = false;
  let releaseRefresh!: () => void;
  let observeRefresh!: () => void;
  const refreshStarted = new Promise<void>((resolve) => { observeRefresh = resolve; });
  const refreshGate = new Promise<void>((resolve) => { releaseRefresh = resolve; });
  await page.route(/^https?:\/\/[^/]+\/api(?:\/|$)/, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/roots/_page' && delayNextRootPage) {
      delayNextRootPage = false;
      observeRefresh();
      await refreshGate;
    }
    await route.fallback();
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/root-management');
  await expect(page.locator('.root-page .page-title')).toContainText('词根库', { timeout: 20_000 });
  const row = page.locator('.root-page table.dt tbody tr').filter({ hasText: 'root020' });
  await row.click();
  await expect(page.getByRole('heading', { name: '编辑词根' })).toBeVisible();
  const englishName = page.getByLabel('英文全称');
  await englishName.fill('Unsaved root editor draft');

  delayNextRootPage = true;
  await page.locator('.side-group').filter({ has: page.locator('.side-title', { hasText: '词根分类' }) })
    .getByRole('button', { name: /业务对象/ }).click();
  try {
    await refreshStarted;
    await expect(page.getByRole('heading', { name: '编辑词根' })).toBeVisible();
    await expect(englishName).toHaveValue('Unsaved root editor draft');
  } finally {
    releaseRefresh();
  }
  await expect(englishName).toHaveValue('Unsaved root editor draft');
});

test('management pagination controls remain inside the mobile viewport', async ({ page }) => {
  await installRemoteApiFixtures(page);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [path, label] of [
    ['/api-assets?view=list', 'API 资产分页'],
    ['/root-management', '词根列表分页'],
    ['/code-table-maintenance', '码值表管理分页'],
  ]) {
    await page.goto(path);
    const pager = page.locator(`.dap-table-pagination[aria-label="${label}"]`);
    await expect(pager).toBeVisible();
    const bounds = await pager.evaluate((element) => {
      const nav = element.getBoundingClientRect();
      const range = element.querySelector('.dap-table-pagination__range')!.getBoundingClientRect();
      const controls = element.querySelector('.dap-table-pagination__controls')!.getBoundingClientRect();
      return { navLeft: nav.left, navRight: nav.right, rangeLeft: range.left, rangeRight: range.right,
        controlsLeft: controls.left, controlsRight: controls.right, viewportWidth: window.innerWidth };
    });
    expect(bounds.rangeLeft).toBeGreaterThanOrEqual(bounds.navLeft - 1);
    expect(bounds.controlsLeft).toBeGreaterThanOrEqual(bounds.navLeft - 1);
    expect(bounds.rangeRight).toBeLessThanOrEqual(bounds.navRight + 1);
    expect(bounds.controlsRight).toBeLessThanOrEqual(bounds.navRight + 1);
    expect(bounds.navRight).toBeLessThanOrEqual(bounds.viewportWidth + 1);
  }
});

test('manual code tables page through database results but export all matching rows without page limits', async ({ page }) => {
  const fixture = await installRemoteApiFixtures(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/code-table-maintenance');
  await expect(page.locator('.code-table-page .page-title')).toContainText('码值表维护', { timeout: 20_000 });
  const pager = page.locator('.dap-table-pagination[aria-label="码值表管理分页"]');
  await expect(pager.locator('.dap-table-pagination__page-index')).toHaveText('1 / 2');
  await expect(page.locator('.code-table-page table.dt tbody tr')).toHaveCount(20);
  await expect(page.locator('.code-table-page .stat-card').first()).toContainText('23');
  const sidebar = page.locator('.sidebar');
  await expect(sidebar.getByRole('button', { name: /全部码表/ })).toContainText('23');
  await expect(sidebar.getByRole('button', { name: /全部状态/ })).toContainText('23');
  await expect(sidebar.getByRole('button', { name: /启用/ })).toContainText('12');
  await expect(sidebar.getByRole('button', { name: /禁用/ })).toContainText('11');
  await page.getByRole('button', { name: '下一页' }).click();
  await expect(pager.locator('.dap-table-pagination__page-index')).toHaveText('2 / 2');
  await expect(page.locator('.code-table-page table.dt tbody tr').filter({ hasText: 'PAGE_CODE_001' })).toBeVisible();
  expect(fixture.requests.some((url) => url.pathname === '/api/manual-code-tables/page' && url.searchParams.get('page') === '2' && url.searchParams.get('pageSize') === '20')).toBe(true);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出', exact: true }).click();
  await download;
  expect(fixture.exports).toHaveLength(1);
  expect(fixture.exports[0]?.searchParams.has('page')).toBe(false);
  expect(fixture.exports[0]?.searchParams.has('pageSize')).toBe(false);
});
