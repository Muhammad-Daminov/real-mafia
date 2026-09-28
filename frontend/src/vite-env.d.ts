/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Origin of the NestJS backend, e.g. `https://api.example.com` (no trailing slash). */
  readonly VITE_API_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
