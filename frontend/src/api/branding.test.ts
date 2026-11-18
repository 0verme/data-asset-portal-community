import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getAdminBrandingConfig,
  getDefaultPublicBranding,
  parsePublicBrandingConfig,
  resetAdminBrandingConfig,
  updateAdminBrandingConfig,
  uploadBrandingAsset,
  type PublicBrandingConfig,
} from './branding.ts';

test('branding defaults preserve the localized Chinese and English portal copy', () => {
  assert.equal(getDefaultPublicBranding('zh-CN').hero.title, '数据资产管理与血缘分析平台');
  assert.match(getDefaultPublicBranding('en-US').hero.search_placeholder, /^Search assets/);
  assert.equal(getDefaultPublicBranding('en-US').login.quick_demo_login_enabled, false);
});

test('public branding parser falls back per field and discards unknown or unsafe values', () => {
  const parsed = parsePublicBrandingConfig({
    data: {
      site: {
        title: 12,
        display_name: 'Custom Portal',
        announcement: '<img src=x onerror=alert(1)>',
        logo_url: 'https://attacker.invalid/brand.svg',
        favicon_url: '/static/branding/' + 'a'.repeat(64) + '.svg',
        secret: 'never expose',
      },
      hero: { title: 'Welcome', subtitle: false, search_placeholder: 'Search anything' },
      login: { hint: 'Ask your administrator', quick_demo_login_enabled: true },
      databasePassword: 'never expose',
      version: 'rev-1',
    },
  }, 'en-US');

  assert.equal(parsed.site.title, getDefaultPublicBranding('en-US').site.title);
  assert.equal(parsed.site.display_name, 'Custom Portal');
  assert.equal(parsed.site.announcement, '<img src=x onerror=alert(1)>');
  assert.equal(parsed.site.logo_url, '/brand-icon.svg');
  assert.match(parsed.site.favicon_url, /^\/static\/branding\/[a-f0-9]{64}\.svg$/);
  assert.equal(parsed.hero.subtitle, getDefaultPublicBranding('en-US').hero.subtitle);
  assert.equal(parsed.login.hint, 'Ask your administrator');
  assert.equal(parsed.login.quick_demo_login_enabled, false);
  assert.equal((parsed as PublicBrandingConfig & { databasePassword?: string }).databasePassword, undefined);
  assert.equal(JSON.stringify(parsed).includes('never expose'), false);
});

test('malformed public branding payload falls back to a complete localized config', () => {
  const parsed = parsePublicBrandingConfig({ site: 'invalid', hero: null }, 'zh-CN');
  assert.deepEqual(parsed, getDefaultPublicBranding('zh-CN'));
});

test('Mock branding remains read-only and never contacts the backend', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error('Mock branding must not fetch');
  }) as typeof fetch;
  try {
    const local = await getAdminBrandingConfig();
    assert.equal(local.version, 'local-default');
    assert.equal(local.config.site.title['zh-CN'], getDefaultPublicBranding('zh-CN').site.title);
    await assert.rejects(updateAdminBrandingConfig(local.config), /Remote mode/);
    await assert.rejects(resetAdminBrandingConfig(), /Remote mode/);
    await assert.rejects(uploadBrandingAsset('logo', new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' })), /Remote mode/);
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
