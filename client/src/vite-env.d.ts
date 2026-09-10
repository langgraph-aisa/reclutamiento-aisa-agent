/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BUILD_BRANCH?: string;
  readonly VITE_BUILD_COMMIT?: string;
  readonly VITE_GITHUB_SYNC_PERCENTAGE?: string;
  readonly VITE_REPOSITORY_LANGUAGES?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
