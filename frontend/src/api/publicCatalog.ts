import { DATA_MODE } from '../config/defaults.ts';
import { requestRemote } from './http.ts';

export type PublicCatalogProfile = 'internal' | 'strict' | 'disabled';

export interface PublicCatalogConfig {
  profile: PublicCatalogProfile;
  exportEnabled: boolean;
}

export const DEFAULT_PUBLIC_CATALOG_CONFIG: PublicCatalogConfig = Object.freeze({
  profile: 'internal',
  exportEnabled: false,
});

export const FAIL_CLOSED_PUBLIC_CATALOG_CONFIG: PublicCatalogConfig = Object.freeze({
  profile: 'disabled',
  exportEnabled: false,
});

export function parsePublicCatalogConfig(value: unknown): PublicCatalogConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid public catalog configuration payload');
  }
  const payload = value as Record<string, unknown>;
  const profile = payload['profile'];
  const exportEnabled = payload['exportEnabled'];
  if (
    profile !== 'internal' && profile !== 'strict' && profile !== 'disabled'
  ) {
    throw new Error('Invalid public catalog profile');
  }
  if (typeof exportEnabled !== 'boolean') {
    throw new Error('Invalid public catalog export configuration');
  }
  return { profile, exportEnabled };
}

export async function getPublicCatalogConfig(): Promise<PublicCatalogConfig> {
  if (DATA_MODE !== 'remote') return DEFAULT_PUBLIC_CATALOG_CONFIG;
  const payload = await requestRemote<unknown>('/public-catalog/config', {
    suppressUnauthorizedEvent: true,
  });
  return parsePublicCatalogConfig(payload);
}
