import "server-only"

/**
 * Server-only config: secrets and server-side URLs, read in ONE place.
 *
 * The `server-only` import above makes any accidental import from a client
 * component a BUILD error — so these values (Pinata JWT, Privy secret, DB URL)
 * can never be bundled into the browser.
 *
 * Public `NEXT_PUBLIC_*` config lives in `env.ts`.
 */
export const serverEnv = {
  /** Indexer base URL for SERVER-side reads (server components, route handlers).
   *  In prod this is the Railway-internal URL; distinct from the client's
   *  NEXT_PUBLIC_INDEXER_URL, which must be publicly reachable. */
  indexerUrl: process.env.INDEXER_URL ?? "http://localhost:42069",
  /** Comments Postgres. Undefined => comments degrade to read-empty / 503. */
  databaseUrl: process.env.DATABASE_URL,
  /** Privy app secret — verifies the caller's auth token on /api routes. */
  privyAppSecret: process.env.PRIVY_APP_SECRET,
  /** Scoped (upload-only) Pinata JWT — pins coin art to IPFS. */
  pinataJwt: process.env.PINATA_JWT,
  /** Cloudflare R2 (S3-compatible) — stores mutable profile avatars. Any field
   *  missing => avatar uploads degrade to "unavailable". The public URL to serve
   *  them from is NEXT_PUBLIC_R2_PUBLIC_BASE (env.ts), a cookie-less host. */
  r2: {
    accountId: process.env.R2_ACCOUNT_ID,
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    bucket: process.env.R2_BUCKET,
  },
} as const
