import { expect, test, type Page } from '@playwright/test';

type Item = Record<string, unknown>;
type ManagementKind = 'users' | 'roles' | 'menus' | 'param-dicts';

function user(index: number): Item {
  return {
    id: `USR${String(index).padStart(3, '0')}`,
    username: `fixture-user-${String(index).padStart(2, '0')}`,
    displayName: index === 23 ? 'Tail User' : `Fixture User ${String(index).padStart(2, '0')}`,
    status: index % 2 ? 'enabled' : 'disabled',
    role: index % 2 ? 'admin' : 'maintainer',
    email: '', remark: '', createdAt: index === 23 ? '2026-10-01 12:00:00' : '2026-11-01 12:00:00', lastLoginAt: '',
  };
}

function role(index: number): Item {
  return {
    roleCode: `fixture-role-${String(index).padStart(2, '0')}`,
    name: index === 23 ? 'Tail Role' : `Fixture Role ${String(index).padStart(2, '0')}`,
    description: `Synthetic role ${index}`, builtin: false, enabled: 'enabled',
    permissionCodes: ['system:user:read'], userCount: index,
  };
}

function menu(index: number): Item {
  return {
    id: String(index), code: `fixture-menu-${String(index).padStart(2, '0')}`,
    name: index === 23 ? 'Tail Menu' : `Fixture Menu ${String(index).padStart(2, '0')}`,
    icon: 'grid', path: `/fixture/${index}`, order: index * 10, status: 'enabled',
    adminOnly: false, desc: `Synthetic menu ${index}`, navPlacement: 'more', updatedAt: '',
  };
}

function parameter(index: number): Item {
  return {
    id: String(1000 + index), categoryCode: 'PAGING_FIXTURE', categoryName: 'Pagination Fixture',
    code: `ITEM_${String(index).padStart(2, '0')}`,
    name: index === 23 ? 'Tail Parameter' : `Fixture Parameter ${String(index).padStart(2, '0')}`,
    value: `fixture-value-${index}`, desc: `Synthetic dictionary item ${index}`,
    status: 'enabled', updatedAt: '',
  };
}

const fixtures: Record<ManagementKind, Item[]> = {
  users: Array.from({ length: 23 }, (_, offset) => user(offset + 1)),
  roles: Array.from({ length: 23 }, (_, offset) => role(offset + 1)),
  menus: Array.from({ length: 23 }, (_, offset) => menu(offset + 1)),
  'param-dicts': Array.from({ length: 23 }, (_, offset) => parameter(offset + 1)),
};

function searchValues(kind: ManagementKind, item: Item): unknown[] {
  if (kind === 'users') return [item['username'], item['displayName'], item['status'], item['role']];
  if (kind === 'roles') return [item['roleCode'], item['name'], item['description']];
  if (kind === 'menus') return [item['code'], item['name'], item['path'], item['desc']];
  return [item['categoryCode'], item['categoryName'], item['code'], item['name'], item['value'], item['desc']];
}

async function installFixtures(page: Page) {
  const requests: Array<{ path: string; keyword: string; page: string; pageSize: string }> = [];
  let fullRoleCandidates = 0;
  let fullDictionaryCandidates = 0;
  await page.addInitScript(() => {
    localStorage.setItem('dap_auth', JSON.stringify({ role: 'admin', user: 'pagination-admin', name: 'Pagination Admin' }));
    localStorage.setItem('dap-theme', 'light');
  });
  await page.route(/^https?:\/\/[^/]+\/api(?:\/|$)/, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api/, '');
    if (path === '/auth/me') {
      await route.fulfill({ json: { data: {
        role: 'admin', user: 'pagination-admin', name: 'Pagination Admin',
        permissions: [
          'asset:write', 'system:user:read', 'system:user:write', 'system:role:read', 'system:role:write',
          'system:menu:read', 'system:menu:write', 'system:param:read', 'system:param:write',
        ],
      } } });
      return;
    }
    if (path === '/public-catalog/config') {
      await route.fulfill({ json: { profile: 'internal', exportEnabled: false } });
      return;
    }
    if (path === '/system/permissions') {
      await route.fulfill({ json: { items: [{ code: 'system:user:read', name: '读取用户', description: '' }] } });
      return;
    }
    if (path === '/system/roles' && request.method() === 'GET') {
      fullRoleCandidates += 1;
      await route.fulfill({ json: { items: fixtures.roles } });
      return;
    }
    if (path === '/system/menus' && request.method() === 'GET') {
      await route.fulfill({ json: { items: fixtures.menus } });
      return;
    }
    if (path === '/system/param-dicts/categories') {
      await route.fulfill({ json: { items: [{ code: 'PAGING_FIXTURE', name: 'Pagination Fixture', desc: 'Synthetic only', status: 'enabled', count: 23 }] } });
      return;
    }
    if (path === '/system/param-dicts' && request.method() === 'GET') {
      fullDictionaryCandidates += 1;
      await route.fulfill({ json: { items: fixtures['param-dicts'] } });
      return;
    }
    const kindByPath: Record<string, ManagementKind> = {
      '/system/users/page': 'users',
      '/system/roles/page': 'roles',
      '/system/menus/page': 'menus',
      '/system/param-dicts/page': 'param-dicts',
    };
    const kind = kindByPath[path];
    if (kind && request.method() === 'GET') {
      const requestedPage = Math.max(1, Number(url.searchParams.get('page') || 1));
      const pageSize = Math.max(1, Number(url.searchParams.get('pageSize') || 20));
      const keyword = (url.searchParams.get('keyword') || '').trim().toLowerCase();
      requests.push({ path, keyword, page: String(requestedPage), pageSize: String(pageSize) });
      const categoryMatches = kind !== 'param-dicts' || url.searchParams.get('categoryCode') === 'PAGING_FIXTURE';
      const matches = fixtures[kind].filter((item) => categoryMatches && (
        !keyword || searchValues(kind, item).some((value) => String(value || '').toLowerCase().includes(keyword))
      ));
      await route.fulfill({ json: {
        items: matches.slice((requestedPage - 1) * pageSize, requestedPage * pageSize),
        total: matches.length, page: requestedPage, pageSize,
      } });
      return;
    }
    await route.fulfill({ json: { items: [] } });
  });
  return { requests, get fullRoleCandidates() { return fullRoleCandidates; }, get fullDictionaryCandidates() { return fullDictionaryCandidates; } };
}

const cases: Array<{ kind: ManagementKind; path: string; pager: string; tail: string; keyword: string }> = [
  { kind: 'users', path: '/system-management/users', pager: '用户管理分页', tail: 'Tail User', keyword: 'Tail User' },
  { kind: 'roles', path: '/system-management/roles', pager: '角色管理分页', tail: 'Tail Role', keyword: 'Tail Role' },
  { kind: 'menus', path: '/system-management/menus', pager: '菜单管理分页', tail: 'Tail Menu', keyword: 'Tail Menu' },
  { kind: 'param-dicts', path: '/system-management/param-dicts', pager: '参数字典明细分页', tail: 'Tail Parameter', keyword: 'Tail Parameter' },
];

test('system management tables fetch database pages, reset server search, and retain unpaged candidates/navigation', async ({ page }) => {
  const api = await installFixtures(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const item of cases) {
    await page.goto(item.path);
    const rows = page.locator('table.dt tbody tr');
    await expect(rows).toHaveCount(20, { timeout: 20_000 });
    const pager = page.getByRole('navigation', { name: item.pager, exact: true });
    await expect(pager).toContainText('1 / 2');
    await expect(pager).toContainText('共 23 条');
    await pager.getByRole('button', { name: '下一页' }).click();
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(2)).toContainText(item.tail.split(' ')[0]);
    await expect(pager).toContainText('2 / 2');
    const lastRequest = api.requests.filter((request) => request.path === `/system/${item.kind}/page`).at(-1);
    expect(lastRequest?.page).toBe('2');

    const search = page.locator('.search-input');
    await search.fill(item.keyword);
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(item.tail.split(' ')[0]);
    await expect(pager).toContainText('1 / 1');
    const filteredRequest = api.requests.filter((request) => request.path === `/system/${item.kind}/page`).at(-1);
    expect(filteredRequest?.keyword).toBe(item.keyword.toLowerCase());
    expect(filteredRequest?.page).toBe('1');
    await search.fill('');
    await expect(rows).toHaveCount(20);
  }
  expect(api.fullRoleCandidates).toBeGreaterThan(0);
  expect(api.fullDictionaryCandidates).toBe(0); // Management uses a page; legacy full candidate API remains available independently.
});

test('status mutations reload the current server query and page', async ({ page }) => {
  const api = await installFixtures(page);
  let mutationPath = '';
  let mutationResponse: Item = {};
  let signalMutationStarted: () => void = () => {};
  let releaseMutation: () => void = () => {};
  let mutationGate: Promise<void> = Promise.resolve();
  await page.route(/^https?:\/\/[^/]+\/api(?:\/|$)/, async (route) => {
    const request = route.request();
    if (request.method() === 'PATCH' && new URL(request.url()).pathname === mutationPath) {
      signalMutationStarted();
      await mutationGate;
      await route.fulfill({ json: { data: mutationResponse } });
      return;
    }
    await route.fallback();
  });
  const armMutation = (path: string, response: Item) => {
    mutationPath = path;
    mutationResponse = response;
    const started = new Promise<void>((resolve) => { signalMutationStarted = resolve; });
    mutationGate = new Promise<void>((resolve) => { releaseMutation = resolve; });
    return { started, release: () => releaseMutation() };
  };

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/system-management/users');
  const rows = page.locator('table.dt tbody tr');
  const userPager = page.getByRole('navigation', { name: '用户管理分页', exact: true });
  await expect(rows).toHaveCount(20, { timeout: 20_000 });
  await userPager.getByRole('button', { name: '下一页' }).click();
  await expect(rows).toHaveCount(3);
  const userMutation = armMutation('/api/system/users/fixture-user-21/status', { ...user(21), status: 'disabled' });
  await rows.filter({ hasText: 'fixture-user-21' }).getByRole('button', { name: '禁用', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '禁用', exact: true }).click();
  await userMutation.started;
  await page.locator('.search-input').fill('Tail User');
  await expect(rows).toHaveCount(1);
  await userMutation.release();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Tail User');
  await expect(userPager).toContainText('1 / 1');
  await expect(userPager).toContainText('共 1 条');
  const latestUserRequest = api.requests.filter((request) => request.path === '/system/users/page').at(-1);
  expect(latestUserRequest?.keyword).toBe('tail user');
  expect(latestUserRequest?.page).toBe('1');

  await page.goto('/system-management/menus');
  await expect(rows).toHaveCount(20, { timeout: 20_000 });
  const menuPager = page.getByRole('navigation', { name: '菜单管理分页', exact: true });
  await menuPager.getByRole('button', { name: '下一页' }).click();
  await expect(rows).toHaveCount(3);
  const menuMutation = armMutation('/api/system/menus/21/status', { ...menu(21), status: 'disabled' });
  await rows.filter({ hasText: 'fixture-menu-21' }).getByRole('button', { name: '禁用', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '禁用', exact: true }).click();
  await menuMutation.started;
  await page.locator('.search-input').fill('Tail Menu');
  await expect(rows).toHaveCount(1);
  await menuMutation.release();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Tail Menu');
  await expect(menuPager).toContainText('1 / 1');
  await expect(menuPager).toContainText('共 1 条');
  const latestMenuRequest = api.requests.filter((request) => request.path === '/system/menus/page').at(-1);
  expect(latestMenuRequest?.keyword).toBe('tail menu');
  expect(latestMenuRequest?.page).toBe('1');
});

test('system pagination footers stay in a narrow viewport without clipping', async ({ page }) => {
  const api = await installFixtures(page);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const item of cases) {
    await page.goto(item.path);
    const pager = page.getByRole('navigation', { name: item.pager, exact: true });
    await expect(pager).toBeVisible({ timeout: 20_000 });
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
  expect(api.requests.length).toBeGreaterThan(0);
});
