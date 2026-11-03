import { expect, test, type Page, type Route } from '@playwright/test';

const remote = process.env['VITE_API_MODE'] === 'remote';

type IndicatorFixture = {
  id: string;
  name: string;
  meaning: string;
  resultTableName: string;
  resultFieldName: string;
  sourceAssetId: number | null;
  sourceAssetName: string | null;
  sourceAssetQualifiedName: string | null;
  resultFieldId: number | null;
  aggregation: string;
  semanticState: string;
  dimension: string;
  caliber: string;
  path: string;
  status: string;
  registrar: string;
  registeredAt: string;
};

type ReportFixture = {
  code: string;
  name: string;
  alias: string;
  type: string;
  status: string;
  ownerDept: string;
  ownerName: string;
  maintainerName: string;
  domain: string;
  purpose: string;
  relatedTables: { tableName: string; assetId: number }[];
  relatedIndicators: { indicatorId: string }[];
  updatedBy: string;
  updatedAt: string;
};

interface FixtureOptions {
  failFirstIndicatorList?: boolean;
  reportCount?: number;
  holdIndicatorPage?: number;
  onList?: (route: Route, url: URL, payload: unknown) => Promise<void>;
}

function indicator(index: number): IndicatorFixture {
  const dimension = index > 20 ? 'custom' : 'prd';
  return {
    id: `PAG_IND_${String(index).padStart(2, '0')}`,
    name: index === 23 ? 'Needle indicator fixture' : `Pagination indicator ${String(index).padStart(2, '0')}`,
    meaning: 'Synthetic pagination acceptance fixture',
    resultTableName: 'fixture_table',
    resultFieldName: `fixture_field_${index}`,
    sourceAssetId: null,
    sourceAssetName: null,
    sourceAssetQualifiedName: null,
    resultFieldId: null,
    aggregation: 'SUM',
    semanticState: 'candidate',
    dimension,
    caliber: 'Synthetic acceptance caliber',
    path: `${dimension.toUpperCase()} > Pagination fixture`,
    status: index % 2 ? 'enabled' : 'disabled',
    registrar: 'Pagination fixture',
    registeredAt: '2026-01-01',
  };
}

function report(index: number): ReportFixture {
  return {
    code: `PAG_RPT_${String(index).padStart(2, '0')}`,
    name: `Pagination report ${String(index).padStart(2, '0')}`,
    alias: `Fixture report ${index}`,
    type: index % 2 ? 'daily' : 'monthly',
    status: index % 2 ? 'enabled' : 'disabled',
    ownerDept: index % 2 ? 'Fixture department A' : 'Fixture department B',
    ownerName: 'Pagination fixture owner',
    maintainerName: 'Pagination fixture maintainer',
    domain: 'Synthetic domain',
    purpose: 'Synthetic pagination acceptance fixture',
    relatedTables: [{ tableName: 'fixture_table', assetId: 1 }],
    relatedIndicators: [{ indicatorId: 'PAG_IND_01' }],
    updatedBy: 'Pagination fixture',
    updatedAt: '2026-01-01 00:00:00',
  };
}

function countBy<T>(items: readonly T[], value: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const key = value(item);
    if (key) counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function pageItems<T extends Record<string, unknown>>(
  allItems: readonly T[],
  url: URL,
  filterKeys: readonly string[],
  sortFallback: string,
): { items: T[]; total: number; page: number; pageSize: number } {
  const keyword = (url.searchParams.get('keyword') || '').trim().toLowerCase();
  let matches = allItems.filter((item) => {
    for (const key of filterKeys) {
      const filter = url.searchParams.get(key);
      if (filter && String(item[key] || '') !== filter) return false;
    }
    if (!keyword) return true;
    return Object.values(item).some((value) => String(value || '').toLowerCase().includes(keyword));
  });
  const sortKey = url.searchParams.get('sortKey') || sortFallback;
  const direction = url.searchParams.get('sortDirection') === 'desc' ? -1 : 1;
  matches = matches.sort((left, right) =>
    String(left[sortKey] || '').localeCompare(String(right[sortKey] || '')) * direction ||
    String(left['id'] || left['code'] || '').localeCompare(String(right['id'] || right['code'] || '')),
  );
  const page = Math.max(1, Number(url.searchParams.get('page') || 1));
  const pageSize = Math.max(1, Number(url.searchParams.get('pageSize') || 20));
  return {
    items: matches.slice((page - 1) * pageSize, page * pageSize),
    total: matches.length,
    page,
    pageSize,
  };
}

async function setupRemoteFixture(page: Page, options: FixtureOptions = {}) {
  let indicators = Array.from({ length: 23 }, (_, offset) => indicator(offset + 1));
  let reports = Array.from({ length: options.reportCount ?? 23 }, (_, offset) => report(offset + 1));
  const requests: URL[] = [];
  const deletes: string[] = [];
  let indicatorListCalls = 0;
  let heldPage = false;
  let releaseHeldPage = () => {};
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
        permissions: ['indicator:read', 'indicator:write', 'report:read', 'report:write', 'system:menu:read'] } } });
      return;
    }
    if (path === '/api/public-catalog/config') {
      await route.fulfill({ json: { profile: 'internal', exportEnabled: false } });
      return;
    }
    if (path === '/api/indicators/dimensions') {
      await route.fulfill({ json: { items: [
        { code: 'prd', label: 'Retail dimensions', count: 20 },
        { code: 'custom', label: 'Custom dimension', count: 3 },
      ] } });
      return;
    }
    if (path === '/api/indicators' && request.method() === 'GET') {
      requests.push(url);
      indicatorListCalls += 1;
      if (options.failFirstIndicatorList && indicatorListCalls === 1) {
        await route.fulfill({ status: 503, json: { error: { message: 'Synthetic indicator page unavailable' } } });
        return;
      }
      const result = pageItems(indicators as unknown as Record<string, unknown>[], url, ['dimension', 'status'], 'id');
      const payload = {
        ...result,
        facets: { dimension: countBy(indicators, (item) => item.dimension), status: countBy(indicators, (item) => item.status) },
        stats: { indicatorCount: indicators.length },
      };
      if (options.holdIndicatorPage === result.page && url.searchParams.get('pageSize') === '10' && !url.searchParams.get('keyword')) {
        heldPage = true;
        await new Promise<void>((resolve) => { releaseHeldPage = resolve; });
      }
      if (options.onList) await options.onList(route, url, payload);
      else await route.fulfill({ json: payload });
      return;
    }
    if (path.startsWith('/api/indicators/')) {
      const id = decodeURIComponent(path.slice('/api/indicators/'.length));
      const item = indicators.find((candidate) => candidate.id === id);
      await route.fulfill({ status: item ? 200 : 404, json: item ? { data: item } : { error: { message: 'Fixture not found' } } });
      return;
    }
    if (path === '/api/reports' && request.method() === 'GET') {
      requests.push(url);
      const result = pageItems(reports as unknown as Record<string, unknown>[], url, ['type', 'domain', 'status', 'ownerDept'], 'code');
      await route.fulfill({ json: {
        ...result,
        facets: {
          type: countBy(reports, (item) => item.type),
          status: countBy(reports, (item) => item.status),
          ownerDept: countBy(reports, (item) => item.ownerDept),
        },
        stats: { reportCount: reports.length },
      } });
      return;
    }
    if (path === '/api/reports' && request.method() === 'DELETE') {
      await route.fulfill({ status: 405, json: { error: { message: 'Method not allowed' } } });
      return;
    }
    if (path.startsWith('/api/reports/')) {
      const code = decodeURIComponent(path.slice('/api/reports/'.length));
      const item = reports.find((candidate) => candidate.code === code);
      if (request.method() === 'DELETE') {
        deletes.push(code);
        reports = reports.filter((candidate) => candidate.code !== code);
        await route.fulfill({ json: { message: 'Deleted synthetic fixture' } });
        return;
      }
      await route.fulfill({ status: item ? 200 : 404, json: item ? { data: item } : { error: { message: 'Fixture not found' } } });
      return;
    }
    await route.fulfill({ json: { items: [] } });
  });
  return {
    requests,
    deletes,
    isHeldPage: () => heldPage,
    releaseHeldPage: () => releaseHeldPage(),
    currentReportCount: () => reports.length,
  };
}

async function choose(page: Page, label: string, option: string) {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

for (const module of ['indicator', 'report'] as const) {
  test(`${module} remote paging uses server totals, stable filters and shared page-size controls`, async ({ page }) => {
    test.skip(!remote, 'Exercises the HTTP API mode; fixtures only isolate the remote contract.');
    const fixture = await setupRemoteFixture(page);
    const route = module === 'indicator' ? '/indicator-maintenance?view=list' : '/report-assets?view=list';
    const pagerName = module === 'indicator' ? '指标维护分页' : '报表分页';
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(route);
    await expect(page.locator('table.dt tbody tr')).toHaveCount(20, { timeout: 20_000 });
    const pager = page.getByRole('navigation', { name: pagerName, exact: true });
    await expect(pager).toContainText('1 / 2');
    await expect(pager).toContainText('共 23 条');
    if (module === 'indicator') {
      await expect(page.locator('.side-item').filter({ hasText: 'Custom dimension' }).locator('.count')).toHaveText('3');
    }
    await pager.getByRole('button', { name: '下一页' }).click();
    await expect(page.locator('table.dt tbody tr')).toHaveCount(3);
    await expect(page.locator('table.dt tbody')).toContainText(module === 'indicator' ? 'PAG_IND_23' : 'PAG_RPT_23');
    if (module === 'indicator') {
      await page.locator('.side-item').filter({ hasText: 'Custom dimension' }).click();
      await expect(page.locator('table.dt tbody tr')).toHaveCount(3);
      await expect(pager).toContainText('1 / 1');
      await expect(pager).toContainText('共 3 条');
      await page.locator('.side-item').filter({ hasText: '全部指标' }).click();
      await expect(page.locator('table.dt tbody tr')).toHaveCount(20);
      await expect(pager).toContainText('1 / 2');
    } else {
      await page.locator('.side-item').filter({ hasText: 'daily' }).click();
      await expect(page.locator('table.dt tbody tr')).toHaveCount(12);
      await expect(pager).toContainText('1 / 1');
      await page.locator('.side-item').filter({ hasText: '全部报表类型' }).click();
      await expect(page.locator('table.dt tbody tr')).toHaveCount(20);
      await expect(pager).toContainText('1 / 2');
    }
    await choose(page, '每页条数', '10');
    await expect(page.locator('table.dt tbody tr')).toHaveCount(10);
    await expect(pager).toContainText('1 / 3');
    if (module === 'indicator') {
      await choose(page, '指标排序', '标识降序');
      await expect(page.locator('table.dt tbody tr').first()).toContainText('PAG_IND_23');
      await page.locator('.search-input').fill('Needle indicator fixture');
      await expect(page.locator('table.dt tbody tr')).toHaveCount(1);
      await expect(pager).toContainText('共 1 条');
    } else {
      await choose(page, '报表排序', '编码降序');
      await expect(page.locator('table.dt tbody tr').first()).toContainText('PAG_RPT_23');
      await page.locator('.search-input').fill('no-such-report-fixture');
      await expect(page.locator('table.dt tbody tr')).toHaveCount(0);
      await expect(pager).toContainText('共 0 条');
    }
    expect(fixture.requests.length).toBeGreaterThan(3);
    expect(fixture.requests.every((url) => url.searchParams.has('page') && url.searchParams.has('pageSize'))).toBe(true);
  });
}

test('indicator remote paging retries a failed page request and does not leave a false empty state', async ({ page }) => {
  test.skip(!remote, 'Exercises the HTTP API mode; fixtures only isolate the remote contract.');
  const fixture = await setupRemoteFixture(page, { failFirstIndicatorList: true });
  await page.goto('/indicator-maintenance?view=list');
  await expect(page.getByRole('heading', { name: '指标维护加载失败' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Synthetic indicator page unavailable')).toBeVisible();
  await page.getByRole('button', { name: '重新加载' }).click();
  await expect(page.locator('table.dt tbody tr')).toHaveCount(20, { timeout: 20_000 });
  expect(fixture.requests.length).toBeGreaterThan(0);
});

test('report remote pagination clamps to the new last page after deleting its last row', async ({ page }) => {
  test.skip(!remote, 'Exercises the HTTP API mode; fixtures only isolate the remote contract.');
  const fixture = await setupRemoteFixture(page, { reportCount: 21 });
  await page.goto('/report-assets?view=list');
  await expect(page.locator('table.dt tbody tr')).toHaveCount(20, { timeout: 20_000 });
  const pager = page.getByRole('navigation', { name: '报表分页', exact: true });
  await choose(page, '每页条数', '10');
  await expect(page.locator('table.dt tbody tr')).toHaveCount(10);
  await expect(pager).toContainText('1 / 3');
  await pager.getByRole('button', { name: '下一页' }).click();
  await expect(pager).toContainText('2 / 3');
  await pager.getByRole('button', { name: '下一页' }).click();
  await expect(page.locator('table.dt tbody tr')).toHaveCount(1);
  await page.getByRole('button', { name: 'PAG_RPT_21' }).click();
  const drawer = page.getByRole('dialog', { name: '报表详情' });
  await expect(drawer).toBeVisible();
  await drawer.getByRole('button', { name: '删除' }).click();
  const confirmation = page.getByRole('alertdialog');
  await confirmation.getByRole('textbox').fill('PAG_RPT_21');
  await confirmation.getByRole('button', { name: '确认删除' }).click();
  await expect(pager).toContainText('2 / 2');
  await expect(page.locator('table.dt tbody tr')).toHaveCount(10);
  await expect(page.locator('table.dt tbody')).not.toContainText('PAG_RPT_21');
  expect(fixture.deletes).toEqual(['PAG_RPT_21']);
  expect(fixture.currentReportCount()).toBe(20);
});

test('isolated SQLite-backed remote API pages and deletes real catalog rows', async ({ page }, testInfo) => {
  test.skip(!remote || process.env['DAP_CATALOG_LIVE_API_E2E'] !== '1', 'Requires the issue-owned local SQLite FastAPI fixture.');
  test.skip(testInfo.project.name !== 'chromium', 'This test mutates its isolated SQLite fixture.');
  await page.addInitScript(() => {
    localStorage.setItem('dap_auth', JSON.stringify({ role: 'admin', user: 'dap498_live_api_fixture', name: 'DAP 498 isolated fixture' }));
    localStorage.setItem('dap-theme', 'light');
  });
  await page.route(/^https?:\/\/[^/]+\/api(?:\/|$)/, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/me') {
      await route.fulfill({ json: { data: { role: 'admin', user: 'dap498_live_api_fixture', name: 'DAP 498 isolated fixture',
        permissions: ['indicator:read', 'indicator:write', 'report:read', 'report:write', 'system:menu:read'] } } });
      return;
    }
    if (path === '/api/public-catalog/config') {
      await route.fulfill({ json: { profile: 'internal', exportEnabled: false } });
      return;
    }
    if (path === '/api/indicators' || path.startsWith('/api/indicators/') ||
        path === '/api/reports' || path.startsWith('/api/reports/')) {
      await route.continue();
      return;
    }
    await route.fulfill({ json: { items: [] } });
  });

  await page.goto('/indicator-maintenance?view=list');
  const indicatorPager = page.getByRole('navigation', { name: '指标维护分页', exact: true });
  await expect(page.locator('table.dt tbody tr')).toHaveCount(20, { timeout: 20_000 });
  await expect(indicatorPager).toContainText('1 / 2');
  await expect(indicatorPager).toContainText('共 23 条');
  await indicatorPager.getByRole('button', { name: '下一页' }).click();
  await expect(page.locator('table.dt tbody tr')).toHaveCount(3);
  await expect(page.locator('table.dt tbody')).toContainText('DAP498LIVE_IND_23');

  await page.goto('/report-assets?view=list');
  const reportPager = page.getByRole('navigation', { name: '报表分页', exact: true });
  await expect(page.locator('table.dt tbody tr')).toHaveCount(20, { timeout: 20_000 });
  await expect(reportPager).toContainText('1 / 2');
  await expect(reportPager).toContainText('共 21 条');
  await choose(page, '每页条数', '10');
  await expect(page.locator('table.dt tbody tr')).toHaveCount(10);
  await reportPager.getByRole('button', { name: '下一页' }).click();
  await expect(reportPager).toContainText('2 / 3');
  await reportPager.getByRole('button', { name: '下一页' }).click();
  await expect(page.locator('table.dt tbody tr')).toHaveCount(1);
  await page.getByRole('button', { name: 'DAP498LIVE_RPT_21' }).click();
  const drawer = page.getByRole('dialog', { name: '报表详情' });
  await expect(drawer).toBeVisible();
  await drawer.getByRole('button', { name: '删除' }).click();
  const confirmation = page.getByRole('alertdialog');
  await confirmation.getByRole('textbox').fill('DAP498LIVE_RPT_21');
  await confirmation.getByRole('button', { name: '确认删除' }).click();
  await expect(reportPager).toContainText('2 / 2');
  await expect(page.locator('table.dt tbody tr')).toHaveCount(10);
  await expect(page.locator('table.dt tbody')).not.toContainText('DAP498LIVE_RPT_21');
});

test('indicator late page responses cannot overwrite a newer search result', async ({ page }) => {
  test.skip(!remote, 'Exercises the HTTP API mode; fixtures only isolate the remote contract.');
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let held = false;
  const fixture = await setupRemoteFixture(page, { holdIndicatorPage: 2, onList: async (route, url, payload) => {
    if (url.searchParams.get('page') === '2' && url.searchParams.get('pageSize') === '10' && !url.searchParams.get('keyword')) {
      held = true;
      await gate;
    }
    if (!page.isClosed()) await route.fulfill({ json: payload });
  } });
  try {
    await page.goto('/indicator-maintenance?view=list');
    await expect(page.locator('table.dt tbody tr')).toHaveCount(20, { timeout: 20_000 });
    await choose(page, '每页条数', '10');
    await expect(page.locator('table.dt tbody tr')).toHaveCount(10);
    const pager = page.getByRole('navigation', { name: '指标维护分页', exact: true });
    await pager.getByRole('button', { name: '下一页' }).click();
    await expect.poll(() => held || fixture.isHeldPage()).toBe(true);
    const lateResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === '/api/indicators' && url.searchParams.get('page') === '2' && url.searchParams.get('pageSize') === '10';
    });
    await page.getByRole('textbox', { name: '全局搜索' }).fill('Needle indicator fixture');
    await expect(page.locator('table.dt tbody tr')).toHaveCount(1);
    await expect(page.locator('table.dt tbody')).toContainText('PAG_IND_23');
    await expect(pager).toContainText('1 / 1');
    release();
    fixture.releaseHeldPage();
    await lateResponse;
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(pager).toContainText('1 / 1');
    await expect(page.locator('table.dt tbody tr')).toHaveCount(1);
    await expect(page.locator('table.dt tbody')).toContainText('PAG_IND_23');
  } finally {
    release();
    fixture.releaseHeldPage();
  }
});
