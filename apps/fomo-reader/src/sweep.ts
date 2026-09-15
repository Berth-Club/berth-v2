import type { Driver } from "./driver.js"
import {
  nextCursor,
  normalise,
  pageUrl,
  parseItems,
  reachedBack,
  type NormalisedThesis,
  type TokenSpec,
} from "./parse.js"

/**
 * One pass over the tokens we watch.
 *
 * Reads back from now until the feed predates the window, per token, and hands
 * back what it found plus a note for anything that went wrong. Notes are the
 * point as much as the theses: a token that silently stops returning rows looks
 * exactly like a token nobody writes about, and the difference is a coin that
 * quietly pays nobody.
 */

/** Pages per token per sweep. A busy token must not hold the loop for minutes. */
const MAX_PAGES = Number(process.env.FOMO_MAX_PAGES ?? 10)

export interface SweepResult {
  theses: Array<NormalisedThesis & { coin: string }>
  notes: string[]
}

export async function sweepToken(
  driver: Driver,
  token: TokenSpec,
  sinceMs: number
): Promise<SweepResult> {
  const theses: Array<NormalisedThesis & { coin: string }> = []
  const notes: string[] = []
  const label = `${token.networkId}:${token.tokenAddress.slice(0, 8)}…`

  // Walk `beforeTime` backwards from now; `afterTime` stays at the window
  // start, matching the shape the app itself sends.
  let before = Date.now()

  for (let i = 0; i < MAX_PAGES; i++) {
    const res = await driver.apiGet(pageUrl(token, sinceMs, before))

    if (!res.ok) {
      // Keep what arrived. A rate limit on page four should not discard the
      // three that worked.
      notes.push(`${label}: ${res.status}`)
      break
    }

    const items = parseItems(res.body)
    if (items === null) {
      // Reached the feed and understood none of it. Said out loud, because the
      // alternative is a token that never pays and never complains.
      const keys = Object.keys((res.body as object) ?? {}).slice(0, 6)
      notes.push(`${label}: unrecognised response shape, keys=${keys.join(",")}`)
      break
    }
    if (items.length === 0) break

    for (const raw of items) {
      const t = normalise(raw)
      if (!t) continue
      // The window is applied here, not by the feed: the cursor pages
      // backwards past the boundary, so the last page always overshoots.
      if (t.createdAt.getTime() < sinceMs) continue
      theses.push({ ...t, coin: token.coin })
    }

    if (reachedBack(items, sinceMs)) break
    const next = nextCursor(items)
    if (next === null) break
    before = next

    if (i === MAX_PAGES - 1) {
      notes.push(`${label}: stopped at the ${MAX_PAGES} page limit, more history remains`)
    }
  }

  return { theses, notes }
}

export async function sweepAll(
  driver: Driver,
  tokens: readonly TokenSpec[],
  sinceMs: number
): Promise<SweepResult> {
  const all: SweepResult = { theses: [], notes: [] }
  for (const token of tokens) {
    const r = await sweepToken(driver, token, sinceMs)
    all.theses.push(...r.theses)
    all.notes.push(...r.notes)
  }
  return all
}
