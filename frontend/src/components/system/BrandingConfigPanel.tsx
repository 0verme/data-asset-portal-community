import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  cloneBrandingConfig,
  getAdminBrandingConfig,
  isBrandingRemoteMode,
  resetAdminBrandingConfig,
  updateAdminBrandingConfig,
  uploadBrandingAsset,
  type BrandingConfig,
  type LocalizedBrandingText,
} from '../../api/branding.ts';
import { BRANDING_CONFIG_CHANGED_EVENT } from '../../hooks/usePublicBrandingConfig.ts';
import { normalizeLanguage, type SupportedLanguage } from '../../i18n/locale.ts';
import { BrandLogo } from '../BrandLogo.tsx';
import { Icon } from '../ui.tsx';
import { Button, Input, Select, Textarea } from '../../ui/index.ts';
import type { AccentPreset } from '../../appearance/preferences.ts';

interface LocalizedFieldProps {
  label: string;
  value: LocalizedBrandingText;
  disabled: boolean;
  multiline?: boolean;
  onChange: (language: SupportedLanguage, value: string) => void;
}

function LocalizedField({ label, value, disabled, multiline = false, onChange }: LocalizedFieldProps) {
  const { t } = useTranslation('common');
  return (
    <div className="branding-localized-field">
      <div className="branding-field-label">{label}</div>
      <div className="branding-language-pair">
        {(['zh-CN', 'en-US'] as const).map((language) => (
          <label className="branding-language-input" key={`${label}-${language}`}>
            <span>{t(language === 'zh-CN' ? 'branding.chinese' : 'branding.english')}</span>
            {multiline ? (
              <Textarea
                className="ta"
                aria-label={`${label} (${language})`}
                value={value[language]}
                disabled={disabled}
                onChange={(event) => onChange(language, event.target.value)}
              />
            ) : (
              <Input
                className="inp"
                aria-label={`${label} (${language})`}
                value={value[language]}
                maxLength={240}
                disabled={disabled}
                onChange={(event) => onChange(language, event.target.value)}
              />
            )}
          </label>
        ))}
      </div>
    </div>
  );
}

export function BrandingConfigPanel({ canEdit }: { canEdit: boolean }) {
  const { t } = useTranslation('common');
  const [config, setConfig] = useState<BrandingConfig>(() => cloneBrandingConfig());
  const [loadState, setLoadState] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [reloadCount, setReloadCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<'logo' | 'favicon' | ''>('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const remote = isBrandingRemoteMode();
  const controlsDisabled = !canEdit || !remote || loadState !== 'loaded' || saving || Boolean(uploading);

  useEffect(() => {
    let active = true;
    getAdminBrandingConfig()
      .then((response) => {
        if (!active) return;
        setConfig(response.config);
        setError('');
        setLoadState('loaded');
      })
      .catch(() => {
        if (!active) return;
        setError('');
        setLoadState('error');
      });
    return () => { active = false; };
  }, [reloadCount]);

  const retryLoad = (): void => {
    setNotice('');
    setError('');
    setLoadState('loading');
    setReloadCount((current) => current + 1);
  };

  const updateLocalized = (
    section: 'site' | 'hero' | 'login',
    field: string,
    language: SupportedLanguage,
    value: string,
  ): void => {
    if (!canEdit || !remote || loadState !== 'loaded') return;
    setConfig((current) => {
      const next = cloneBrandingConfig(current);
      const sectionConfig = next[section] as unknown as Record<string, unknown>;
      const translations = sectionConfig[field] as LocalizedBrandingText;
      sectionConfig[field] = { ...translations, [language]: value };
      return next;
    });
    setNotice('');
  };

  const save = async (): Promise<void> => {
    if (!canEdit || !remote || loadState !== 'loaded' || saving || Boolean(uploading)) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const saved = await updateAdminBrandingConfig(config);
      setConfig(saved.config);
      setNotice(t('branding.saved'));
      window.dispatchEvent(new Event(BRANDING_CONFIG_CHANGED_EVENT));
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : t('branding.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const restoreDefaults = async (): Promise<void> => {
    if (!canEdit || !remote || loadState !== 'loaded' || saving || Boolean(uploading)) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const restored = await resetAdminBrandingConfig();
      setConfig(restored.config);
      setNotice(t('branding.restored'));
      window.dispatchEvent(new Event(BRANDING_CONFIG_CHANGED_EVENT));
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : t('branding.resetFailed'));
    } finally {
      setSaving(false);
    }
  };

  const upload = async (kind: 'logo' | 'favicon', file: File | undefined): Promise<void> => {
    if (!file || !canEdit || !remote || loadState !== 'loaded' || saving || Boolean(uploading)) return;
    setUploading(kind);
    setError('');
    setNotice('');
    try {
      const url = await uploadBrandingAsset(kind, file);
      setConfig((current) => ({
        ...current,
        site: { ...current.site, [kind === 'logo' ? 'logo_url' : 'favicon_url']: url },
      }));
      setNotice(t('branding.uploaded'));
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : t('branding.uploadFailed'));
    } finally {
      setUploading('');
    }
  };

  const currentLanguage = normalizeLanguage(document.documentElement.lang);
  return (
    <details className="rag-config-panel branding-config-panel" open>
      <summary>
        <span className="rag-config-title">{t('branding.title')}</span>
        <span className={`rag-config-state ${loadState === 'error' ? 'rag-config-state-unavailable' : 'rag-config-state-ready'}`}>
          {loadState === 'loading'
            ? t('branding.loading')
            : loadState === 'error'
              ? t('branding.loadFailed')
              : remote ? t('branding.modeRemote') : t('branding.modeMock')}
        </span>
      </summary>
      <div className="rag-config-body">
        <p className="rag-config-intro">{t('branding.description')}</p>
        {loadState === 'loading' ? (
          <div className="rag-config-message" role="status" aria-live="polite">{t('branding.loadingConfig')}</div>
        ) : null}
        {loadState === 'error' ? (
          <div className="rag-config-error" role="alert">
            <p>{t('branding.loadFailed')}</p>
            <Button type="button" variant="secondary" disabled={saving || Boolean(uploading)} onClick={retryLoad}>
              {t('branding.retryLoad')}
            </Button>
          </div>
        ) : null}

        {loadState === 'loaded' ? <>
          {!remote ? <div className="rag-config-message" role="status">{t('branding.mockNotice')}</div> : null}
          {!canEdit ? <div className="rag-config-message" role="status">{t('branding.readOnly')}</div> : null}
          {error ? <div className="rag-config-error" role="alert">{error}</div> : null}
          {notice ? <div className="rag-config-message" role="status">{notice}</div> : null}

          <div className="branding-section-heading">{t('branding.siteSection')}</div>
          <div className="branding-fields-grid">
            <LocalizedField label={t('branding.siteTitle')} value={config.site.title} disabled={controlsDisabled} onChange={(language, value) => updateLocalized('site', 'title', language, value)} />
            <LocalizedField label={t('branding.displayName')} value={config.site.display_name} disabled={controlsDisabled} onChange={(language, value) => updateLocalized('site', 'display_name', language, value)} />
            <LocalizedField label={t('branding.announcement')} value={config.site.announcement} multiline disabled={controlsDisabled} onChange={(language, value) => updateLocalized('site', 'announcement', language, value)} />

            <label className="rag-config-field">
              <span className="branding-field-label">{t('branding.defaultAccent')}</span>
              <Select<string>
                aria-label={t('branding.defaultAccent')}
                className="inp"
                items={[
                  { label: t('branding.accentOptions.purple'), value: 'purple' },
                  { label: t('branding.accentOptions.green'), value: 'green' },
                  { label: t('branding.accentOptions.blue'), value: 'blue' },
                  { label: t('branding.accentOptions.orange'), value: 'orange' },
                ]}
                value={config.site.default_accent}
                disabled={controlsDisabled}
                onValueChange={(value) => {
                  if (value === 'purple' || value === 'green' || value === 'blue' || value === 'orange') {
                    const nextAccent: AccentPreset = value;
                    setConfig((current) => ({ ...current, site: { ...current.site, default_accent: nextAccent } }));
                    setNotice('');
                  }
                }}
              />
              <small>{t('branding.defaultAccentDescription')}</small>
            </label>

            <div className="branding-asset-field">
              <span className="branding-field-label">{t('branding.logo')}</span>
              <div className="branding-asset-preview">
                <span className="brand-mark"><BrandLogo src={config.site.logo_url} alt={config.site.display_name[currentLanguage]} /></span>
                <code>{config.site.logo_url}</code>
              </div>
              <label className="branding-file-input">
                <span>{uploading === 'logo' ? t('branding.uploading') : t('branding.uploadLogo')}</span>
                <input type="file" accept=".png,.svg,image/png,image/svg+xml" disabled={controlsDisabled} onChange={(event) => { void upload('logo', event.target.files?.[0]); event.currentTarget.value = ''; }} />
              </label>
              <Button type="button" variant="tertiary" size="sm" disabled={controlsDisabled} onClick={() => setConfig((current) => ({ ...current, site: { ...current.site, logo_url: '/brand-icon.svg' } }))}>{t('branding.restoreLogo')}</Button>
            </div>

            <div className="branding-asset-field">
              <span className="branding-field-label">{t('branding.favicon')}</span>
              <div className="branding-asset-preview branding-favicon-preview">
                <span className="brand-mark"><BrandLogo src={config.site.favicon_url} alt={config.site.display_name[currentLanguage]} /></span>
                <code>{config.site.favicon_url}</code>
              </div>
              <label className="branding-file-input">
                <span>{uploading === 'favicon' ? t('branding.uploading') : t('branding.uploadFavicon')}</span>
                <input type="file" accept=".png,.svg,image/png,image/svg+xml" disabled={controlsDisabled} onChange={(event) => { void upload('favicon', event.target.files?.[0]); event.currentTarget.value = ''; }} />
              </label>
              <Button type="button" variant="tertiary" size="sm" disabled={controlsDisabled} onClick={() => setConfig((current) => ({ ...current, site: { ...current.site, favicon_url: '/favicon.ico' } }))}>{t('branding.restoreFavicon')}</Button>
            </div>
          </div>

          <div className="branding-section-heading">{t('branding.homeSection')}</div>
          <div className="branding-fields-grid">
            <LocalizedField label={t('branding.heroTitle')} value={config.hero.title} disabled={controlsDisabled} onChange={(language, value) => updateLocalized('hero', 'title', language, value)} />
            <LocalizedField label={t('branding.heroSubtitle')} value={config.hero.subtitle} multiline disabled={controlsDisabled} onChange={(language, value) => updateLocalized('hero', 'subtitle', language, value)} />
            <LocalizedField label={t('branding.searchPlaceholder')} value={config.hero.search_placeholder} disabled={controlsDisabled} onChange={(language, value) => updateLocalized('hero', 'search_placeholder', language, value)} />
          </div>

          <div className="branding-section-heading">{t('branding.loginSection')}</div>
          <div className="branding-fields-grid">
            <LocalizedField label={t('branding.loginHint')} value={config.login.hint} multiline disabled={controlsDisabled} onChange={(language, value) => updateLocalized('login', 'hint', language, value)} />
            <div className="branding-quick-demo" role="status">
              <Icon name="shield" size={15} />
              <span>{t('branding.quickDemoDisabled')}</span>
            </div>
          </div>

          <div className="branding-actions">
            <Button type="button" variant="primary" disabled={controlsDisabled} onClick={() => void save()}>
              {saving ? t('branding.saving') : t('branding.save')}
            </Button>
            <Button type="button" variant="secondary" disabled={controlsDisabled} onClick={() => void restoreDefaults()}>
              {t('branding.restoreDefaults')}
            </Button>
          </div>
        </> : null}
      </div>
    </details>
  );
}
