/**
 * Single source of truth for berth.club's on-chain deployment on Arc.
 *
 * Both apps/web and apps/indexer import from here, so the frontend and the
 * indexer can never point at different factories. They diverged exactly once —
 * a stale NEXT_PUBLIC_LAUNCH_FACTORY in the web env while the indexer already
 * watched a newer factory — and launches landed on a contract nothing indexed.
 *
 * Hard-coded on purpose: a redeploy is a one-line edit here + a version bump,
 * NOT an env change that can land on one side and not the other. If you ever
 * do want per-environment overrides, add them in ONE place (a resolver in this
 * package), never in a single app's env.
 */

/** Arc testnet. */
export const CHAIN_ID = 5042002 as const

/** Block the current LaunchFactory was deployed in — the indexer's backfill start. */
export const START_BLOCK = 53500852 as const

/** v1.4 deployment — github.com/Arcane-build/arc-launchpad. */
export const CONTRACTS = {
  launchFactory: "0x82A613C19787D88d648C04F8Ad7Bd6825193e317",
  lpLocker: "0xA592aDF3Cb55741619d09E50E6502f40F3883cc9",
  feeLocker: "0xC3a15f812901205Fc4406Cd0dC08Fe266bF45a1E",
} as const satisfies Record<string, `0x${string}`>
