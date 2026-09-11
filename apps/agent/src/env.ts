import { CHAIN } from "@workspace/contracts"

/**
 * Everything this process is allowed to read from the environment.
 *
 * Two rules, both load-bearing.
 *
 * The keeper key and the connector credentials live HERE and nowhere else. The
 * web app is internet-facing; this process has no public address. Putting the
 * payout key in one and not the other is most of what bounds the damage when
 * something is compromised.
 *
 * A missing secret degrades the handler that needs it, it does not stop the
 * boot. The worker runs many jobs; a missing GitHub token should fail the GitHub
 * reader and leave the epoch clock alone. That rule is in ARCHITECTURE.md.
 */

function required(name: string): string | undefined {
  const v = process.env[name]
  return v && v.length > 0 ? v : undefined
}

export const env = {
  databaseUrl: required("DATABASE_URL"),

  /** Signs the payout list. Sealed on Railway; never present in the web app. */
  keeperPrivateKey: required("KEEPER_PRIVATE_KEY"),

  anthropicApiKey: required("ANTHROPIC_API_KEY"),
  /** Fine-grained, read-only. Public repo reads need no write scope. */
  githubToken: required("GITHUB_TOKEN"),
  fomoApiKey: required("FOMO_API_KEY"),

  rpcUrl: required("RPC_URL") ?? CHAIN.defaultRpc,
  /** Failed over to when the public endpoint rate-limits. Key is in the path. */
  rpcUrlPaid: required("RPC_URL_PAID"),
  indexerUrl: required("INDEXER_URL"),

  chainId: Number(process.env.CHAIN_ID ?? CHAIN.id),
  nodeEnv: process.env.NODE_ENV ?? "development",

  /** Identifies this process in `hm_jobs.locked_by`. */
  workerId: process.env.RAILWAY_REPLICA_ID ?? `local-${process.pid}`,
  pollSeconds: Number(process.env.HM_POLL_SECONDS ?? 30),
} as const

/** Which features are usable, for logging at boot and for handlers to check. */
export function capabilities() {
  return {
    database: Boolean(env.databaseUrl),
    scoring: Boolean(env.anthropicApiKey),
    github: Boolean(env.githubToken),
    fomo: Boolean(env.fomoApiKey),
    payouts: Boolean(env.keeperPrivateKey),
    indexer: Boolean(env.indexerUrl),
  }
}
