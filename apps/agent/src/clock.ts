import { HM_EPOCH_SECONDS, HM_GENESIS } from "@workspace/contracts"

/**
 * The only place in this codebase that decides what week it is.
 *
 * The vault computes the same index from `block.timestamp` using the same two
 * constants, so if this file and the contract ever disagree the agent posts a
 * root for an epoch the vault thinks is still open and the revert is the first
 * anyone hears of it. Both sides read `HM_GENESIS` and `HM_EPOCH_SECONDS` from
 * `@workspace/contracts`; neither redefines them.
 *
 * Epochs are half-open: `[start, end)`. An item stamped exactly at `start`
 * belongs to this epoch; one stamped exactly at `end` belongs to the next. That
 * is what stops a single merge landing on two weeks' lists.
 */

/** Epoch length in seconds. Overridable ONLY for tests; see `assertClockSafe`. */
function epochSeconds(): number {
  const raw = process.env.HM_EPOCH_SECONDS_OVERRIDE
  if (!raw) return HM_EPOCH_SECONDS
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`HM_EPOCH_SECONDS_OVERRIDE must be a positive integer, got ${raw}`)
  }
  return n
}

/**
 * Refuses to run a compressed clock anywhere real.
 *
 * A shortened epoch is how the state machine gets tested in seconds instead of
 * weeks. Left set in production it would index, split and pay on a clock the
 * vault does not share, so this throws at boot rather than letting the process
 * start and be wrong.
 */
export function assertClockSafe(env: { chainId?: number; nodeEnv?: string } = {}): void {
  if (!process.env.HM_EPOCH_SECONDS_OVERRIDE) return
  const nodeEnv = env.nodeEnv ?? process.env.NODE_ENV
  const chainId = env.chainId ?? Number(process.env.CHAIN_ID ?? 0)
  const isProd = nodeEnv === "production"
  const isMainnet = chainId === 5042 || chainId === 5042002
  if (isProd || isMainnet) {
    throw new Error(
      "HM_EPOCH_SECONDS_OVERRIDE is set outside a test environment. " +
        "A compressed epoch clock would disagree with the vault. Unset it."
    )
  }
}

/** Seconds since the Unix epoch. */
export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

/** Which epoch a moment falls in. Negative before genesis, which callers reject. */
export function epochIndex(atSeconds: number = nowSeconds()): number {
  return Math.floor((atSeconds - HM_GENESIS) / epochSeconds())
}

/** The half-open window `[start, end)` of an epoch, as Dates. */
export function epochBounds(index: number): { start: Date; end: Date } {
  const len = epochSeconds()
  const start = HM_GENESIS + index * len
  return { start: new Date(start * 1000), end: new Date((start + len) * 1000) }
}

/** When the given epoch closes. What `epoch_start` for the next one waits on. */
export function epochEnd(index: number): Date {
  return epochBounds(index).end
}

/** The epoch that is currently open. */
export function currentEpoch(): number {
  return epochIndex()
}

/**
 * The most recent epoch that has fully closed, or null if none has.
 *
 * Reading a week's work is only correct once that week is over, so every reader
 * is scheduled against this rather than against `currentEpoch`.
 */
export function lastClosedEpoch(atSeconds: number = nowSeconds()): number | null {
  const i = epochIndex(atSeconds) - 1
  return i < 0 ? null : i
}
