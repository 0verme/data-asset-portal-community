/// <reference types="vite/client" />

declare module "@cloudflare/kumo/styles/standalone";

interface DapReleaseMetadata {
  readonly version: string;
  readonly releaseUrl: string;
  readonly repositoryUrl: string;
}

/** Injected by Vite at server/build startup from the latest stable GitHub Release. */
declare const __DAP_RELEASE_METADATA__: DapReleaseMetadata;

/** Build-time constant, used to tree-shake Mock-only AI imports from Remote bundles. */
interface ImportMetaEnv {
  readonly VITE_API_MODE: string;
  readonly VITE_DEFAULT_ACCENT?: string;
}
