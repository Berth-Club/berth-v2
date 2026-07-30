/**
 * Self-check for the Drizzle profile layer. No test framework — just asserts.
 *
 *   DATABASE_URL=postgres://…/throwaway pnpm --filter web db:check:profiles
 *
 * Runs against a REAL Postgres: what's worth checking here is the SQL — address
 * lowercasing, the batch `IN` lookup, upsert-in-place (no duplicate row), and
 * that user input is bound as a parameter, not concatenated.
 *
 * Destructive: it truncates user_profiles. Never point it at a real database.
 */
import assert from "node:assert/strict"

import { sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"

import { userProfiles } from "@/lib/db/schema"
import { getProfile, getProfiles, upsertProfile } from "@/lib/profiles"

const URL = process.env.DATABASE_URL
if (!URL) throw new Error("DATABASE_URL required — point it at a THROWAWAY database")

const admin = drizzle(postgres(URL, { max: 1 }))
await admin.execute(sql`TRUNCATE ${userProfiles}`)

// --- upsert round-trips all fields and lowercases the wallet ----------------
const saved = await upsertProfile("0xAbCdEf", {
  name: "alice",
  bio: "gm",
  social: "https://x.com/alice",
  image: "ipfs://Qmavatar",
})
assert.ok(saved, "upsertProfile returned null against a configured DB")
assert.equal(saved.wallet, "0xabcdef", "wallet must be stored lowercased")
assert.equal(saved.name, "alice")
assert.equal(saved.bio, "gm")
assert.equal(saved.social, "https://x.com/alice")
assert.equal(saved.image, "ipfs://Qmavatar")

// getProfile finds it case-insensitively (input lowercased on read)
assert.equal((await getProfile("0xABCDEF"))?.name, "alice")
// unknown wallet => null, not an error
assert.equal(await getProfile("0xnobody"), null)

// --- upsert again for the same wallet updates in place, no duplicate row ----
const updated = await upsertProfile("0xabcdef", {
  name: "alice2",
  bio: null,
  social: null,
  image: null,
})
assert.equal(updated?.name, "alice2")
assert.equal(updated?.bio, null, "cleared field must persist as null")
const afterUpdate = await admin.select({ n: sql<number>`count(*)::int` }).from(userProfiles)
assert.equal(afterUpdate[0]?.n, 1, "upsert must update in place, not insert a second row")

// --- getProfiles: batch lookup, lowercased keys, known-only ----------------
await upsertProfile("0xBoB", { name: "bob", bio: null, social: null, image: null })
const map = await getProfiles(["0xABCDEF", "0xbob", "0xmissing"])
assert.equal(map.size, 2, "only wallets with a profile appear")
assert.equal(map.get("0xabcdef")?.name, "alice2", "keys are lowercased")
assert.equal(map.get("0xbob")?.name, "bob")
assert.equal(map.get("0xmissing"), undefined)
// empty input => empty map, no query
assert.equal((await getProfiles([])).size, 0)

// --- user input is a bind parameter, not string concatenation --------------
const nasty = "'); DROP TABLE user_profiles; --"
const evil = await upsertProfile("0xdead", { name: nasty, bio: nasty, social: null, image: null })
assert.ok(evil, "insert of adversarial input failed")
assert.equal(evil.name, nasty, "name must round-trip verbatim, not be re-parsed as SQL")
const afterEvil = await admin.select({ n: sql<number>`count(*)::int` }).from(userProfiles)
assert.equal(afterEvil[0]?.n, 3, "table should still exist with all 3 rows")

console.log("profiles.check.ts: all assertions passed")
process.exit(0)
