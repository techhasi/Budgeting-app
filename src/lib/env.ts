/**
 * Build-time key defaults injected from GitHub Actions (VITE_* → import.meta.env).
 *
 * ⚠️ HasiKasi is a public, client-only site: anything baked in here ships in the
 * JS bundle and is world-readable. Only expose values that are safe in public —
 * the Google OAuth *client id* (public by design) and the Twelve Data market key
 * (free, read-only prices; worst case someone burns your quota). NEVER the backup
 * PAT (it guards your financial-data repo, and GitHub auto-revokes public tokens).
 *
 * A value typed in Settings always wins; the build default is only a fallback so
 * fresh installs work without re-entering keys.
 */

const clean = (v?: string) => (v && v.trim() ? v.trim() : undefined)

export const ENV_GCAL_CLIENT_ID = clean(import.meta.env.VITE_GCAL_CLIENT_ID)
export const ENV_MARKET_KEY = clean(import.meta.env.VITE_MARKET_KEY)

/** Google OAuth client id: Settings value, else the build default. */
export function gcalClientId(s?: { gcalClientId?: string }): string | undefined {
  return clean(s?.gcalClientId) ?? ENV_GCAL_CLIENT_ID
}

/** Twelve Data market key: Settings value, else the build default. */
export function marketApiKey(s?: { marketApiKey?: string }): string | undefined {
  return clean(s?.marketApiKey) ?? ENV_MARKET_KEY
}
