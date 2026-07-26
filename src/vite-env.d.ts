/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Google OAuth client id (public by design) — set via deploy env */
  readonly VITE_GCAL_CLIENT_ID?: string
  /** Twelve Data market key — set via deploy env (ships in the public bundle) */
  readonly VITE_MARKET_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
