import { hmFomoCallouts, makeDb } from "@workspace/db"
import type { NormalisedThesis, TokenSpec } from "./parse.js"

/**
 * Where a swept thesis lands.
 *
 * Its own table, NOT `hm_items`. The agent owns items and decides which week
 * each one belongs to from an epoch's frozen window; this process only knows
 * what it saw and when. Writing items directly would put a second writer on
 * the table the payout is computed from, and would mean a browser hiccup could
 * change a week that was already scored.
 *
 * So this is an archive, and the FOMO venue reads it the same way it would read
 * anyone else's. The separation is also what lets this run continuously while
 * weeks are opened and closed on a different schedule entirely.
 *
 * Written BEFORE any filter, always. These theses are not retrievable from the
 * feed later, so a question we have not thought of yet must still be answerable
 * from what we stored today.
 */

export function openStore(url: string | undefined) {
  return makeDb(url)
}

export type Store = NonNullable<ReturnType<typeof openStore>>

/**
 * Insert what is new. Returns how many rows were actually added.
 *
 * Conflicts do nothing rather than update. The feed can edit a thesis after the
 * fact, and the copy we scored a week on must not move underneath the score.
 */
export async function saveTheses(
  db: Store,
  theses: ReadonlyArray<NormalisedThesis & { coin: string }>
): Promise<number> {
  let stored = 0
  for (const t of theses) {
    const inserted = await db
      .insert(hmFomoCallouts)
      .values({
        externalId: t.externalId,
        coin: t.coin,
        subject: t.subject,
        handle: t.handle,
        text: t.text,
        tokenAddress: t.tokenAddress,
        networkId: t.networkId,
        numLikes: t.numLikes,
        // numeric() takes a string, so the value is not squeezed through a float
        // on the way in. A position is money and money is not a double.
        positionUsd: t.positionUsd === null ? null : String(t.positionUsd),
        soldAt: t.soldAt,
        createdAt: t.createdAt,
      })
      .onConflictDoNothing()
      .returning({ id: hmFomoCallouts.id })
    if (inserted.length > 0) stored++
  }
  return stored
}

/**
 * The tokens to watch, from berth.club.
 *
 * Fetched rather than configured, because a coin's tokens already live in its
 * rules and a second copy here would drift. The failure of a drifted copy is
 * silent: callouts simply stop being counted.
 *
 * Returns null, never an empty list, when the endpoint cannot be read. An empty
 * list means "watch nothing", which would stop archiving every coin at once.
 */
export async function fetchTokens(url: string): Promise<TokenSpec[] | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
    if (!res.ok) {
      console.warn(`[warn] tokens endpoint returned ${res.status}`)
      return null
    }
    const body = (await res.json()) as { tokens?: unknown }
    if (!Array.isArray(body.tokens)) {
      console.warn("[warn] tokens endpoint returned no list")
      return null
    }
    const out: TokenSpec[] = []
    for (const raw of body.tokens) {
      const t = raw as Record<string, unknown>
      const networkId = Number(t.networkId)
      // Case preserved: Solana addresses are base58 and case-sensitive, so
      // normalising one here would produce a different, invalid address.
      const tokenAddress = String(t.tokenAddress ?? "").trim()
      const coin = String(t.coin ?? "").trim()
      if (!Number.isInteger(networkId) || networkId <= 0 || !tokenAddress || !coin) continue
      out.push({ networkId, tokenAddress, coin })
    }
    return out
  } catch (e) {
    console.warn(`[warn] tokens endpoint: ${(e as Error).message}`)
    return null
  }
}
