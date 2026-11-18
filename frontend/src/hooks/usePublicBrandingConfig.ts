import { useCallback, useEffect, useRef, useState } from 'react';

import {
  getDefaultPublicBranding,
  getPublicBrandingConfig,
  type PublicBrandingConfig,
} from '../api/branding.ts';
import { normalizeLanguage } from '../i18n/locale.ts';

export const BRANDING_CONFIG_CHANGED_EVENT = 'dap:branding-config-changed';
const REFRESH_INTERVAL_MS = 60_000;

export interface UsePublicBrandingConfigResult {
  config: PublicBrandingConfig;
  refresh: () => Promise<void>;
}

export function usePublicBrandingConfig(language: unknown): UsePublicBrandingConfigResult {
  const locale = normalizeLanguage(language);
  const [config, setConfig] = useState<PublicBrandingConfig>(() => getDefaultPublicBranding(locale));
  const requestSequence = useRef(0);
  const lastRefreshAt = useRef(0);

  const refresh = useCallback(async (): Promise<void> => {
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    try {
      const next = await getPublicBrandingConfig(locale);
      if (sequence !== requestSequence.current) return;
      setConfig(next);
      lastRefreshAt.current = Date.now();
    } catch (error: unknown) {
      // Preserve the last good settings. A temporary network failure is not a
      // signal that an administrator cleared a configured value.
      console.warn('Failed to refresh public site branding.', error);
    }
  }, [locale]);

  useEffect(() => {
    setConfig(getDefaultPublicBranding(locale));
    void refresh();
    const timer = window.setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    const refreshWhenVisible = (): void => {
      if (document.visibilityState === 'visible' && Date.now() - lastRefreshAt.current >= REFRESH_INTERVAL_MS) {
        void refresh();
      }
    };
    const refreshAfterUpdate = (): void => { void refresh(); };
    window.addEventListener(BRANDING_CONFIG_CHANGED_EVENT, refreshAfterUpdate);
    window.addEventListener('focus', refreshWhenVisible);
    return () => {
      requestSequence.current += 1;
      window.clearInterval(timer);
      window.removeEventListener(BRANDING_CONFIG_CHANGED_EVENT, refreshAfterUpdate);
      window.removeEventListener('focus', refreshWhenVisible);
    };
  }, [locale, refresh]);

  return { config, refresh };
}
