import { useEffect, useState } from 'react';

import { DATA_MODE } from '../config/defaults.ts';
import {
  DEFAULT_PUBLIC_CATALOG_CONFIG,
  FAIL_CLOSED_PUBLIC_CATALOG_CONFIG,
  getPublicCatalogConfig,
  type PublicCatalogConfig,
} from '../api/publicCatalog.ts';

export interface UsePublicCatalogConfigResult {
  config: PublicCatalogConfig;
  ready: boolean;
}

export function usePublicCatalogConfig(): UsePublicCatalogConfigResult {
  const [config, setConfig] = useState<PublicCatalogConfig>(DEFAULT_PUBLIC_CATALOG_CONFIG);
  const [ready, setReady] = useState(DATA_MODE !== 'remote');

  useEffect(() => {
    if (DATA_MODE !== 'remote') return undefined;
    let active = true;
    getPublicCatalogConfig()
      .then((nextConfig) => {
        if (active) setConfig(nextConfig);
      })
      .catch((error: unknown) => {
        console.error('Failed to load public catalog configuration.', error);
        if (active) setConfig(FAIL_CLOSED_PUBLIC_CATALOG_CONFIG);
      })
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  return { config, ready };
}
