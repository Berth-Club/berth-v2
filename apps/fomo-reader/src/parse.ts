/**
 * Reading FOMO's thesis feed, and the parameters nobody documents.
 *
 * The feed is paged with a WINDOW, `afterTime` and `beforeTime`, both in
 * MILLISECONDS. That is what FOMO's own token page sends, which is the only
 * evidence worth trusting here.
 *
 * Probing it alone is misleading. Sending `afterTime` by itself in
 * milliseconds returns an empty list with a non-zero `count`, which looks
 * exactly like a token nobody has written about; sending it alone in seconds
 * returns rows. That accident nearly became the implementation. Matching the
 * app's shape avoids reasoning about semantics we cannot see.
 *
 * `threshold` is the other undocumented one, and leaving it off is not the same
 * as sending zero. The app sends `threshold=1000` for its own tab, which hides
 * theses from people holding less than that. Omitted entirely, the feed answers
 * `count: 586, items: []`: a token that looks silent while 586 people wrote
 * about it. We send `threshold=0` because a payout list has to see everyone.
 *
 * `networkId` is FOMO's own chain number and not the EVM chain id. The Maple
 * token on Base is `4663` there, not `8453`, so it comes from the token list
 * rather than from anything we can derive.
 *
 * Paging walks `beforeTime` backwards: each page asks for theses older than the
 * oldest row of the last one, until the window is exhausted.
 *
 * Everything here is pure, so it is pinned by a check that needs no browser,
 * no session and no network.
 */

/** One thesis as the feed returns it. Only the fields we actually read. */
export interface ThesisItem {
  id?: string
  createdAt?: string
  userId?: string
  userHandle?: string
  displayName?: string
  tokenAddress?: string
  networkId?: number
  type?: string
  comment?: { comment?: string; numLikes?: number } | null
  /**
   * The author's own position in this token.
   *
   * `usdValue` is what it is worth and `closedAt` is when they got out, and the
   * second one matters most: 207 of 298 callout authors on a live token had
   * already sold. Note this is NOT the row's `threshold` field, which agreed
   * with `usdValue` on only 56 of those 298.
   */
  authorTrade?: { usdValue?: number; closedAt?: string | null } | null
}

/** A token to watch: FOMO's chain number plus the contract address. */
export interface TokenSpec {
  networkId: number
  /** Case preserved. Solana addresses are base58 and case-SENSITIVE. */
  tokenAddress: string
  /** The berth coin these callouts earn for. */
  coin: string
}

/** FOMO's own word for a callout. Anything else in the feed is not work. */
export const THESIS = "thesis"

export const FEED = "https://prod-api.fomo.family/feed/token/sortedThesis"
export const PAGE_SIZE = 500

/**
 * Build one page request.
 *
 * `cursorSeconds` is where to read back from; the first page uses now.
 */
export function pageUrl(
  token: TokenSpec,
  windowStartMs: number,
  beforeMs: number,
  limit = PAGE_SIZE
): string {
  // Whole milliseconds. A float is not rejected, it just returns nothing.
  const after = Math.floor(windowStartMs)
  const before = Math.floor(beforeMs)
  return (
    `${FEED}?tokenAddress=${encodeURIComponent(token.tokenAddress)}` +
    `&networkId=${token.networkId}&afterTime=${after}&beforeTime=${before}` +
    `&limit=${limit}&threshold=0`
  )
}

/**
 * The thesis list out of whatever envelope the feed used.
 *
 * The shape is not documented and is not ours, so this accepts the ones it
 * plausibly uses rather than assuming one and reading nothing in silence.
 * `null` means "I did not understand this", which the caller reports; an empty
 * array means "understood, and there were none". A token that quietly never
 * pays is the failure nobody notices, so those two must not collapse.
 */
export function parseItems(body: unknown): ThesisItem[] | null {
  if (!body || typeof body !== "object") return null
  const b = body as Record<string, unknown>

  const ro = b.responseObject
  if (Array.isArray(ro)) return ro as ThesisItem[]
  if (ro && typeof ro === "object") {
    for (const key of ["items", "theses", "results", "data"]) {
      const v = (ro as Record<string, unknown>)[key]
      if (Array.isArray(v)) return v as ThesisItem[]
    }
    return null
  }
  for (const key of ["items", "theses", "results", "data"]) {
    if (Array.isArray(b[key])) return b[key] as ThesisItem[]
  }
  return null
}

/**
 * The `beforeTime` for the next page, in milliseconds.
 *
 * One millisecond before the oldest row on this page, because the bound is
 * inclusive: reusing the same timestamp returns the same page forever. Null
 * when the page gives nothing to advance on, which stops the loop rather than
 * spinning it.
 */
export function nextCursor(items: readonly ThesisItem[]): number | null {
  let oldest = Infinity
  for (const it of items) {
    const t = timestampOf(it)
    if (t !== null && t < oldest) oldest = t
  }
  return Number.isFinite(oldest) ? Math.floor(oldest * 1000) - 1 : null
}

/** Epoch seconds for a thesis, or null when it has no usable date. */
export function timestampOf(item: ThesisItem): number | null {
  if (!item.createdAt) return null
  const ms = Date.parse(item.createdAt)
  return Number.isFinite(ms) ? ms / 1000 : null
}

/**
 * Has this page reached back past the point we care about?
 *
 * Compares the OLDEST row, not the newest: a page straddling the boundary still
 * contains rows we want, and stopping on the newest would drop them.
 */
export function reachedBack(items: readonly ThesisItem[], sinceMs: number): boolean {
  const c = nextCursor(items)
  return c === null || c <= sinceMs
}

export interface NormalisedThesis {
  externalId: string
  /** Likes at read time. A snapshot, so a settled week stays settled. */
  numLikes: number | null
  /** The author's position in USD, from `authorTrade.usdValue`. */
  positionUsd: number | null
  /** When the author sold, if they have. The strongest signal in the feed. */
  soldAt: Date | null
  /** The platform's immutable id. Never the handle: handles get renamed. */
  subject: string
  handle: string | null
  text: string
  createdAt: Date
  tokenAddress: string
  networkId: number | null
}

/**
 * One feed row as a thing worth storing, or null if it is not one.
 *
 * Dropped rather than stored: anything with no id, no author id, no date, or no
 * text. Each of those would become an item nobody can be paid for, and a
 * payout list is easier to trust when it never contains rows that cannot pay.
 */
export function normalise(item: ThesisItem): NormalisedThesis | null {
  // Only a thesis is work. Every row the feed returns today is one, checked
  // against 490 live rows on 2026-09-12, but `type` exists in the payload and a
  // feed that starts mixing in trades or replies would otherwise pay for them
  // silently. Checked here rather than downstream because this is the only place
  // that sees the field.
  if (item.type !== undefined && item.type !== THESIS) return null

  const externalId = String(item.id ?? "").trim()
  const subject = String(item.userId ?? "").trim()
  const text = String(item.comment?.comment ?? "").trim()
  const at = timestampOf(item)

  if (!externalId || !subject || !text || at === null) return null

  const likes = item.comment?.numLikes
  const usd = item.authorTrade?.usdValue
  const closed = item.authorTrade?.closedAt
  const soldMs = closed ? Date.parse(closed) : NaN

  return {
    externalId,
    numLikes: typeof likes === "number" && Number.isFinite(likes) ? likes : null,
    positionUsd: typeof usd === "number" && Number.isFinite(usd) ? usd : null,
    soldAt: Number.isFinite(soldMs) ? new Date(soldMs) : null,
    subject,
    handle: item.userHandle ? String(item.userHandle) : null,
    text,
    createdAt: new Date(at * 1000),
    tokenAddress: String(item.tokenAddress ?? ""),
    networkId: typeof item.networkId === "number" ? item.networkId : null,
  }
}
