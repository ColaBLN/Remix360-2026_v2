/// <reference types="vite/client" />

/** Von vite.config.ts aus der package.json eingesetzt. */
declare const __APP_VERSION__: string;
declare const __BUILD_DATE__: string;

interface ImportMetaEnv {
  readonly VITE_ACCESS_HASH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
