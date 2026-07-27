/**
 * Self-check for the Drizzle comment layer. No test framework — just asserts.
 *
 *   createdb drizzle_check
 *   DATABASE_URL=postgres://localhost:5432/drizzle_check pnpm --filter web db:check
 *
 * Runs against a REAL Postgres because everything worth checking here is the
 * SQL: the timestamptz -> unix mapping, the `make_interval` rate-limit window,
 * the newest-first ordering, and that user input is bound as a parameter rather
 * than concatenated. None of that can fail in a type checker.
 *
 * Destructive: it truncates coin_comments. Never point it at a real database.
 */
import assert from "node:assert/strict"
import { setTimeout as sleep } from "node:timers/promises"

import { sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"

import { addComment, listComments, recentCommentCount } from "@/lib/comments"
import { coinComments } from "@/lib/db/schema"

const URL = process.env.DATABASE_URL
if (!URL) throw new Error("DATABASE_URL required — point it at a THROWAWAY database")

const admin = drizzle(postgres(URL, { max: 1 }))
await admin.execute(sql`TRUNCATE ${coinComments}`)

// --- addComment round-trips, and normalises the coin to lowercase ----------
const posted = await addComment("0xAbCdEf", "0xalice", "gm", "22k")
assert.ok(posted, "addComment returned null against a configured DB")
assert.equal(posted.author, "0xalice")
assert.equal(posted.body, "gm")
assert.equal(posted.balance, "22k")
assert.match(posted.id, /^\d+$/, `id should be a numeric string, got ${posted.id}`)
assert.ok(
  Math.abs(posted.createdAt - Date.now() / 1000) < 60,
  `createdAt should be unix SECONDS near now, got ${posted.createdAt}`
)

// balance survives the round trip through the DB, not just the return value.
assert.equal((await listComments("0xabcdef"))[0]?.balance, "22k")
// ...and is nullable: the 4th arg defaults to null for callers that can't read
// a holding, which is how every row written before the column existed reads.
const noBalance = await addComment("0xnobalance", "0xalice", "no holding")
assert.equal(noBalance?.balance, null, "balance must default to null, not undefined")
assert.equal((await listComments("0xnobalance"))[0]?.balance, null)

// Written as 0xabcdef, so a lowercase lookup finds it...
assert.equal((await listComments("0xabcdef")).length, 1)
// ...and so does a mixed-case one, because listComments lowercases too.
assert.equal((await listComments("0xABCDEF")).length, 1)
// A different coin must not see it.
assert.equal((await listComments("0xother")).length, 0)

// --- listComments is newest-first and honours the limit --------------------
await sleep(5)
await addComment("0xabcdef", "0xbob", "second")
await sleep(5)
await addComment("0xabcdef", "0xbob", "third")

const thread = await listComments("0xabcdef")
assert.deepEqual(
  thread.map((c) => c.body),
  ["third", "second", "gm"],
  "listComments must return newest-first"
)
assert.equal((await listComments("0xabcdef", 2)).length, 2, "limit ignored")

// --- recentCommentCount: the interval window actually bounds the count -----
assert.equal(await recentCommentCount("0xbob", 60), 2, "bob posted 2 in the last 60s")
// alice posted "gm" and "no holding" — the count spans coins, since it exists
// to rate-limit a person, not a thread.
assert.equal(await recentCommentCount("0xalice", 60), 2)
assert.equal(await recentCommentCount("0xnobody", 60), 0)
// windowSec=0 => `created_at > now()`, which nothing satisfies. Proves the
// interval is built from the argument and not silently ignored.
assert.equal(await recentCommentCount("0xbob", 0), 0, "make_interval window is not being applied")

// --- user input is a bind parameter, not string concatenation -------------
const nasty = "'); DROP TABLE coin_comments; --"
const evil = await addComment(nasty, nasty, nasty)
assert.ok(evil, "insert of adversarial input failed")
assert.equal(evil.body, nasty, "body must round-trip verbatim, not be re-parsed as SQL")
const rows = await admin.select({ n: sql<number>`count(*)::int` }).from(coinComments)
assert.equal(rows[0]?.n, 5, "table should still exist with all 5 rows")
assert.equal((await listComments(nasty)).length, 1, "adversarial coin key round-trips")

console.log("comments.check.ts: all assertions passed")
process.exit(0)
