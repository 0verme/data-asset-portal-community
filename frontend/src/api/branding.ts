import { requestRemote } from './http.ts';
import { normalizeLanguage, type SupportedLanguage } from '../i18n/locale.ts';
import type { AccentPreset } from '../appearance/preferences.ts';

export type LocalizedBrandingText = Record<SupportedLanguage, string>;

export interface BrandingConfig {
  site: {
    title: LocalizedBrandingText;
    display_name: LocalizedBrandingText;
    announcement: LocalizedBrandingText;
    logo_url: string;
    favicon_url: string;
    default_accent: AccentPreset;
  };
  hero: {
    title: LocalizedBrandingText;
    subtitle: LocalizedBrandingText;
    search_placeholder: LocalizedBrandingText;
  };
  login: {
    hint: LocalizedBrandingText;
    quick_demo_login_enabled: false;
  };
}

export interface PublicBrandingConfig {
  site: {
    title: string;
    display_name: string;
    announcement: string;
    logo_url: string;
    favicon_url: string;
    default_accent: AccentPreset;
  };
  hero: {
    title: string;
    subtitle: string;
    search_placeholder: string;
  };
  login: {
    hint: string;
    quick_demo_login_enabled: false;
  };
  version: string;
}

const API_MODE = (
  typeof import.meta !== 'undefined' && import.meta.env?.['VITE_API_MODE']
    ? String(import.meta.env['VITE_API_MODE'])
    : 'mock'
).trim().toLowerCase();

const BASE_BRANDING: BrandingConfig = {
  site: {
    title: {
      'zh-CN': '数据资产门户',
      'en-US': 'Data Asset Portal',
    },
    display_name: {
      'zh-CN': '数据资产门户',
      'en-US': 'Data Asset Portal',
    },
    announcement: { 'zh-CN': '', 'en-US': '' },
    logo_url: '/brand-icon.svg',
    favicon_url: '/favicon.ico',
    default_accent: 'purple',
  },
  hero: {
    title: {
      'zh-CN': '数据资产门户',
      'en-US': 'Data Asset Portal',
    },
    subtitle: {
      'zh-CN': '一个入口，搜索系统、字段、词根、指标、报表、API、资产、下游推送和码值表。',
      'en-US': 'One place to search systems, fields, roots, metrics, reports, APIs, assets, downstream deliveries, and code tables.',
    },
    search_placeholder: {
      'zh-CN': '搜索资产、系统、字段、指标、报表、API、码值表、负责人或下游推送',
      'en-US': 'Search assets, systems, fields, metrics, reports, APIs, code tables, owners, or downstream deliveries',
    },
  },
  login: {
    hint: {
      'zh-CN': '无需登录即可浏览公开目录；登录后可按当前权限新增、编辑与维护数据资产。',
      'en-US': 'Browse the public catalog without signing in. Sign in to manage data according to your permissions.',
    },
    quick_demo_login_enabled: false,
  },
};

const PUBLIC_DEFAULTS: Record<SupportedLanguage, PublicBrandingConfig> = {
  'zh-CN': {
    site: {
      title: BASE_BRANDING.site.title['zh-CN'],
      display_name: BASE_BRANDING.site.display_name['zh-CN'],
      announcement: '',
      logo_url: BASE_BRANDING.site.logo_url,
      favicon_url: BASE_BRANDING.site.favicon_url,
      default_accent: BASE_BRANDING.site.default_accent,
    },
    hero: {
      title: BASE_BRANDING.hero.title['zh-CN'],
      subtitle: BASE_BRANDING.hero.subtitle['zh-CN'],
      search_placeholder: BASE_BRANDING.hero.search_placeholder['zh-CN'],
    },
    login: { hint: BASE_BRANDING.login.hint['zh-CN'], quick_demo_login_enabled: false },
    version: 'default-zh-CN',
  },
  'en-US': {
    site: {
      title: BASE_BRANDING.site.title['en-US'],
      display_name: BASE_BRANDING.site.display_name['en-US'],
      announcement: '',
      logo_url: BASE_BRANDING.site.logo_url,
      favicon_url: BASE_BRANDING.site.favicon_url,
      default_accent: BASE_BRANDING.site.default_accent,
    },
    hero: {
      title: BASE_BRANDING.hero.title['en-US'],
      subtitle: BASE_BRANDING.hero.subtitle['en-US'],
      search_placeholder: BASE_BRANDING.hero.search_placeholder['en-US'],
    },
    login: { hint: BASE_BRANDING.login.hint['en-US'], quick_demo_login_enabled: false },
    version: 'default-en-US',
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getRecord(value: unknown, key: string): Record<string, unknown> {
  return isRecord(value) && isRecord(value[key]) ? value[key] as Record<string, unknown> : {};
}

function getText(record: Record<string, unknown>, key: string, fallback: string, limit = 500, allowEmpty = false): string {
  const value = record[key];
  return typeof value === 'string' && value.length <= limit && (allowEmpty || value.length > 0) ? value : fallback;
}

function safeBrandingUrl(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  if (value === '/brand-icon.svg' || value === '/favicon.ico') return value;
  return /^\/static\/branding\/[0-9a-f]{64}\.(?:png|svg)$/.test(value) ? value : fallback;
}

function safeAccentPreset(value: unknown, fallback: AccentPreset): AccentPreset {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'purple' || normalized === 'green' || normalized === 'blue' || normalized === 'orange') {
    return normalized;
  }
  return fallback;
}

export function cloneBrandingConfig(config: BrandingConfig = BASE_BRANDING): BrandingConfig {
  return JSON.parse(JSON.stringify(config)) as BrandingConfig;
}

export function getDefaultPublicBranding(language: unknown): PublicBrandingConfig {
  return { ...PUBLIC_DEFAULTS[normalizeLanguage(language)] };
}

export function parsePublicBrandingConfig(value: unknown, language: unknown): PublicBrandingConfig {
  const locale = normalizeLanguage(language);
  const fallback = PUBLIC_DEFAULTS[locale];
  const data = isRecord(value) && isRecord(value['data']) ? value['data'] : value;
  if (!isRecord(data)) return { ...fallback };
  const site = getRecord(data, 'site');
  const hero = getRecord(data, 'hero');
  const login = getRecord(data, 'login');
  return {
    site: {
      title: getText(site, 'title', fallback.site.title, 160),
      display_name: getText(site, 'display_name', fallback.site.display_name, 128),
      announcement: getText(site, 'announcement', fallback.site.announcement, 500, true),
      logo_url: safeBrandingUrl(site['logo_url'], fallback.site.logo_url),
      favicon_url: safeBrandingUrl(site['favicon_url'], fallback.site.favicon_url),
      default_accent: safeAccentPreset(site['default_accent'], fallback.site.default_accent),
    },
    hero: {
      title: getText(hero, 'title', fallback.hero.title, 180),
      subtitle: getText(hero, 'subtitle', fallback.hero.subtitle, 400, true),
      search_placeholder: getText(hero, 'search_placeholder', fallback.hero.search_placeholder, 240),
    },
    login: {
      hint: getText(login, 'hint', fallback.login.hint),
      // This capability is deliberately inert until a separately reviewed flow exists.
      quick_demo_login_enabled: false,
    },
    version: getText(data, 'version', fallback.version, 64),
  };
}

function parseAdminBrandingConfig(value: unknown): { config: BrandingConfig; version: string } {
  const outer = isRecord(value) && isRecord(value['data']) ? value['data'] : value;
  const payload = isRecord(outer) && isRecord(outer['config']) ? outer['config'] : outer;
  const site = getRecord(payload, 'site');
  const hero = getRecord(payload, 'hero');
  const login = getRecord(payload, 'login');
  const localized = (record: Record<string, unknown>, key: string, fallback: LocalizedBrandingText, limit: number, allowEmpty = false): LocalizedBrandingText => {
    const value = getRecord(record, key);
    return {
      'zh-CN': getText(value, 'zh-CN', fallback['zh-CN'], limit, allowEmpty),
      'en-US': getText(value, 'en-US', fallback['en-US'], limit, allowEmpty),
    };
  };
  const config: BrandingConfig = {
    site: {
      title: localized(site, 'title', BASE_BRANDING.site.title, 160),
      display_name: localized(site, 'display_name', BASE_BRANDING.site.display_name, 128),
      announcement: localized(site, 'announcement', BASE_BRANDING.site.announcement, 500, true),
      logo_url: safeBrandingUrl(site['logo_url'], BASE_BRANDING.site.logo_url),
      favicon_url: safeBrandingUrl(site['favicon_url'], BASE_BRANDING.site.favicon_url),
      default_accent: safeAccentPreset(site['default_accent'], BASE_BRANDING.site.default_accent),
    },
    hero: {
      title: localized(hero, 'title', BASE_BRANDING.hero.title, 180),
      subtitle: localized(hero, 'subtitle', BASE_BRANDING.hero.subtitle, 400, true),
      search_placeholder: localized(hero, 'search_placeholder', BASE_BRANDING.hero.search_placeholder, 240),
    },
    login: {
      hint: localized(login, 'hint', BASE_BRANDING.login.hint, 500),
      quick_demo_login_enabled: false,
    },
  };
  const wrapper = isRecord(outer) ? outer : {};
  return { config, version: getText(wrapper, 'version', 'default', 64) };
}

export function isBrandingRemoteMode(): boolean {
  return API_MODE === 'remote';
}

export async function getPublicBrandingConfig(language: unknown): Promise<PublicBrandingConfig> {
  const locale = normalizeLanguage(language);
  if (API_MODE !== 'remote') return getDefaultPublicBranding(locale);
  const payload = await requestRemote<unknown>('/system/public-config', {
    params: { lang: locale },
    timeout: 5000,
    cache: 'no-cache',
    suppressUnauthorizedEvent: true,
  });
  return parsePublicBrandingConfig(payload, locale);
}

export async function getAdminBrandingConfig(): Promise<{ config: BrandingConfig; version: string }> {
  if (API_MODE !== 'remote') return { config: cloneBrandingConfig(), version: 'local-default' };
  return parseAdminBrandingConfig(await requestRemote<unknown>('/system/branding-config', { timeout: 5000 }));
}

export async function updateAdminBrandingConfig(config: BrandingConfig): Promise<{ config: BrandingConfig; version: string }> {
  if (API_MODE !== 'remote') throw new Error('Branding settings can only be saved in Remote mode.');
  return parseAdminBrandingConfig(await requestRemote<unknown>('/system/branding-config', {
    method: 'PUT',
    body: config,
  }));
}

export async function resetAdminBrandingConfig(): Promise<{ config: BrandingConfig; version: string }> {
  if (API_MODE !== 'remote') throw new Error('Branding settings can only be reset in Remote mode.');
  return parseAdminBrandingConfig(await requestRemote<unknown>('/system/branding-config/reset', {
    method: 'POST',
    body: {},
  }));
}

export async function uploadBrandingAsset(kind: 'logo' | 'favicon', file: File): Promise<string> {
  if (API_MODE !== 'remote') throw new Error('Branding uploads require Remote mode.');
  const form = new FormData();
  form.set('file', file);
  const payload = await requestRemote<unknown>(`/system/branding-config/assets/${kind}`, {
    method: 'POST',
    body: form,
  });
  const outer = isRecord(payload) && isRecord(payload['data']) ? payload['data'] : {};
  const url = safeBrandingUrl(outer['url'], '');
  if (!url) throw new Error('The uploaded branding asset response is invalid.');
  return url;
}
