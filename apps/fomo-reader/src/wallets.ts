import { and, eq, isNull, sql } from "drizzle-orm"
import { hmFomoUsers } from "@workspace/db"

import type { Driver } from "./driver.js"
import type { Store } from "./store.js"

/**
 * The wallet FOMO already holds for a callout author.
 *
 * This is what makes paying a FOMO contributor possible at all. On GitHub the
 * author writes an address into the pull request; a market callout is four words
 * long and nobody is going to paste forty-two hex characters into one. But FOMO
 * gives every account a custodial wallet and returns it for any user id, so the
 * address is already there to be read.
 *
 * Verified on 2026-09-12 against four strangers picked out of a live feed: all
 * four returned an EVM address and a Solana address, 200 each, no special
 * permission. So this needs no cooperation from FOMO's team and nothing at all
 * from the contributor.
 *
 * What this file deliberately does NOT do is decide who gets paid. It records
 * what FOMO said and stops. The agent reads the record, applies its own address
 * rules, and remains the only writer of `hm_bindings`. A browser talking to
 * somebody else's API should not be one step away from moving money.
 */

const USERS = "https://prod-api.fomo.family/v2/users"

/**
 * Look a user up by ID, not by handle.
 *
 * Both endpoints work and return the same record. The id form is the right one
 * because a handle is rented: FOMO lets people rename, and a binding keyed on a
 * name someone can change is a binding someone else can inherit.
 */
export function userUrl(subject: string): string {
  return `${USERS}/${encodeURIComponent(subject)}`
}

/**
 * Look a user up by HANDLE, lowercased.
 *
 * For when a person types a name: an operator adding someone, or a contributor
 * telling us who they are. Never for the sweep, which already has ids.
 *
 * Lowercased because that is how FOMO stores a handle. Asked for `Wiredhikari`
 * it answers with `userHandle: "wiredhikari"`, so lowercase is the canonical
 * spelling and searching in it is the form that matches on the first try
 * whatever someone typed.
 *
 * This does NOT extend to the other identifiers. A user id is compared exactly,
 * with no case folding, and a Solana token address must keep its case because
 * base58 is case-sensitive and lowercasing one produces a different, invalid
 * address. Handles are the only thing here that is safe to fold.
 *
 * Whatever comes back, use the `id` from the record and not the handle. The
 * handle got us to the account; only the id identifies it afterwards.
 */
export function handleUrl(handle: string): string {
  return `${USERS}/userHandle/${encodeURIComponent(handle.trim().toLowerCase())}`
}

export interface FomoWallets {
  /** Whose record this is, as FOMO reported it. Checked, never assumed. */
  id: string
  handle: string | null
  evmAddress: string | null
  solAddress: string | null
}

/**
 * The addresses out of the user envelope, for the user we ASKED for.
 *
 * `expectId` is not optional politeness, it is the whole point. FOMO's handle
 * lookup is not exact: asking for `Wiredhikari` returns the account whose handle
 * is `wiredhikari`. So the identifier in the reply can differ from the one in the
 * request, and a lookup that trusted the reply would write a stranger's wallet
 * against our author. Matched on the FULL id, character for character, with no
 * case folding and no prefix comparison.
 *
 * Null means "do not use this", which the caller reports and retries, rather
 * than storing a wrong answer permanently.
 */
export function parseWallets(body: unknown, expectId?: string): FomoWallets | null {
  if (!body || typeof body !== "object") return null
  const ro = (body as Record<string, unknown>).responseObject
  if (!ro || typeof ro !== "object") return null
  const u = ro as Record<string, unknown>

  // An id is the marker of a real user record. Without it this is some other
  // envelope that happened to parse, and guessing would store nonsense.
  if (typeof u.id !== "string" || u.id.length === 0) return null

  // The full string, exactly. Not a prefix, not case-insensitive.
  if (expectId !== undefined && u.id !== expectId) return null

  const evmRaw = typeof u.evmAddress === "string" ? u.evmAddress.trim() : ""
  const solRaw = typeof u.address === "string" ? u.address.trim() : ""

  return {
    id: u.id,
    handle: typeof u.userHandle === "string" && u.userHandle ? u.userHandle : null,
    // Lowercased. EVM hex is case-insensitive and the mixed-case form is only a
    // checksum, so one canonical spelling avoids a second row for the same wallet.
    evmAddress: evmRaw ? evmRaw.toLowerCase() : null,
    // Case PRESERVED. Solana base58 is case-sensitive; lowercasing one produces
    // a different, invalid address.
    solAddress: solRaw || null,
  }
}

/** Authors we have never asked FOMO about. */
export async function unresolvedSubjects(db: Store, limit: number): Promise<string[]> {
  const rows = await db
    .select({ subject: hmFomoUsers.subject })
    .from(hmFomoUsers)
    .where(isNull(hmFomoUsers.resolvedAt))
    .limit(limit)
  return rows.map((r) => r.subject)
}

/**
 * Note every author of these callouts, so their wallet gets looked up later.
 *
 * Separate from the lookup itself on purpose. A sweep that finds ninety new
 * authors should still store its ninety callouts promptly rather than spend
 * ninety round trips first, and an author noted now is looked up on the next
 * pass at the latest.
 */
export async function noteSubjects(
  db: Store,
  people: ReadonlyArray<{ subject: string; handle: string | null }>
): Promise<void> {
  // One row per distinct author. The same person writes many callouts a day.
  const seen = new Map<string, string | null>()
  for (const p of people) if (!seen.has(p.subject)) seen.set(p.subject, p.handle)
  if (seen.size === 0) return

  await db
    .insert(hmFomoUsers)
    .values([...seen].map(([subject, handle]) => ({ subject, handle })))
    .onConflictDoNothing()
}

export interface ResolveResult {
  resolved: number
  withWallet: number
  /** True when FOMO asked us to slow down. The caller should not retry this pass. */
  rateLimited: boolean
  notes: string[]
}

/**
 * How many authors to look up per sweep, and how far apart.
 *
 * Measured against the real endpoint on 2026-09-12: the seventh request in a row
 * returns 429 with `retry-after: 60`, and spacing them 1.5s apart changes
 * nothing. The limit counts requests rather than measuring a rate, so the only
 * thing that helps is asking for fewer.
 *
 * Four leaves room for the feed pages in the same sweep, which share the same
 * Cloudflare budget. At a sweep every five minutes that is about fifty authors
 * an hour, so the two hundred already in the archive clear overnight and steady
 * state is nowhere near the ceiling. Nothing waits on this inside a week: a
 * callout scored on Monday is paid when the week closes on Sunday.
 */
const BATCH = Number(process.env.FOMO_WALLET_BATCH ?? 4)
const SPACING_MS = Number(process.env.FOMO_WALLET_SPACING_MS ?? 1000)

/**
 * Ask FOMO for the wallets of authors we have not asked about yet.
 *
 * `resolved_at` is stamped even when there is no address, because "asked, and
 * FOMO has nothing" has to be distinguishable from "never asked". Collapsing
 * those two means retrying the same empty account forever while a real backlog
 * sits behind it.
 *
 * A failed request is left unresolved so the next sweep retries it. That is the
 * right way round: a row wrongly marked resolved is a person who never gets
 * paid and never finds out why.
 */
export async function resolveWallets(
  db: Store,
  driver: Driver,
  limit = BATCH,
  spacingMs = SPACING_MS
): Promise<ResolveResult> {
  const subjects = await unresolvedSubjects(db, limit)
  const out: ResolveResult = { resolved: 0, withWallet: 0, rateLimited: false, notes: [] }
  if (subjects.length === 0) return out

  // One trip into the page for the whole batch, paced inside it. The results
  // come back in order and can be SHORTER than the request list, because a 429
  // stops the batch rather than burning the rest of it.
  const results = await driver.apiGetMany(
    subjects.map(userUrl),
    spacingMs
  )

  for (let i = 0; i < results.length; i++) {
    const subject = subjects[i]!
    const res = results[i]!

    if (!res.ok) {
      if (res.status === 429) {
        out.rateLimited = true
        const after = res.retryAfterSeconds
        out.notes.push(
          `rate limited after ${out.resolved} of ${subjects.length}` +
            (after ? `, retry-after ${after}s` : "")
        )
        break
      }
      out.notes.push(`${subject}: ${res.status}`)
      continue
    }

    const wallets = parseWallets(res.body, subject)
    if (wallets === null) {
      // Either FOMO returned something we do not understand, or it returned a
      // DIFFERENT user than the one asked for. Both mean do not store, and the
      // note carries the full id because a truncated one cannot be looked up.
      out.notes.push(`${subject}: not the user asked for, or unrecognised shape`)
      continue
    }

    await db
      .update(hmFomoUsers)
      .set({
        // FOMO's spelling of the handle, not ours. Display only; nothing joins
        // on it, because a handle can be renamed onto someone else.
        handle: wallets.handle,
        evmAddress: wallets.evmAddress,
        solAddress: wallets.solAddress,
        resolvedAt: sql`now()`,
        note: wallets.evmAddress ? null : "fomo returned no evm address",
      })
      .where(and(isNull(hmFomoUsers.resolvedAt), eq(hmFomoUsers.subject, subject)))

    out.resolved++
    if (wallets.evmAddress) out.withWallet++
  }

  return out
}
