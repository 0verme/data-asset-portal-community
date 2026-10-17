import { expect, test } from '@playwright/test';

test('Remote data trust distinguishes partial search and unavailable statistics from empty data', async ({ page }) => {
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/me') return route.fulfill({ status: 401, json: { message: 'anonymous' } });
    if (path === '/api/public-catalog/config') return route.fulfill({ json: { profile: 'internal', exportEnabled: false } });
    if (path === '/api/portal/stats') return route.fulfill({ status: 503, json: { error: { code: 'PORTAL_STATS_UNAVAILABLE', message: '统计暂时不可用，请稍后重试。' } } });
    if (path === '/api/search') return route.fulfill({ json: {
      query: 'missing', scope: 'all', groups: [], total: 0, partial: true, failedGroups: ['asset'],
    } });
    return route.fulfill({ json: { items: [] } });
  });
  await page.goto('/');
  await expect(page.getByText('统计暂时不可用，请稍后重试。', { exact: true })).toBeVisible();
  await expect(page.locator('.sp-stat-card')).toHaveCount(0);
  await page.getByRole('textbox', { name: '搜索数据资产' }).fill('missing');
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: '搜索结果不完整' })).toBeVisible();
  await expect(page.getByText('已查询模块暂无匹配', { exact: true })).toBeVisible();
  await expect(page.getByText('没有找到匹配的资产', { exact: true })).toHaveCount(0);
});
