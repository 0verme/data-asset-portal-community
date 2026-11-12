/// <reference types="vite/client" />

declare module "@cloudflare/kumo/styles/standalone";

/** Build-time constant, used to tree-shake Mock-only AI imports from Remote bundles. */
interface ImportMetaEnv {
  readonly VITE_API_MODE: string;
  readonly VITE_DEFAULT_ACCENT?: string;
}
