/**
 * Public runtime config — the single place the app reads `NEXT_PUBLIC_*` vars.
 *
 * These are inlined into the client bundle at BUILD time, so the
 * `process.env.NEXT_PUBLIC_*` references below must stay literal (don't refactor
 * them into a loop or a dynamic lookup — Next only inlines literal reads).
 *
 * Safe to import from client OR server code. Secrets and server-only URLs live
 * in `server-env.ts`, which is `server-only`.
 */
import { CHAIN } from "@workspace/contracts"

export const env = {
  /** Privy app id — wallet connect + auth. Empty string disables wallet UI. */
  privyAppId: process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "",
  /** Indexer base URL for CLIENT-side reads (the browser hits this directly). */
  indexerUrl: process.env.NEXT_PUBLIC_INDEXER_URL ?? "http://localhost:42069",
  /** Arc RPC for client-side wallet/tx. */
  rpcUrl: process.env.NEXT_PUBLIC_RPC_URL ?? CHAIN.defaultRpc,
  /** IPFS gateway host that renders uploaded coin art (trailing slash trimmed). */
  ipfsGateway: (process.env.NEXT_PUBLIC_IPFS_GATEWAY || "https://gateway.pinata.cloud").replace(/\/+$/, ""),
  /** Canonical site origin for OpenGraph / canonical URLs. */
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
  /** Public base URL that serves R2 avatars (trailing slash trimmed). MUST be a
   *  cookie-less host (r2.dev or a dedicated subdomain, never the app origin) so
   *  a served image can't run as same-origin script. Empty => avatars off. */
  r2PublicBase: (process.env.NEXT_PUBLIC_R2_PUBLIC_BASE || "").replace(/\/+$/, ""),
} as const

/** Whether wallet features can work at all (Privy configured). */
export const WALLET_ENABLED = env.privyAppId !== "" && env.privyAppId !== "your-privy-app-id"
