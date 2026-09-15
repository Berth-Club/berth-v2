import { hmFomoCallouts, hmFomoUsers } from "@workspace/db"
import { and, asc, gte, inArray, lt, sql } from "drizzle-orm"

import type { VenueItem, VenueResult, ReaderContext } from "./types.js"

/**
 * Callouts on FOMO, read from the archive this repo's reader fills.
 *
 * FOMO has no public API. Its backend sits behind Cloudflare and a short-lived
 * Privy token held in localStorage, so a plain HTTP client gets 403 whatever
 * headers it sends. `apps/fomo-reader` solves that by driving a logged-in
 * browser and borrowing the app's own Authorization header, and it archives
 * every thesis it sees before any filter runs.
 *
 * So this venue does not talk to FOMO at all. It reads that archive, in the
 * same database, which means the payout path never depends on a browser
 * session being alive at the moment a week closes. An archive also keeps
 * theses the feed will not return again.
 */

/**
 * Most callouts one author can be paid for in a week.
 *
 * A callout costs nothing to post, unlike a pull request that a maintainer had
 * to merge. Without a cap, the cheapest way to earn is to post fifty times.
 */
const MAX_PER_AUTHOR = 5

export interface FomoReaderOptions {
  /** The agent's own database handle. Same one the rest of the week uses. */
  db?: VenueDb
  /** Injected in checks so the venue runs without a database. */
  query?: FomoQuery
}

/** Just enough of the drizzle handle to run one select. */
export type VenueDb = {
  select: (fields: Record<string, unknown>) => {
    from: (t: unknown) => {
      where: (w: unknown) => { orderBy: (o: unknown) => Promise<FomoRow[]> }
    }
  }
}

export interface FomoRow {
  event_id: string
  created_at: Date | null
  username: string | null
  subject: string | null
  text: string | null
  token_address: string | null
  network_id: string | number | null
  /** The custodial wallet FOMO holds for this author, if the reader has asked yet. */
  evm_address: string | null
  /** Likes at read time. The only engagement number this feed populates. */
  num_likes: number | null
  /** The author's position in USD. numeric() comes back as a string. */
  position_usd: string | null
  /** When the author sold, if they have. Null means they still hold. */
  sold_at: Date | null
}

export type FomoQuery = (args: {
  tokens: readonly string[]
  coin: string
  start: Date
  end: Date
}) => Promise<FomoRow[]>

/**
 * Read the archive this repo's reader fills.
 *
 * Scoped to the coin as well as the window: two coins can name the same token,
 * and a callout earns for the coin whose rules named it.
 */
function makeQuery(db: VenueDb): FomoQuery {
  return async ({ coin, start, end }) =>
    (await (db as never as {
      select: (f: unknown) => never
    }).select({
      event_id: hmFomoCallouts.externalId,
      created_at: hmFomoCallouts.createdAt,
      username: hmFomoCallouts.handle,
      subject: hmFomoCallouts.subject,
      text: hmFomoCallouts.text,
      token_address: hmFomoCallouts.tokenAddress,
      network_id: hmFomoCallouts.networkId,
      num_likes: hmFomoCallouts.numLikes,
      position_usd: hmFomoCallouts.positionUsd,
      sold_at: hmFomoCallouts.soldAt,
      // A subquery rather than a join, so a missing wallet leaves the callout on
      // the record with nothing to pay instead of dropping it from the week. An
      // author the reader has not looked up yet is a payment pending, not a
      // contribution that did not happen.
      //
      // The outer column is qualified by hand. Drizzle prints columns in a
      // select list unqualified, so both sides rendered as "subject", matched
      // every user, and epoch 35's read failed with "more than one row".
      evm_address: sql<
        string | null
      >`(select ${hmFomoUsers.evmAddress} from ${hmFomoUsers} where ${hmFomoUsers.subject} = ${hmFomoCallouts}.${sql.identifier("subject")})`,
    } as never) as never as {
      from: (t: unknown) => {
        where: (w: unknown) => { orderBy: (o: unknown) => Promise<FomoRow[]> }
      }
    })
      .from(hmFomoCallouts)
      .where(
        and(
          inArray(hmFomoCallouts.coin, [coin]),
          gte(hmFomoCallouts.createdAt, start),
          lt(hmFomoCallouts.createdAt, end)
        )
      )
      .orderBy(asc(hmFomoCallouts.createdAt))
}

export function makeFomoReader(opts: FomoReaderOptions = {}) {
  const query = opts.query ?? (opts.db ? makeQuery(opts.db) : null)

  return async function readFomo(ctx: ReaderContext): Promise<VenueResult> {
    const sources = ctx.sources.fomo ?? []
    if (sources.length === 0) {
      return { status: "ok", items: [], reason: "no FOMO tokens in this coin's rules" }
    }
    if (!query) {
      // Degrade the venue, never the week. An unconfigured archive is an
      // operator problem, and the record says so instead of showing a coin
      // whose callouts silently stopped counting.
      return {
        status: "failed",
        items: [],
        reason: "the FOMO archive is not readable",
      }
    }

    // Lowercased on BOTH sides, here and in the SQL. That is safe even for
    // Solana's case-sensitive base58, because this value is only ever compared
    // against a column that is lowercased the same way; it is never used to
    // build a URL. The endpoint that hands addresses to the callout bot must
    // NOT do this, and does not.
    const tokens = sources.map((s) => s.tokenAddress.toLowerCase())

    let rows: FomoRow[]
    try {
      rows = await query({ tokens, coin: ctx.coin, start: ctx.window.start, end: ctx.window.end })
    } catch (error) {
      const message = (error as Error).message
      // A column that vanished from the other service's schema is the failure
      // worth naming, because the fix is a conversation, not a retry.
      return {
        status: "failed",
        items: [],
        reason: /column .* does not exist/i.test(message)
          ? `the callout archive's schema changed: ${message}`
          : `cannot read the callout archive: ${message}`,
      }
    }

    const items: VenueItem[] = []
    const perAuthor = new Map<string, number>()
    const partials: string[] = []
    let skippedNoAuthor = 0
    let cappedAuthors = 0

    for (const row of rows) {
      // Keyed on the immutable id, never the handle. A handle can be renamed
      // onto someone else, and a payout that followed the name would pay a
      // stranger for this person's work.
      if (!row.subject) {
        skippedNoAuthor++
        continue
      }
      if (!row.created_at) continue
      if (!row.text || row.text.trim().length === 0) continue

      const seen = perAuthor.get(row.subject) ?? 0
      if (seen >= MAX_PER_AUTHOR) {
        cappedAuthors++
        continue
      }
      perAuthor.set(row.subject, seen + 1)

      items.push({
        platform: "fomo",
        platformUserId: row.subject,
        platformHandle: row.username ?? undefined,
        externalId: row.event_id,
        link: row.username ? `https://fomo.family/profile/${row.username}` : undefined,
        // Raw on purpose: hygiene runs once, in the venue job, so the rule
        // "nothing author-written is stored uncleaned" holds for every venue.
        content: row.text,
        // Straight from FOMO, unvalidated here on purpose: the binding job owns
        // the address gate, and one gate is easier to trust than two.
        platformWallet: row.evm_address ?? undefined,
        createdAt: row.created_at,
        // The numbers the scorer needs and the text does not carry. Likes are a
        // snapshot at read time, so a settled week stays settled.
        meta: {
          tokenAddress: row.token_address,
          networkId: row.network_id,
          numLikes: row.num_likes,
          positionUsd: row.position_usd === null ? null : Number(row.position_usd),
          soldAt: row.sold_at ? row.sold_at.toISOString() : null,
        },
      })

      if (items.length >= ctx.cap) {
        partials.push(`stopped at the ${ctx.cap} item cap`)
        break
      }
    }

    if (skippedNoAuthor > 0) {
      // Worth reporting rather than swallowing: an archive full of rows with
      // no author id means the bot's session was anonymous, and its feed
      // returns unnamed aggregates until the account follows people.
      partials.push(`${skippedNoAuthor} callout(s) had no author id and were skipped`)
    }
    if (cappedAuthors > 0) {
      partials.push(`${cappedAuthors} callout(s) over the ${MAX_PER_AUTHOR} per author cap`)
    }

    return partials.length > 0
      ? { status: "partial", items, reason: partials.join("; ") }
      : { status: "ok", items }
  }
}
