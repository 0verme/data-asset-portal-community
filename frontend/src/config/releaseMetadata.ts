export interface AppReleaseMetadata {
  readonly version: string;
  readonly releaseUrl: string;
  readonly repositoryUrl: string;
}

export const APP_RELEASE_METADATA: AppReleaseMetadata = Object.freeze(__DAP_RELEASE_METADATA__);
