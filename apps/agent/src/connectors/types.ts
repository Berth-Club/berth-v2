/**
 * The shape every lane produces, whatever it read.
 *
 * Fixed here, in the first lane, because the other three implement it later and
 * the scorer must not care which venue an item came from. The fields are the
 * minimum that makes an item scoreable and attributable: who, what, where, when.
 *
 * `platformUserId` is the platform's IMMUTABLE id, never a handle. GitHub frees
 * a username the moment an account renames or is deleted, so a handle-keyed item
 * would let whoever claims that name inherit the payout. The handle is carried
 * alongside for display only, and nothing ever joins on it.
 */
export interface LaneItem {
  /** Matches `hm_items.platform`: `github` | `fomo`. */
  platform: string
  platformUserId: string
  platformHandle?: string
  /** The platform's id for the item itself, unique within the lane. */
  externalId: string
  link?: string
  /** Author-written text. Attacker-controlled; hygiene runs before it is stored. */
  content?: string
  /** When the work counted as done: a merge time, a post time. */
  createdAt: Date
  /** True for work still in flight. Stored and shown, never scored. */
  open?: boolean
  /** Anything the scorer's prompt uses that does not fit above. */
  meta?: Record<string, unknown>
}

/**
 * What a reader reports back, which is as important as the items.
 *
 * A lane that could not be read must never look like a quiet week: an empty
 * list and a failed read are the same rows but opposite meanings, and publishing
 * the first when the truth was the second pays nobody and tells no one. So
 * `status` is part of the result, not an exception, and `partial` exists for the
 * common case of a rate limit halfway through.
 */
export type LaneStatus = "ok" | "partial" | "failed"

export interface LaneResult {
  status: LaneStatus
  items: LaneItem[]
  /** Required for partial and failed. Printed on the public list. */
  reason?: string
}

export interface LaneWindow {
  /** Inclusive. Widened for a coin's first epoch, to honour a lookback date. */
  start: Date
  /** Exclusive, so one item lands on exactly one week. */
  end: Date
}

/** What a coin's rules named for this lane, already resolved to ids. */
export interface LaneSources {
  /** GitHub repository ids. Numeric and stable across renames and transfers. */
  github?: Array<{ repoId: number; name?: string }>
  /**
   * Tokens whose FOMO callouts count.
   *
   * The plan assumed a page id. FOMO's archive is keyed on the token's own
   * contract address and the chain it lives on, because a callout is written
   * about a token rather than posted to a page. `networkId` is FOMO's own
   * chain number, kept so an address that exists on two chains cannot be
   * confused for one.
   */
  fomo?: Array<{ tokenAddress: string; networkId?: number; name?: string }>
}

export interface ReaderContext {
  window: LaneWindow
  sources: LaneSources
  /** Stop paging once this many items are held, and report `partial`. */
  cap: number
  /**
   * Also return work still in flight, marked `open`.
   *
   * Off by default, because everything downstream treats an item as something
   * that happened. Open work is read so the record can show a contributor they
   * were noticed; it is never scored and never paid.
   */
  includeOpen?: boolean
  signal?: AbortSignal
}

export type LaneReader = (ctx: ReaderContext) => Promise<LaneResult>
