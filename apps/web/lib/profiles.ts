import "server-only"

import { eq, inArray } from "drizzle-orm"
import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"

import { userProfiles } from "@/lib/db/schema"
import { serverEnv } from "@/lib/server-env"

/**
 * Editable user profiles, on the same Railway Postgres the indexer uses — the
 * exact pattern as `lib/comments.ts` (own table in the default schema, never a
 * join against Ponder's namespaced tables). The table is created by
 * `pnpm --filter web db:migrate`, never at runtime.
 *
 * Keyed by the LOWERCASED wallet address so every render surface can batch a
 * `wallet -> profile` lookup. Missing DATABASE_URL => reads degrade to
 * empty/null and writes no-op, rather than crashing a page.
 */

const URL = serverEnv.databaseUrl

let cached: ReturnType<typeof drizzle<{ userProfiles: typeof userProfiles }>> | null = null

function db() {
  if (!URL) return null
  if (!cached) {
    const client = postgres(URL, { max: 3, idle_timeout: 20, connect_timeout: 10 })
    cached = drizzle(client, { schema: { userProfiles } })
  }
  return cached
}

export type Profile = {
  /** Lowercased wallet address. */
  wallet: string
  name: string | null
  bio: string | null
  /** Single http(s) URL. */
  social: string | null
  /** Avatar as `ipfs://CID`, or null. */
  image: string | null
}

/** true when a DB is configured — writes return 503 otherwise. */
export const PROFILES_ENABLED = !!URL

type Row = typeof userProfiles.$inferSelect
const toProfile = (r: Row): Profile => ({
  wallet: r.wallet,
  name: r.name,
  bio: r.bio,
  social: r.social,
  image: r.image,
})

/** One wallet's profile, or null when unset / DB unreachable. */
export async function getProfile(wallet: string): Promise<Profile | null> {
  const d = db()
  if (!d) return null
  try {
    const [row] = await d
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.wallet, wallet.toLowerCase()))
      .limit(1)
    return row ? toProfile(row) : null
  } catch (err) {
    console.error("getProfile failed", err)
    return null
  }
}

/**
 * Batch lookup for a render surface: `wallet(lowercased) -> Profile`, only for
 * wallets that have a profile. Empty map on empty input or DB failure — callers
 * fall back to the derived identity per address.
 */
export async function getProfiles(wallets: string[]): Promise<Map<string, Profile>> {
  const out = new Map<string, Profile>()
  const d = db()
  const keys = [...new Set(wallets.map((w) => w.toLowerCase()))]
  if (!d || keys.length === 0) return out
  try {
    const rows = await d.select().from(userProfiles).where(inArray(userProfiles.wallet, keys))
    for (const r of rows) out.set(r.wallet, toProfile(r))
  } catch (err) {
    console.error("getProfiles failed", err)
  }
  return out
}

/**
 * Create or fully replace a wallet's profile. Caller has already authenticated
 * as `wallet` and validated the fields. A full replace (not a partial patch):
 * the edit form always submits every field, so an omitted field means "cleared".
 */
export async function upsertProfile(
  wallet: string,
  data: { name: string | null; bio: string | null; social: string | null; image: string | null }
): Promise<Profile | null> {
  const d = db()
  if (!d) return null
  const w = wallet.toLowerCase()
  const set = {
    name: data.name ?? null,
    bio: data.bio ?? null,
    social: data.social ?? null,
    image: data.image ?? null,
    updatedAt: new Date(),
  }
  const [row] = await d
    .insert(userProfiles)
    .values({ wallet: w, ...set })
    .onConflictDoUpdate({ target: userProfiles.wallet, set })
    .returning()
  return row ? toProfile(row) : null
}
